import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Direction,
  GameConfig,
  LobbySnapshot,
  PlayerId,
  RoundEndScore,
  RoundState,
  TickEvent,
} from '@swg/shared';
import { DEFAULT_CONFIG } from '@swg/shared';

import { Lobby } from './lobby';

interface Recorded {
  lobbies: LobbySnapshot[];
  roundStarts: RoundState[];
  ticks: { state: RoundState; events: TickEvent[] }[];
  roundEnds: { scores: RoundEndScore[]; winnerIds: PlayerId[] }[];
}

/**
 * Lobby on a 10×10 field without grass, rng 0: seating keeps join order, so
 * the first player gets wolf (0,0) / sheep (1,0) and the second wolf (9,9) /
 * sheep (8,9). Countdown 60s, tick 100ms.
 */
function makeLobby(overrides: Partial<GameConfig> = {}): {
  lobby: Lobby;
  config: GameConfig;
  rec: Recorded;
} {
  const config: GameConfig = {
    ...DEFAULT_CONFIG,
    cfgFieldSizeX: 10,
    cfgFieldSizeY: 10,
    cfgInitialNofGrass: 0,
    cfgGrassGrowRate: 0,
    cfgSheepKillBonus: 10,
    cfgStartTimeout: 60,
    cfgTickMs: 100,
    cfgBotSpeedThrottle: 0, // full-speed bots unless a test throttles them
    ...overrides,
  };
  const rec: Recorded = { lobbies: [], roundStarts: [], ticks: [], roundEnds: [] };
  const lobby = new Lobby({
    getConfig: () => config,
    rng: () => 0,
    events: {
      onLobby: (snapshot) => rec.lobbies.push(snapshot),
      onRoundStart: (state) => rec.roundStarts.push(state),
      onTick: (state, events) => rec.ticks.push({ state, events }),
      onRoundEnd: (scores, winnerIds) => rec.roundEnds.push({ scores, winnerIds }),
    },
  });
  return { lobby, config, rec };
}

/** Submit one wolf command per direction and advance one 100ms tick each. */
function marchWolf(lobby: Lobby, playerId: PlayerId, dirs: Direction[]): void {
  for (const dir of dirs) {
    lobby.submitMove({ playerId, entity: 'wolf', dir });
    vi.advanceTimersByTime(100);
  }
}

/** 9 down + 8 right: first player's wolf from (0,0) onto the second's sheep (8,9). */
const HUNT_PATH: Direction[] = [
  ...Array<Direction>(9).fill('down'),
  ...Array<Direction>(8).fill('right'),
];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Lobby — joining', () => {
  it('assigns letters, colors and default names in join order', () => {
    const { lobby } = makeLobby();
    const p1 = lobby.join()!;
    const p2 = lobby.join()!;
    expect(p1).toMatchObject({ letter: 'a', name: 'Player 1', colorIndex: 0, status: 'waiting' });
    expect(p2).toMatchObject({ letter: 'b', name: 'Player 2', colorIndex: 1, status: 'waiting' });
    expect(lobby.snapshot().players).toHaveLength(2);
    expect(lobby.snapshot().countdownSeconds).toBeNull();
  });

  it('rejects joins and bots beyond cfgMaxNofPlayers', () => {
    const { lobby } = makeLobby({ cfgMaxNofPlayers: 2 });
    expect(lobby.join()).not.toBeNull();
    expect(lobby.join()).not.toBeNull();
    expect(lobby.join()).toBeNull();
    expect(lobby.addBot()).toBeNull();
  });

  it('reuses the lowest free letter, color and default name after a leave', () => {
    const { lobby } = makeLobby();
    const p1 = lobby.join()!;
    lobby.join();
    lobby.exit(p1.id); // no round running → purged immediately
    const p3 = lobby.join()!;
    expect(p3).toMatchObject({ letter: 'a', name: 'Player 1', colorIndex: 0 });
  });
});

describe('Lobby — name edit', () => {
  it("renames only while 'waiting' and never renames bots", () => {
    const { lobby } = makeLobby();
    const p1 = lobby.join()!;
    const bot = lobby.addBot()!;
    lobby.setName(p1.id, '  Alice  ');
    lobby.setName(bot.id, 'NotABot');
    lobby.ready(p1.id);
    lobby.setName(p1.id, 'Bob'); // too late — already ready
    const names = new Map(lobby.snapshot().players.map((p) => [p.id, p.name]));
    expect(names.get(p1.id)).toBe('Alice');
    expect(names.get(bot.id)).toBe('Bot1');
  });
});

