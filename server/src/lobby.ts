// Lobby & session (WBS 4): the single global lobby (DECISIONS.md #14) —
// join/leave with letter+color assignment, name edit, the ready flow with
// the auto-start countdown, bots, chess voting, and the round lifecycle
// around the engine (start, tick loop with bot input, stats, round end).
// A chess-vote that passes starts the round turn-based instead (WBS 7): a
// turn advances when every eligible player submitted a move or the per-turn
// timeout fires (SPEC.md → Chess mode, DECISIONS.md #7/#24).
// Networking (WBS 5) maps connections onto this API and broadcasts the
// emitted events; there is no reconnection — a disconnect is an exit and a
// reload joins as a brand-new player (DECISIONS.md #12–13).

import type {
  GameConfig,
  LobbyPlayer,
  LobbySnapshot,
  MoveCommand,
  PlayerId,
  Rng,
  RoundEndScore,
  RoundState,
  TickEvent,
  TickResult,
} from '@swg/shared';
import { MAX_NAME_LENGTH, letterForIndex } from '@swg/shared';

import { computeBotCommand } from './bots';
import { TickLoop } from './engine/loop';
import { RoundEngine, computeRoundResult } from './engine/round';

export interface LobbyEvents {
  onLobby(snapshot: LobbySnapshot): void;
  onRoundStart(state: RoundState): void;
  onTick(state: RoundState, events: TickEvent[]): void;
  onRoundEnd(scores: RoundEndScore[], winnerIds: PlayerId[]): void;
}

export interface LobbyOptions {
  getConfig: () => GameConfig;
  events: LobbyEvents;
  rng?: Rng;
  /**
   * Invoked right before a round starts — the config store applies buffered
   * next-round keys here, before the engine snapshots them (WBS 5).
   */
  beforeRoundStart?: () => void;
}

export class Lobby {
  private readonly getConfig: () => GameConfig;
  private readonly events: LobbyEvents;
  private readonly rng: Rng;
  private readonly beforeRoundStart: (() => void) | undefined;
  private players: LobbyPlayer[] = [];
  private idCounter = 0;
  private engine: RoundEngine | null = null;
  private loop: TickLoop | null = null;
  private countdownDeadline: number | null = null;
  private countdownTimer: NodeJS.Timeout | null = null;
  /**
   * Per-bot move credit for cfgBotSpeedThrottle (#34): the throttle is the
   * idle-to-move tick ratio, so each tick adds 1/(1+throttle) credit and a
   * full credit buys one move. 0 = every tick, 1 = every other tick, and
   * fractions work — it's linear in the ratio, unlike an every-Nth-tick rule.
   */
  private readonly botMoveCredit = new Map<PlayerId, number>();
  /** Chess mode: who has submitted this turn's move, and the turn timeout. */
  private readonly chessSubmitted = new Set<PlayerId>();
  private chessTimer: NodeJS.Timeout | null = null;

  constructor(options: LobbyOptions) {
    this.getConfig = options.getConfig;
    this.events = options.events;
    this.rng = options.rng ?? Math.random;
    this.beforeRoundStart = options.beforeRoundStart;
  }

  get roundRunning(): boolean {
    return this.engine !== null;
  }

  get roundState(): RoundState | null {
    return this.engine?.state ?? null;
  }

  snapshot(): LobbySnapshot {
    return {
      players: this.players.map((p) => ({ ...p })),
      countdownSeconds:
        this.countdownDeadline === null
          ? null
          : Math.max(0, Math.ceil((this.countdownDeadline - Date.now()) / 1000)),
      chessMode: this.chessVotePassed(),
    };
  }

  /** A new human connection joins; returns null when the lobby is full. */
  join(): LobbyPlayer | null {
    const player = this.addPlayer(false);
    if (player === null) return null;
    // DECISIONS.md #9: a newcomer extends a running countdown so they get
    // time to ready up. Bot additions don't reset it — bots are ready
    // instantly and need no time.
    if (this.countdownDeadline !== null) this.startCountdown();
    this.emitLobby();
    return player;
  }

