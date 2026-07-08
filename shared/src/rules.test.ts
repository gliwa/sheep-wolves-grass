import { describe, expect, it } from 'vitest';

import type { MoveCommand, Rng } from './rules';
import { applyPlayerExit, growGrass, resolveTick } from './rules';
import type { RoundPlayer, RoundState, Vec2 } from './state';
import { countAliveSheep, isRoundOver } from './state';

const KILL_BONUS = 10;

/** rng stub: returns the given values in sequence (0 = first wins a contest). */
function rngOf(...values: number[]): Rng {
  let i = 0;
  return () => values[i++] ?? 0;
}

function player(id: string, sheep: Vec2 | null, wolf: Vec2): RoundPlayer {
  return { id, letter: id, sheep, wolf, score: 0, exited: false };
}

function makeState(players: RoundPlayer[], grass: Vec2[] = []): RoundState {
  return { tick: 0, fieldSizeX: 10, fieldSizeY: 10, chessMode: false, grass, players };
}

function move(playerId: string, entity: 'sheep' | 'wolf', dir: MoveCommand['dir']): MoveCommand {
  return { playerId, entity, dir };
}

function get(state: RoundState, id: string): RoundPlayer {
  const p = state.players.find((x) => x.id === id);
  if (p === undefined) throw new Error(`no player ${id}`);
  return p;
}

describe('resolveTick — movement & validation', () => {
  it('applies only the newest command per player — sheep or wolf, never both (#34)', () => {
    const state = makeState([player('a', { x: 1, y: 1 }, { x: 5, y: 5 })]);
    const result = resolveTick(
      state,
      [move('a', 'sheep', 'right'), move('a', 'wolf', 'down')],
      KILL_BONUS,
      rngOf(),
    );
    expect(get(result.state, 'a').sheep).toEqual({ x: 1, y: 1 }); // overridden
    expect(get(result.state, 'a').wolf).toEqual({ x: 5, y: 6 }); // newest wins
    expect(result.state.tick).toBe(1);
  });

  it('a move into a wall is a no-op', () => {
    const state = makeState([player('a', { x: 0, y: 0 }, { x: 9, y: 9 })]);
    const result = resolveTick(
      state,
      [move('a', 'sheep', 'left'), move('a', 'wolf', 'down')],
      KILL_BONUS,
      rngOf(),
    );
    expect(get(result.state, 'a').sheep).toEqual({ x: 0, y: 0 });
    expect(get(result.state, 'a').wolf).toEqual({ x: 9, y: 9 });
  });

  it('rejects moving onto own entities and same-type entities', () => {
    const state = makeState([
      player('a', { x: 1, y: 1 }, { x: 2, y: 1 }),
      player('b', { x: 1, y: 2 }, { x: 2, y: 2 }),
      player('c', { x: 5, y: 5 }, { x: 2, y: 3 }),
    ]);
    const result = resolveTick(
      state,
      [
        move('a', 'sheep', 'right'), // own wolf
        move('b', 'sheep', 'up'), // foreign sheep (same type)
        move('c', 'wolf', 'up'), // foreign wolf (same type)
      ],
      KILL_BONUS,
      rngOf(),
    );
    expect(get(result.state, 'a').sheep).toEqual({ x: 1, y: 1 });
    expect(get(result.state, 'b').sheep).toEqual({ x: 1, y: 2 });
    expect(get(result.state, 'c').wolf).toEqual({ x: 2, y: 3 });
  });

  it('ignores commands from knocked-out and exited players (lonely wolf)', () => {
    const state = makeState([
      player('a', null, { x: 5, y: 5 }), // knocked out
      player('b', { x: 1, y: 1 }, { x: 8, y: 8 }),
    ]);
    const result = resolveTick(state, [move('a', 'wolf', 'up')], KILL_BONUS, rngOf());
    expect(get(result.state, 'a').wolf).toEqual({ x: 5, y: 5 });
  });

  it('keeps the last command when an entity gets several in one tick', () => {
    const state = makeState([player('a', { x: 1, y: 1 }, { x: 5, y: 5 })]);
    const result = resolveTick(
      state,
      [move('a', 'sheep', 'right'), move('a', 'sheep', 'down')],
      KILL_BONUS,
      rngOf(),
    );
    expect(get(result.state, 'a').sheep).toEqual({ x: 1, y: 2 });
  });

  it('picks a random winner when two sheep contest one cell; the loser holds', () => {
    const state = makeState([
      player('a', { x: 1, y: 1 }, { x: 8, y: 8 }),
      player('b', { x: 3, y: 1 }, { x: 8, y: 9 }),
    ]);
    const commands = [move('a', 'sheep', 'right'), move('b', 'sheep', 'left')];
    const first = resolveTick(state, commands, KILL_BONUS, rngOf(0));
    expect(get(first.state, 'a').sheep).toEqual({ x: 2, y: 1 });
    expect(get(first.state, 'b').sheep).toEqual({ x: 3, y: 1 });
    const second = resolveTick(state, commands, KILL_BONUS, rngOf(0.99));
    expect(get(second.state, 'a').sheep).toEqual({ x: 1, y: 1 });
    expect(get(second.state, 'b').sheep).toEqual({ x: 2, y: 1 });
  });
});