describe('Lobby — ready flow & countdown', () => {
  it('starts the countdown on the first ready and the round when all are ready', () => {
    const { lobby, rec } = makeLobby();
    const p1 = lobby.join()!;
    const p2 = lobby.join()!;
    lobby.ready(p1.id);
    expect(lobby.snapshot().countdownSeconds).toBe(60);
    expect(rec.roundStarts).toHaveLength(0);
    lobby.ready(p2.id);
    expect(rec.roundStarts).toHaveLength(1);
    expect(lobby.roundRunning).toBe(true);
    expect(lobby.snapshot().countdownSeconds).toBeNull();
    for (const p of lobby.snapshot().players) expect(p.status).toBe('playing');
  });

  it('a lone ready player gets a bot when the countdown elapses, then the round starts', () => {
    const { lobby, rec } = makeLobby();
    const p1 = lobby.join()!;
    lobby.ready(p1.id);
    vi.advanceTimersByTime(59_999);
    expect(rec.roundStarts).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(rec.roundStarts).toHaveLength(1);
    const players = lobby.snapshot().players;
    expect(players).toHaveLength(2);
    expect(players.find((p) => p.isBot)).toMatchObject({ name: 'Bot1', status: 'playing' });

    // The bot actually plays: its wolf leaves the (9,9) corner within a few ticks.
    vi.advanceTimersByTime(300);
    const bot = players.find((p) => p.isBot)!;
    const botOnField = lobby.roundState!.players.find((p) => p.id === bot.id)!;
    expect(botOnField.wolf).not.toEqual({ x: 9, y: 9 });
  });

  it('cfgBotSpeedThrottle 1 halves the bot: one move per two ticks (#34)', () => {
    const { lobby } = makeLobby({ cfgBotSpeedThrottle: 1 });
    const p1 = lobby.join()!;
    const bot = lobby.addBot()!;
    lobby.ready(p1.id); // round starts (bot is ready)
    vi.advanceTimersByTime(400); // 4 ticks → credit 0.5/1/0.5/1 → exactly 2 moves
    const botOnField = lobby.roundState!.players.find((p) => p.id === bot.id)!;
    const distanceMoved =
      Math.abs(botOnField.wolf.x - 9) +
      Math.abs(botOnField.wolf.y - 9) +
      Math.abs(botOnField.sheep!.x - 8) +
      Math.abs(botOnField.sheep!.y - 9);
    expect(distanceMoved).toBe(2);
  });

  it('a join resets the countdown; the elapse forces everyone ready (DECISIONS #9)', () => {
    const { lobby, rec } = makeLobby();
    const p1 = lobby.join()!;
    lobby.ready(p1.id);
    vi.advanceTimersByTime(30_000);
    expect(lobby.snapshot().countdownSeconds).toBe(30);
    lobby.join(); // newcomer → full 60s again
    expect(lobby.snapshot().countdownSeconds).toBe(60);
    vi.advanceTimersByTime(35_000); // past the original deadline
    expect(rec.roundStarts).toHaveLength(0);
    vi.advanceTimersByTime(25_000); // new deadline: newcomer is forced ready
    expect(rec.roundStarts).toHaveLength(1);
  });

  it('ready is irreversible and readying with a ready bot present starts at once', () => {
    const { lobby, rec } = makeLobby();
    const p1 = lobby.join()!;
    lobby.addBot();
    lobby.ready(p1.id); // bot is already ready → all ready → start
    expect(rec.roundStarts).toHaveLength(1);
  });
});

describe('Lobby — chess vote', () => {
  it('tallies toggled votes of humans only; bots are not part of the electorate (#35)', () => {
    const { lobby } = makeLobby();
    const p1 = lobby.join()!;
    const p2 = lobby.join()!;
    lobby.voteChess(p1.id);
    expect(lobby.snapshot().chessMode).toBe(false); // 1/2 humans < 100%
    lobby.voteChess(p2.id);
    expect(lobby.snapshot().chessMode).toBe(true); // 2/2 humans
    lobby.addBot();
    expect(lobby.snapshot().chessMode).toBe(true); // still 2/2 — the bot is not counted
    lobby.voteChess(p1.id); // toggle off
    lobby.voteChess(p2.id);
    expect(lobby.snapshot().players.every((p) => !p.chessVote)).toBe(true);
  });

  it('a lone human with a bot can carry the vote at the 100% default (#35)', () => {
    const { lobby } = makeLobby();
    const p1 = lobby.join()!;
    lobby.addBot();
    expect(lobby.snapshot().chessMode).toBe(false);
    lobby.voteChess(p1.id);
    expect(lobby.snapshot().chessMode).toBe(true); // 1/1 humans
  });

  it('respects a lower threshold and consumes ballots at round start', () => {
    const { lobby } = makeLobby({ cfgChessVoteThreshold: 50 });
    const p1 = lobby.join()!;
    const p2 = lobby.join()!;
    lobby.voteChess(p1.id);
    expect(lobby.snapshot().chessMode).toBe(true); // 1/2 ≥ 50%
    lobby.ready(p1.id);
    lobby.ready(p2.id); // round starts, ballots consumed
    expect(lobby.snapshot().chessMode).toBe(false);
  });
});