  /** Name edit is only possible while still 'waiting' (SPEC.md → Screens). */
  setName(id: PlayerId, name: string): void {
    const player = this.playerById(id);
    if (player === undefined || player.isBot || player.status !== 'waiting') return;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return;
    player.name = trimmed;
    this.emitLobby();
  }

  /** P key — irreversible (DECISIONS.md #10). */
  ready(id: PlayerId): void {
    const player = this.playerById(id);
    if (player === undefined || player.status !== 'waiting') return;
    player.status = 'ready';
    // The countdown starts when the first (human) player readies
    // (DECISIONS.md #9); bots are 'ready' without ever pressing P.
    if (this.countdownDeadline === null && this.engine === null) this.startCountdown();
    this.emitLobby();
    this.tryStartRound();
  }

  /** B key; bots join 'ready' and take no part in the chess vote (#35). */
  addBot(): LobbyPlayer | null {
    const bot = this.addPlayer(true);
    if (bot === null) return null;
    this.emitLobby();
    this.tryStartRound(); // a ready bot may complete the all-ready condition
    return bot;
  }

  /** C key toggles the player's ballot; it is consumed at round start. */
  voteChess(id: PlayerId): void {
    const player = this.playerById(id);
    if (player === undefined || player.isBot || player.status === 'left') return;
    player.chessVote = !player.chessVote;
    this.emitLobby();
  }

  /** E key or a disconnect — both leave for good (DECISIONS.md #11–13). */
  exit(id: PlayerId): void {
    const player = this.playerById(id);
    if (player === undefined || player.status === 'left') return;
    const engine = this.engine;
    if (engine !== null && engine.state.players.some((p) => p.id === id)) {
      // Stay listed as 'left' until the round ends — the lonely wolf on the
      // field still needs this player's letter and color.
      player.status = 'left';
      engine.exit(id);
      if (!this.humansRemain()) {
        this.reset();
        return;
      }
      if (engine.roundOver) {
        this.endRound();
        return;
      }
      if (engine.state.chessMode) {
        // The leaver no longer counts toward the all-inputs wait (#24).
        this.chessSubmitted.delete(id);
        this.emitLobby();
        if (this.chessTurnComplete(engine)) this.advanceChessTurn();
        return;
      }
    } else {
      this.players = this.players.filter((p) => p.id !== id);
      if (!this.humansRemain()) {
        this.reset();
        return;
      }
    }
    this.emitLobby();
  }

  /**
   * Forwarded to the engine while a round runs; ignored otherwise. In chess
   * mode this also counts as the player's turn input — any move, including
   * one against a wall (a legal pass, #24) — and the turn advances once
   * every eligible player has submitted.
   */
  submitMove(command: MoveCommand): void {
    const engine = this.engine;
    if (engine === null) return;
    engine.submitMove(command);
    if (engine.state.chessMode && this.eligibleChessIds(engine).includes(command.playerId)) {
      this.chessSubmitted.add(command.playerId);
      if (this.chessTurnComplete(engine)) this.advanceChessTurn();
    }
  }

  /** Stop timers (tests, shutdown); the lobby is unusable afterwards. */
  dispose(): void {
    this.loop?.stop();
    this.loop = null;
    this.cancelChessTimer();
    this.engine = null;
    this.cancelCountdown();
  }

  private playerById(id: PlayerId): LobbyPlayer | undefined {
    return this.players.find((p) => p.id === id);
  }

  private humansRemain(): boolean {
    return this.players.some((p) => !p.isBot && p.status !== 'left');
  }

  private emitLobby(): void {
    this.events.onLobby(this.snapshot());
  }

  /** Humans only (#35): bots are not part of the electorate at all. */
  private chessVotePassed(): boolean {
    const humans = this.players.filter((p) => !p.isBot && p.status !== 'left');
    if (humans.length === 0) return false;
    const votes = humans.filter((p) => p.chessVote).length;
    return (votes / humans.length) * 100 >= this.getConfig().cfgChessVoteThreshold;
  }