describe('resolveTick — grass', () => {
  it('a sheep landing on grass eats it: +1 point, grass gone', () => {
    const state = makeState([player('a', { x: 1, y: 1 }, { x: 8, y: 8 })], [{ x: 2, y: 1 }]);
    const result = resolveTick(state, [move('a', 'sheep', 'right')], KILL_BONUS, rngOf());
    expect(get(result.state, 'a').score).toBe(1);
    expect(result.state.grass).toEqual([]);
    expect(result.events).toContainEqual({
      type: 'grass-eaten',
      playerId: 'a',
      pos: { x: 2, y: 1 },
    });
  });

  it('a wolf landing on grass tramples it: grass gone, nobody scores', () => {
    const state = makeState([player('a', { x: 1, y: 1 }, { x: 8, y: 8 })], [{ x: 8, y: 9 }]);
    const result = resolveTick(state, [move('a', 'wolf', 'down')], KILL_BONUS, rngOf());
    expect(get(result.state, 'a').score).toBe(0);
    expect(result.state.grass).toEqual([]);
    expect(result.events).toContainEqual({
      type: 'grass-trampled',
      playerId: 'a',
      pos: { x: 8, y: 9 },
    });
  });
});

describe('resolveTick — kill sweep', () => {
  it('wolf moves onto a foreign sheep: sheep eaten, bonus scored, victim knocked out', () => {
    const state = makeState([
      player('a', { x: 1, y: 1 }, { x: 8, y: 8 }),
      player('b', { x: 5, y: 5 }, { x: 1, y: 2 }),
    ]);
    const result = resolveTick(state, [move('b', 'wolf', 'up')], KILL_BONUS, rngOf());
    expect(get(result.state, 'a').sheep).toBeNull();
    expect(get(result.state, 'b').score).toBe(KILL_BONUS);
    expect(result.events).toContainEqual({
      type: 'sheep-killed',
      victimId: 'a',
      killerId: 'b',
      pos: { x: 1, y: 1 },
    });
  });

  it('sheep moves onto a foreign wolf: eaten in the same tick', () => {
    const state = makeState([
      player('a', { x: 1, y: 1 }, { x: 8, y: 8 }),
      player('b', { x: 5, y: 5 }, { x: 2, y: 1 }),
    ]);
    const result = resolveTick(state, [move('a', 'sheep', 'right')], KILL_BONUS, rngOf());
    expect(get(result.state, 'a').sheep).toBeNull();
    expect(get(result.state, 'b').score).toBe(KILL_BONUS);
  });

  it('slip-past: a same-tick swap leaves no co-location, no kill', () => {
    const state = makeState([
      player('a', { x: 1, y: 1 }, { x: 8, y: 8 }),
      player('b', { x: 5, y: 5 }, { x: 2, y: 1 }),
    ]);
    const result = resolveTick(
      state,
      [move('a', 'sheep', 'right'), move('b', 'wolf', 'left')],
      KILL_BONUS,
      rngOf(),
    );
    expect(get(result.state, 'a').sheep).toEqual({ x: 2, y: 1 });
    expect(get(result.state, 'b').wolf).toEqual({ x: 1, y: 1 });
    expect(get(result.state, 'b').score).toBe(0);
  });

  it('a wolf moving away spares a sheep that stepped onto its cell', () => {
    const state = makeState([
      player('a', { x: 1, y: 1 }, { x: 8, y: 8 }),
      player('b', { x: 5, y: 5 }, { x: 2, y: 1 }),
    ]);
    const result = resolveTick(
      state,
      [move('a', 'sheep', 'right'), move('b', 'wolf', 'right')],
      KILL_BONUS,
      rngOf(),
    );
    expect(get(result.state, 'a').sheep).toEqual({ x: 2, y: 1 });
    expect(get(result.state, 'b').score).toBe(0);
  });

  it('contested empty cell: sheep arrives first, wolf lands on it, sweep kills', () => {
    const state = makeState([
      player('a', { x: 1, y: 1 }, { x: 8, y: 8 }),
      player('b', { x: 5, y: 5 }, { x: 3, y: 1 }),
    ]);
    const result = resolveTick(
      state,
      [move('a', 'sheep', 'right'), move('b', 'wolf', 'left')],
      KILL_BONUS,
      rngOf(),
    );
    expect(get(result.state, 'a').sheep).toBeNull();
    expect(get(result.state, 'b').wolf).toEqual({ x: 2, y: 1 });
    expect(get(result.state, 'b').score).toBe(KILL_BONUS);
  });

  it('a lonely wolf still kills; its knocked-out owner scores the bonus', () => {
    const state = makeState([
      player('a', null, { x: 2, y: 1 }), // knocked out earlier
      player('b', { x: 1, y: 1 }, { x: 8, y: 8 }),
      player('c', { x: 5, y: 5 }, { x: 9, y: 9 }),
    ]);
    const result = resolveTick(state, [move('b', 'sheep', 'right')], KILL_BONUS, rngOf());
    expect(get(result.state, 'b').sheep).toBeNull();
    expect(get(result.state, 'a').score).toBe(KILL_BONUS);
  });

  it('a wolf never kills its own sheep (adjacent, no move)', () => {
    const state = makeState([
      player('a', { x: 1, y: 1 }, { x: 2, y: 1 }),
      player('b', { x: 5, y: 5 }, { x: 9, y: 9 }),
    ]);
    const result = resolveTick(state, [], KILL_BONUS, rngOf());
    expect(get(result.state, 'a').sheep).toEqual({ x: 1, y: 1 });
    expect(get(result.state, 'a').score).toBe(0);
  });
});