describe('Lobby — chess mode (WBS 7)', () => {
  /** Two humans, both vote chess, both ready → a chess round is running. */
  function startChessRound(overrides: Partial<GameConfig> = {}) {
    const setup = makeLobby({ cfgChessTurnTimeout: 10, ...overrides });
    const p1 = setup.lobby.join()!;
    const p2 = setup.lobby.join()!;
    setup.lobby.voteChess(p1.id);
    setup.lobby.voteChess(p2.id);
    setup.lobby.ready(p1.id);
    setup.lobby.ready(p2.id);
    return { ...setup, p1, p2 };
  }

  it('a passed vote starts the round in chess mode; without votes it stays real-time', () => {
    const chess = startChessRound();
    expect(chess.rec.roundStarts[0]!.chessMode).toBe(true);

    const { lobby, rec } = makeLobby();
    const p1 = lobby.join()!;
    const p2 = lobby.join()!;
    lobby.ready(p1.id);
    lobby.ready(p2.id);
    expect(rec.roundStarts[0]!.chessMode).toBe(false);
  });

  it('turns advance on all inputs, not on wall-clock time; newest command wins', () => {
    const { lobby, rec, p1, p2 } = startChessRound();
    vi.advanceTimersByTime(5000); // no TickLoop — nothing may tick on its own
    expect(rec.ticks).toHaveLength(0);

    lobby.submitMove({ playerId: p1.id, entity: 'sheep', dir: 'down' });
    lobby.submitMove({ playerId: p1.id, entity: 'wolf', dir: 'down' }); // replaces the sheep move
    expect(rec.ticks).toHaveLength(0); // still waiting for p2

    lobby.submitMove({ playerId: p2.id, entity: 'sheep', dir: 'up' });
    expect(rec.ticks).toHaveLength(1); // all inputs in → turn resolved
    const state = rec.ticks[0]!.state;
    expect(state.tick).toBe(1);
    expect(state.players.find((p) => p.id === p1.id)!.wolf).toEqual({ x: 0, y: 1 });
    expect(state.players.find((p) => p.id === p1.id)!.sheep).toEqual({ x: 1, y: 0 }); // overridden
    expect(state.players.find((p) => p.id === p2.id)!.sheep).toEqual({ x: 8, y: 8 });
  });

  it('the per-turn timeout advances with whatever inputs arrived', () => {
    const { lobby, rec, p1 } = startChessRound();
    lobby.submitMove({ playerId: p1.id, entity: 'sheep', dir: 'down' });
    vi.advanceTimersByTime(9_999);
    expect(rec.ticks).toHaveLength(0);
    vi.advanceTimersByTime(1); // cfgChessTurnTimeout = 10s
    expect(rec.ticks).toHaveLength(1);
    expect(rec.ticks[0]!.state.players.find((p) => p.id === p1.id)!.sheep).toEqual({ x: 1, y: 1 });

    vi.advanceTimersByTime(10_000); // next turn times out with no input at all
    expect(rec.ticks).toHaveLength(2);
  });

  it('bots answer promptly and ignore the speed throttle in chess mode', () => {
    // Default 100% threshold: the lone human's vote carries it alone (#35).
    const { lobby, rec } = makeLobby({
      cfgChessTurnTimeout: 10,
      cfgBotSpeedThrottle: 5,
    });
    const p1 = lobby.join()!;
    const bot = lobby.addBot()!;
    lobby.voteChess(p1.id);
    lobby.ready(p1.id);
    expect(rec.roundStarts[0]!.chessMode).toBe(true);

    const botWolfDistance = () => {
      const onField = lobby.roundState!.players.find((p) => p.id === bot.id)!;
      return Math.abs(onField.wolf.x - 9) + Math.abs(onField.wolf.y - 9);
    };
    // The bot answered at turn start, so each human input resolves a turn
    // immediately — and the bot moves every single turn despite throttle 5.
    lobby.submitMove({ playerId: p1.id, entity: 'sheep', dir: 'down' });
    expect(rec.ticks).toHaveLength(1);
    expect(botWolfDistance()).toBe(1);
    lobby.submitMove({ playerId: p1.id, entity: 'sheep', dir: 'down' });
    expect(rec.ticks).toHaveLength(2);
    expect(botWolfDistance()).toBe(2);
  });

  it('an exiting player no longer blocks the all-inputs wait', () => {
    const { lobby, rec } = makeLobby({ cfgChessTurnTimeout: 10 });
    const p1 = lobby.join()!;
    const p2 = lobby.join()!;
    const p3 = lobby.join()!;
    for (const p of [p1, p2, p3]) lobby.voteChess(p.id);
    for (const p of [p1, p2, p3]) lobby.ready(p.id);
    expect(rec.roundStarts[0]!.chessMode).toBe(true);

    lobby.submitMove({ playerId: p1.id, entity: 'sheep', dir: 'down' });
    lobby.submitMove({ playerId: p2.id, entity: 'sheep', dir: 'up' });
    expect(rec.ticks).toHaveLength(0); // waiting for p3
    lobby.exit(p3.id);
    expect(rec.ticks).toHaveLength(1); // wait shrank to p1+p2 → turn resolved
    expect(rec.roundEnds).toHaveLength(0); // two sheep still alive
  });
});

