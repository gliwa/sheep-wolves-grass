// Lobby & session (WBS 4): the single global lobby (DECISIONS.md #14) —
// join/leave with letter+color assignment, name edit, the ready flow with
// the auto-start countdown, bots, chess voting, and the round lifecycle
// around the engine (start, tick loop with bot input, stats, round end).
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
} from '@swg/shared';
import { MAX_NAME_LENGTH, letterForIndex } from '@swg/shared';

import { computeBotCommands } from './bots';
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

  /** B key; bots join 'ready' and never vote for chess (DECISIONS.md #6b). */
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
    } else {
      this.players = this.players.filter((p) => p.id !== id);
      if (!this.humansRemain()) {
        this.reset();
        return;
      }
    }
    this.emitLobby();
  }

  /** Forwarded to the engine while a round runs; ignored otherwise. */
  submitMove(command: MoveCommand): void {
    this.engine?.submitMove(command);
  }

  /** Stop timers (tests, shutdown); the lobby is unusable afterwards. */
  dispose(): void {
    this.loop?.stop();
    this.loop = null;
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

  private chessVotePassed(): boolean {
    if (this.players.length === 0) return false;
    const votes = this.players.filter((p) => p.chessVote).length;
    return (votes / this.players.length) * 100 >= this.getConfig().cfgChessVoteThreshold;
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
    // The chess ballot is tallied for the snapshot and consumed here; actual
    // chess turn logic is WBS 7 ("mode selection") — until then every round
    // runs real-time.
    for (const player of this.players) player.chessVote = false;
    const engine = new RoundEngine({
      getConfig: this.getConfig,
      players: this.players.map((p) => ({ id: p.id, letter: p.letter })),
      chessMode: false,
      rng: this.rng,
    });
    this.engine = engine;
    for (const player of this.players) player.status = 'playing';
    this.emitLobby();
    this.events.onRoundStart(engine.state);
    this.loop = new TickLoop({
      getTickMs: () => this.getConfig().cfgTickMs,
      tick: (elapsedMs) => this.runTick(elapsedMs),
    });
    this.loop.start();
  }

  private runTick(elapsedMs: number): boolean {
    const engine = this.engine;
    if (engine === null) return false;
    for (const bot of this.players) {
      if (!bot.isBot) continue;
      for (const command of computeBotCommands(engine.state, bot.id, this.rng)) {
        engine.submitMove(command);
      }
    }
    const result = engine.advanceTick(elapsedMs);
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
      return false;
    }
    return true;
  }

  private endRound(): void {
    const engine = this.engine;
    if (engine === null) return;
    this.loop?.stop();
    this.loop = null;
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
    this.engine = null;
    this.players = [];
    this.cancelCountdown();
    this.emitLobby();
  }
}