describe('round end', () => {
  it('ends when one sheep remains', () => {
    const state = makeState([
      player('a', { x: 1, y: 1 }, { x: 8, y: 8 }),
      player('b', { x: 5, y: 5 }, { x: 1, y: 2 }),
    ]);
    const result = resolveTick(state, [move('b', 'wolf', 'up')], KILL_BONUS, rngOf());
    expect(result.roundEnded).toBe(true);
    expect(countAliveSheep(result.state)).toBe(1);
  });

  it('ends when two wolves eat the last two sheep in the same tick (zero left)', () => {
    const state = makeState([
      player('a', { x: 1, y: 1 }, { x: 5, y: 4 }),
      player('b', { x: 5, y: 5 }, { x: 1, y: 2 }),
    ]);
    const result = resolveTick(
      state,
      [move('a', 'wolf', 'down'), move('b', 'wolf', 'up')],
      KILL_BONUS,
      rngOf(),
    );
    expect(countAliveSheep(result.state)).toBe(0);
    expect(result.roundEnded).toBe(true);
    expect(get(result.state, 'a').score).toBe(KILL_BONUS);
    expect(get(result.state, 'b').score).toBe(KILL_BONUS);
  });

  it('does not end while two sheep are alive', () => {
    const state = makeState([
      player('a', { x: 1, y: 1 }, { x: 8, y: 8 }),
      player('b', { x: 5, y: 5 }, { x: 9, y: 9 }),
    ]);
    const result = resolveTick(state, [], KILL_BONUS, rngOf());
    expect(result.roundEnded).toBe(false);
  });
});

describe('applyPlayerExit', () => {
  it('removes the sheep without points and leaves a lonely wolf', () => {
    const state = makeState([
      player('a', { x: 1, y: 1 }, { x: 2, y: 2 }),
      player('b', { x: 5, y: 5 }, { x: 9, y: 9 }),
    ]);
    const next = applyPlayerExit(state, 'a');
    expect(get(next, 'a').sheep).toBeNull();
    expect(get(next, 'a').exited).toBe(true);
    expect(get(next, 'a').score).toBe(0);
    expect(isRoundOver(next)).toBe(true); // only b's sheep remains
  });
});

describe('growGrass', () => {
  it('adds one grass on an empty cell, never under an entity or existing grass', () => {
    const state: RoundState = {
      tick: 0,
      fieldSizeX: 2,
      fieldSizeY: 2,
      chessMode: false,
      grass: [{ x: 0, y: 0 }],
      players: [player('a', { x: 1, y: 0 }, { x: 0, y: 1 })],
    };
    // Only (1,1) is empty; any rng value must land there.
    const next = growGrass(state, 10, rngOf(0.7));
    expect(next.grass).toHaveLength(2);
    expect(next.grass).toContainEqual({ x: 1, y: 1 });
  });

  it('skips the spawn when the cap is reached or no cell is empty', () => {
    const capped = makeState([], [{ x: 0, y: 0 }]);
    expect(growGrass(capped, 1, rngOf()).grass).toHaveLength(1);

    const full: RoundState = {
      tick: 0,
      fieldSizeX: 1,
      fieldSizeY: 1,
      chessMode: false,
      grass: [],
      players: [player('a', { x: 0, y: 0 }, { x: 0, y: 0 })],
    };
    expect(growGrass(full, 10, rngOf()).grass).toHaveLength(0);
  });
});