  private addPlayer(isBot: boolean): LobbyPlayer | null {
    if (this.players.length >= this.getConfig().cfgMaxNofPlayers) return null;
    // Letters, colors and bot numbers are reused lowest-free after leavers
    // are purged; cfgColors.length ≥ cfgMaxNofPlayers is guaranteed (#27).
    const usedLetters = new Set(this.players.map((p) => p.letter));
    let letterIndex = 0;
    while (usedLetters.has(letterForIndex(letterIndex))) letterIndex += 1;
    const usedColors = new Set(this.players.map((p) => p.colorIndex));
    let colorIndex = 0;
    while (usedColors.has(colorIndex)) colorIndex += 1;
    const player: LobbyPlayer = {
      id: `player-${++this.idCounter}`,
      letter: letterForIndex(letterIndex),
      name: isBot ? this.nextBotName() : `Player ${letterIndex + 1}`,
      colorIndex,
      isBot,
      status: isBot ? 'ready' : 'waiting',
      roundsPlayed: 0,
      totalScore: 0,
      chessVote: false,
    };
    this.players.push(player);
    return player;
  }

  private nextBotName(): string {
    const names = new Set(this.players.map((p) => p.name));
    let n = 1;
    while (names.has(`Bot${n}`)) n += 1;
    return `Bot${n}`;
  }

  private startCountdown(): void {
    this.cancelCountdown();
    const ms = this.getConfig().cfgStartTimeout * 1000;
    this.countdownDeadline = Date.now() + ms;
    this.countdownTimer = setTimeout(() => this.onCountdownElapsed(), ms);
  }