describe('Lobby — round lifecycle', () => {
  it('runs a full round: kill ends it, stats accumulate, players return to waiting', () => {
    const { lobby, rec } = makeLobby();
    const p1 = lobby.join()!;
    const p2 = lobby.join()!;
    lobby.ready(p1.id);
    lobby.ready(p2.id);
    marchWolf(lobby, p1.id, HUNT_PATH);

    expect(rec.roundEnds).toHaveLength(1);
    expect(rec.roundEnds[0]!.scores).toEqual([
      { playerId: p1.id, name: 'Player 1', score: 10 },
      { playerId: p2.id, name: 'Player 2', score: 0 },
    ]);
    expect(rec.roundEnds[0]!.winnerIds).toEqual([p1.id]);
    expect(lobby.roundRunning).toBe(false);
    const players = lobby.snapshot().players;
    expect(players.map((p) => p.status)).toEqual(['waiting', 'waiting']);
    expect(players.map((p) => p.roundsPlayed)).toEqual([1, 1]);
    expect(players.map((p) => p.totalScore)).toEqual([10, 0]);
    expect(lobby.snapshot().countdownSeconds).toBeNull();
  });

  it('an exit mid-round leaves a lonely wolf, ends the round, forfeits and purges the leaver', () => {
    const { lobby, rec } = makeLobby();
    const p1 = lobby.join()!;
    const p2 = lobby.join()!;
    lobby.ready(p1.id);
    lobby.ready(p2.id);
    lobby.exit(p2.id); // p1's sheep is the only one left → round over

    expect(rec.roundEnds).toHaveLength(1);
    expect(rec.roundEnds[0]!.scores).toEqual([{ playerId: p1.id, name: 'Player 1', score: 0 }]);
    expect(rec.roundEnds[0]!.winnerIds).toEqual([p1.id]);
    expect(lobby.roundRunning).toBe(false);
    expect(lobby.snapshot().players.map((p) => p.id)).toEqual([p1.id]);
    expect(lobby.snapshot().players[0]!).toMatchObject({ status: 'waiting', roundsPlayed: 1 });
  });

  it('resets the lobby when the last human leaves: bots removed, round aborted', () => {
    const { lobby, rec } = makeLobby();
    const p1 = lobby.join()!;
    lobby.addBot();
    lobby.ready(p1.id); // starts immediately (bot ready)
    expect(lobby.roundRunning).toBe(true);
    lobby.exit(p1.id);
    expect(lobby.roundRunning).toBe(false);
    expect(lobby.snapshot().players).toEqual([]);
    expect(rec.roundEnds).toHaveLength(0); // aborted, not finished
  });

  it('mid-round joiners wait, are excluded from the result, and get a countdown if ready', () => {
    const { lobby, rec } = makeLobby();
    const p1 = lobby.join()!;
    const p2 = lobby.join()!;
    lobby.ready(p1.id);
    lobby.ready(p2.id);
    const p3 = lobby.join()!;
    expect(p3.status).toBe('waiting');
    expect(lobby.roundState!.players.map((p) => p.id)).toEqual([p1.id, p2.id]);
    lobby.ready(p3.id); // readying mid-round must not start anything
    expect(lobby.snapshot().countdownSeconds).toBeNull();

    marchWolf(lobby, p1.id, HUNT_PATH);
    expect(rec.roundEnds).toHaveLength(1);
    expect(rec.roundEnds[0]!.scores.map((s) => s.playerId)).toEqual([p1.id, p2.id]);
    // The already-ready joiner gets a fresh countdown instead of being stranded.
    expect(lobby.snapshot().countdownSeconds).toBe(60);
  });
});
