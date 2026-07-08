import { describe, expect, it } from 'vitest';

import type { Direction, GameConfig, RoundState, TickResult } from '@swg/shared';
import { DEFAULT_CONFIG } from '@swg/shared';

import { RoundEngine, computeRoundResult } from './round';

// 10×10 field, no grass, no growth — geometry tests add what they need.
function baseConfig(): GameConfig {
  return {
    ...DEFAULT_CONFIG,
    cfgFieldSizeX: 10,
    cfgFieldSizeY: 10,
    cfgInitialNofGrass: 0,
    cfgGrassGrowRate: 0,
    cfgSheepKillBonus: 10,
  };
}

/**
 * Engine with an all-zeros rng: seating keeps join order, so on 10×10 with
 * two players 'a' gets wolf (0,0) / sheep (1,0) and 'b' gets wolf (9,9) /
 * sheep (8,9) (mirrored, DECISIONS #28). Contests go to the first mover.
 */
function makeEngine(
  overrides: Partial<GameConfig> = {},
  { chessMode = false } = {},
): { engine: RoundEngine; config: GameConfig } {
  const config = { ...baseConfig(), ...overrides };
  const engine = new RoundEngine({
    getConfig: () => config,
    players: [
      { id: 'a', letter: 'a' },
      { id: 'b', letter: 'b' },
    ],
    chessMode,
    rng: () => 0,
  });
  return { engine, config };
}

function get(state: RoundState, id: string) {
  const player = state.players.find((p) => p.id === id);
  if (player === undefined) throw new Error(`no player ${id}`);
  return player;
}

/** One command + one tick per direction; returns the last tick's result. */
function marchWolf(engine: RoundEngine, playerId: string, dirs: Direction[]): TickResult {
  let result: TickResult | null = null;
  for (const dir of dirs) {
    engine.submitMove({ playerId, entity: 'wolf', dir });
    result = engine.advanceTick(0);
  }
  if (result === null) throw new Error('no directions given');
  return result;
}

describe('RoundEngine — construction', () => {
  it('snapshots next-round config keys and places the round', () => {
    const { engine } = makeEngine({ cfgInitialNofGrass: 5, cfgMaxNofGrass: 40 });
    expect(engine.state.tick).toBe(0);
    expect(engine.state.fieldSizeX).toBe(10);
    expect(engine.state.grass).toHaveLength(5);
    expect(engine.state.chessMode).toBe(false);
    expect(get(engine.state, 'a').wolf).toEqual({ x: 0, y: 0 });
    expect(get(engine.state, 'a').sheep).toEqual({ x: 1, y: 0 });
    expect(get(engine.state, 'b').wolf).toEqual({ x: 9, y: 9 });
    expect(get(engine.state, 'b').sheep).toEqual({ x: 8, y: 9 });
    expect(engine.roundOver).toBe(false);
  });
});

describe('RoundEngine — command buffering (phase a)', () => {
  it('keeps only the newest command per entity and clears the buffer each tick', () => {
    const { engine } = makeEngine();
    engine.submitMove({ playerId: 'a', entity: 'sheep', dir: 'right' });
    engine.submitMove({ playerId: 'a', entity: 'sheep', dir: 'down' });
    engine.advanceTick(0);
    expect(get(engine.state, 'a').sheep).toEqual({ x: 1, y: 1 }); // 'down' won
    engine.advanceTick(0);
    expect(get(engine.state, 'a').sheep).toEqual({ x: 1, y: 1 }); // buffer was cleared
  });

  it('keeps one command per player: a wolf move overrides a buffered sheep move (#34)', () => {
    const { engine } = makeEngine();
    engine.submitMove({ playerId: 'a', entity: 'sheep', dir: 'down' });
    engine.submitMove({ playerId: 'a', entity: 'wolf', dir: 'down' });
    engine.advanceTick(0);
    expect(get(engine.state, 'a').sheep).toEqual({ x: 1, y: 0 }); // held
    expect(get(engine.state, 'a').wolf).toEqual({ x: 0, y: 1 }); // newest command
  });
});