  private cancelCountdown(): void {
    this.countdownDeadline = null;
    if (this.countdownTimer !== null) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private onCountdownElapsed(): void {
    this.countdownTimer = null;
    this.countdownDeadline = null;
    if (this.engine !== null) return;
    for (const player of this.players) {
      if (player.status === 'waiting') player.status = 'ready'; // forced (SPEC.md → Screens)
    }
    // A lone player gets a bot opponent (DECISIONS.md #26).
    if (this.players.length === 1) this.addPlayer(true);
    this.emitLobby();
    this.tryStartRound();
  }

  private tryStartRound(): void {
    if (this.engine !== null) return;
    if (this.players.length < 2) return; // a round needs two sheep (DECISIONS.md #26)
    if (!this.players.some((p) => !p.isBot)) return; // bots never play alone
    if (!this.players.every((p) => p.status === 'ready')) return;
    this.startRound();
  }

  private startRound(): void {
    this.beforeRoundStart?.(); // buffered next-round config lands first
    this.cancelCountdown();
    // Tally the ballots to select the mode, then consume them (#32).
    const chessMode = this.chessVotePassed();
    for (const player of this.players) player.chessVote = false;
    const engine = new RoundEngine({
      getConfig: this.getConfig,
      players: this.players.map((p) => ({ id: p.id, letter: p.letter })),
      chessMode,
      rng: this.rng,
    });
    this.engine = engine;
    this.botMoveCredit.clear();
    for (const player of this.players) player.status = 'playing';
    this.emitLobby();
    this.events.onRoundStart(engine.state);
    if (chessMode) {
      // Turn-based: no wall-clock loop, the inputs (or the timeout) drive it.
      this.beginChessTurnInputs(engine);
      if (this.chessTurnComplete(engine)) this.advanceChessTurn();
    } else {
      this.loop = new TickLoop({
        getTickMs: () => this.getConfig().cfgTickMs,
        tick: (elapsedMs) => this.runTick(elapsedMs),
      });
      this.loop.start();
    }
  }

  private runTick(elapsedMs: number): boolean {
    const engine = this.engine;
    if (engine === null) return false;
    const creditPerTick = 1 / (1 + Math.max(0, this.getConfig().cfgBotSpeedThrottle));
    for (const bot of this.players) {
      if (!bot.isBot) continue;
      const credit = (this.botMoveCredit.get(bot.id) ?? 0) + creditPerTick;
      if (credit < 1) {
        this.botMoveCredit.set(bot.id, credit);
        continue; // throttled this tick
      }
      this.botMoveCredit.set(bot.id, credit - 1);
      const command = computeBotCommand(engine.state, bot.id, this.rng);
      if (command !== null) engine.submitMove(command);
    }
    return !this.applyTickResult(engine.advanceTick(elapsedMs));
  }

  /** Shared tick aftermath (real-time and chess): statuses, broadcast, end check. */
  private applyTickResult(result: TickResult): boolean {
    let statusChanged = false;
    for (const event of result.events) {
      if (event.type !== 'sheep-killed') continue;
      const victim = this.playerById(event.victimId);
      if (victim !== undefined && victim.status === 'playing') {
        victim.status = 'knocked-out';
        statusChanged = true;
      }
    }
    if (statusChanged && !result.roundEnded) this.emitLobby();
    this.events.onTick(result.state, result.events);
    if (result.roundEnded) {
      this.endRound();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // Chess mode (WBS 7): a turn is one engine tick, driven by inputs.

  /** Players who still owe a turn input: alive and present (#24). */
  private eligibleChessIds(engine: RoundEngine): PlayerId[] {
    return engine.state.players.filter((p) => p.sheep !== null && !p.exited).map((p) => p.id);
  }

  private chessTurnComplete(engine: RoundEngine): boolean {
    return this.eligibleChessIds(engine).every((id) => this.chessSubmitted.has(id));
  }

  /**
   * Open a new turn: bots answer promptly (SPEC.md → Chess mode — the speed
   * throttle is a real-time concept and does not apply here, a throttled bot
   * would only stall every turn into the timeout), then the per-turn timer
   * is armed with the current cfgChessTurnTimeout (live from next turn).
   */
  private beginChessTurnInputs(engine: RoundEngine): void {
    this.chessSubmitted.clear();
    this.cancelChessTimer();
    const eligible = new Set(this.eligibleChessIds(engine));
    for (const bot of this.players) {
      if (!bot.isBot || !eligible.has(bot.id)) continue;
      const command = computeBotCommand(engine.state, bot.id, this.rng);
      if (command !== null) engine.submitMove(command);
      this.chessSubmitted.add(bot.id); // a held bot still answered (pass)
    }
    this.chessTimer = setTimeout(
      () => this.advanceChessTurn(),
      this.getConfig().cfgChessTurnTimeout * 1000,
    );
  }

  /**
   * Resolve the current turn and open the next; iterates while turns
   * complete immediately (a bots-only tail must not recurse), stopping when
   * a human input is awaited or the round ends.
   */
  private advanceChessTurn(): void {
    const engine = this.engine;
    if (engine === null || !engine.state.chessMode) return;
    for (;;) {
      this.cancelChessTimer();
      if (this.applyTickResult(engine.advanceTick(0))) return; // round ended
      this.beginChessTurnInputs(engine);
      if (!this.chessTurnComplete(engine)) return;
    }
  }

  private cancelChessTimer(): void {
    if (this.chessTimer !== null) {
      clearTimeout(this.chessTimer);
      this.chessTimer = null;
    }
  }

  private endRound(): void {
    const engine = this.engine;
    if (engine === null) return;
    this.loop?.stop();
    this.loop = null;
    this.cancelChessTimer();
    this.chessSubmitted.clear();
    this.engine = null;
    const result = computeRoundResult(engine.state);
    const scores: RoundEndScore[] = result.scores.map((s) => ({
      ...s,
      name: this.playerById(s.playerId)?.name ?? '?',
    }));
    for (const roundPlayer of engine.state.players) {
      const player = this.playerById(roundPlayer.id);
      if (player === undefined || player.status === 'left') continue;
      player.roundsPlayed += 1;
      player.totalScore += roundPlayer.score;
      // Humans return to the start screen 'waiting', bots are instantly
      // ready again (SPEC.md → Round lifecycle).
      player.status = player.isBot ? 'ready' : 'waiting';
    }
    this.players = this.players.filter((p) => p.status !== 'left');
    // A human who joined mid-round and already readied must not be stranded
    // without a countdown.
    if (this.players.some((p) => !p.isBot && p.status === 'ready')) this.startCountdown();
    this.events.onRoundEnd(scores, result.winnerIds);
    this.emitLobby();
  }

  /** The last human left: drop the bots, abort any round, start over. */
  private reset(): void {
    this.loop?.stop();
    this.loop = null;
    this.cancelChessTimer();
    this.chessSubmitted.clear();
    this.engine = null;
    this.players = [];
    this.cancelCountdown();
    this.emitLobby();
  }
}