describe('RoundEngine — full round', () => {
  it("a's wolf hunts down b's sheep: kill, snapshot bonus, round end, result", () => {
    const { engine, config } = makeEngine();
    // March along the bottom edge to (7,9), one step short of b's sheep (8,9).
    const approach = marchWolf(engine, 'a', [
      ...Array<Direction>(9).fill('down'),
      ...Array<Direction>(7).fill('right'),
    ]);
    expect(approach.roundEnded).toBe(false);
    expect(get(engine.state, 'a').wolf).toEqual({ x: 7, y: 9 });

    // A next-round key changed mid-round must not affect the running round.
    config.cfgSheepKillBonus = 999;
    const kill = marchWolf(engine, 'a', ['right']);

    expect(kill.roundEnded).toBe(true);
    expect(engine.roundOver).toBe(true);
    expect(kill.events).toContainEqual({
      type: 'sheep-killed',
      victimId: 'b',
      killerId: 'a',
      pos: { x: 8, y: 9 },
    });
    expect(get(engine.state, 'b').sheep).toBeNull();
    expect(get(engine.state, 'a').score).toBe(10); // snapshot, not 999

    const result = computeRoundResult(engine.state);
    expect(result.scores).toEqual([
      { playerId: 'a', score: 10 },
      { playerId: 'b', score: 0 },
    ]);
    expect(result.winnerIds).toEqual(['a']);
  });

  it('exit removes the sheep without points and can end the round (DECISIONS #11)', () => {
    const { engine } = makeEngine();
    engine.exit('b');
    expect(get(engine.state, 'b').sheep).toBeNull();
    expect(get(engine.state, 'b').exited).toBe(true);
    expect(get(engine.state, 'b').score).toBe(0);
    expect(engine.roundOver).toBe(true); // only a's sheep remains

    const result = computeRoundResult(engine.state);
    expect(result.scores).toEqual([{ playerId: 'a', score: 0 }]); // b forfeits
    expect(result.winnerIds).toEqual(['a']);
  });
});

describe('RoundEngine — real-time grass growth', () => {
  it('accumulates cfgGrassGrowRate per wall-clock minute across ticks', () => {
    const { engine } = makeEngine({ cfgGrassGrowRate: 60, cfgMaxNofGrass: 40 }); // 1/second
    engine.advanceTick(500);
    expect(engine.state.grass).toHaveLength(0); // 0.5 credit
    engine.advanceTick(500);
    expect(engine.state.grass).toHaveLength(1);
    engine.advanceTick(3000);
    expect(engine.state.grass).toHaveLength(4);
  });

  it('reads the live rate on every tick', () => {
    const { engine, config } = makeEngine({ cfgGrassGrowRate: 0, cfgMaxNofGrass: 40 });
    engine.advanceTick(60_000);
    expect(engine.state.grass).toHaveLength(0);
    config.cfgGrassGrowRate = 60;
    engine.advanceTick(1000);
    expect(engine.state.grass).toHaveLength(1);
  });

  it('skips spawns at the cap without deferring them', () => {
    const { engine, config } = makeEngine({ cfgGrassGrowRate: 60, cfgMaxNofGrass: 2 });
    engine.advanceTick(5000); // 5 credit, but capped at 2
    expect(engine.state.grass).toHaveLength(2);
    config.cfgMaxNofGrass = 40;
    engine.advanceTick(0); // no new elapsed time — the skipped spawns are gone
    expect(engine.state.grass).toHaveLength(2);
  });
});

describe('RoundEngine — chess-mode grass growth', () => {
  it('grows once every cfgChessTicksPerGrassGrow ticks, ignoring wall-clock time', () => {
    const { engine } = makeEngine(
      { cfgChessTicksPerGrassGrow: 3, cfgGrassGrowRate: 60, cfgMaxNofGrass: 40 },
      { chessMode: true },
    );
    expect(engine.state.chessMode).toBe(true);
    engine.advanceTick(60_000); // huge elapsed time must not matter in chess mode
    engine.advanceTick(60_000);
    expect(engine.state.grass).toHaveLength(0);
    engine.advanceTick(60_000); // 3rd tick
    expect(engine.state.grass).toHaveLength(1);
    engine.advanceTick(0);
    engine.advanceTick(0);
    engine.advanceTick(0); // 6th tick
    expect(engine.state.grass).toHaveLength(2);
  });
});

describe('computeRoundResult', () => {
  it('ranks by score, ties share the win, exited players are excluded', () => {
    const state: RoundState = {
      tick: 42,
      fieldSizeX: 10,
      fieldSizeY: 10,
      chessMode: false,
      grass: [],
      players: [
        {
          id: 'a',
          letter: 'a',
          sheep: { x: 1, y: 1 },
          wolf: { x: 0, y: 0 },
          score: 5,
          exited: false,
        },
        { id: 'b', letter: 'b', sheep: null, wolf: { x: 9, y: 9 }, score: 5, exited: false },
        { id: 'c', letter: 'c', sheep: null, wolf: { x: 5, y: 5 }, score: 9, exited: true },
      ],
    };
    const result = computeRoundResult(state);
    expect(result.scores.map((s) => s.playerId)).toEqual(['a', 'b']);
    expect(result.winnerIds).toEqual(['a', 'b']);
  });
});
