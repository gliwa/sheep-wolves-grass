import { describe, expect, it } from 'vitest';

import type { Rng, RoundState, Vec2 } from '@swg/shared';

import type { RoundSeat } from './placement';
import { placeRound } from './placement';

/** Identity rng: keeps seating order and picks grass cells in scan order. */
const zeroRng: Rng = () => 0;

function seats(count: number): RoundSeat[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    letter: String.fromCharCode(97 + i),
  }));
}

function place(
  count: number,
  overrides: Partial<Parameters<typeof placeRound>[0]> = {},
): RoundState {
  return placeRound({
    fieldSizeX: 50,
    fieldSizeY: 30,
    initialNofGrass: 0,
    chessMode: false,
    players: seats(count),
    rng: zeroRng,
    ...overrides,
  });
}

function wolves(state: RoundState): Vec2[] {
  return state.players.map((p) => p.wolf);
}

function allCells(state: RoundState): Vec2[] {
  const cells = [...state.grass];
  for (const player of state.players) {
    if (player.sheep !== null) cells.push(player.sheep);
    cells.push(player.wolf);
  }
  return cells;
}

describe('placeRound — pair layout', () => {
  it('puts 2 players in opposite corners', () => {
    const state = place(2);
    expect(wolves(state)).toContainEqual({ x: 0, y: 0 });
    expect(wolves(state)).toContainEqual({ x: 49, y: 29 });
  });

  it('puts 4 players in all four corners', () => {
    const state = place(4);
    for (const corner of [
      { x: 0, y: 0 },
      { x: 49, y: 29 },
      { x: 49, y: 0 },
      { x: 0, y: 29 },
    ]) {
      expect(wolves(state)).toContainEqual(corner);
    }
  });

  it('sheep sits right of its wolf, mirrored left at the right wall (DECISIONS #28)', () => {
    const state = place(4);
    for (const player of state.players) {
      const expectedX = player.wolf.x + 1 < 50 ? player.wolf.x + 1 : player.wolf.x - 1;
      expect(player.sheep).toEqual({ x: expectedX, y: player.wolf.y });
    }
    // The two right-edge corners actually exercise the mirror.
    const mirrored = state.players.filter((p) => p.wolf.x === 49);
    expect(mirrored).toHaveLength(2);
  });

  it('spreads 3 players with a large minimum pairwise distance', () => {
    const state = place(3);
    const anchors = wolves(state);
    let minDistance = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      for (let j = i + 1; j < anchors.length; j++) {
        const a = anchors[i]!;
        const b = anchors[j]!;
        minDistance = Math.min(minDistance, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    // At least the short field side — three corners achieve exactly this.
    expect(minDistance).toBeGreaterThanOrEqual(29);
  });

  it('assigns spots to players via the rng (fair seating)', () => {
    // With this rng the 2-player shuffle swaps: floor(0.99 * 2) = 1.
    const swapped = place(2, { rng: () => 0.99 });
    expect(swapped.players[0]!.wolf).toEqual({ x: 49, y: 29 });
    expect(swapped.players[1]!.wolf).toEqual({ x: 0, y: 0 });
  });
});

describe('placeRound — grass & invariants', () => {
  it('places the exact grass count with no overlaps, all in bounds', () => {
    const state = place(8, { fieldSizeX: 10, fieldSizeY: 10, initialNofGrass: 20 });
    expect(state.grass).toHaveLength(20);
    const cells = allCells(state);
    expect(new Set(cells.map((c) => `${c.x},${c.y}`)).size).toBe(cells.length); // 16 + 20 unique
    for (const cell of cells) {
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.x).toBeLessThan(10);
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeLessThan(10);
    }
  });

  it('handles maximum density: 26 pairs + 48 grass fill a 10×10 field exactly', () => {
    // The cross-param limit (DECISIONS #27): 48 + 2×26 = 100 interior cells.
    const state = place(26, { fieldSizeX: 10, fieldSizeY: 10, initialNofGrass: 48 });
    const cells = allCells(state);
    expect(cells).toHaveLength(100);
    expect(new Set(cells.map((c) => `${c.x},${c.y}`)).size).toBe(100);
  });

  it('builds a fresh round state: tick 0, scores 0, flags passed through', () => {
    const state = place(2, { chessMode: true, initialNofGrass: 5 });
    expect(state.tick).toBe(0);
    expect(state.chessMode).toBe(true);
    expect(state.fieldSizeX).toBe(50);
    expect(state.fieldSizeY).toBe(30);
    expect(state.grass).toHaveLength(5);
    expect(state.players.map((p) => p.id)).toEqual(['p0', 'p1']);
    for (const player of state.players) {
      expect(player.score).toBe(0);
      expect(player.exited).toBe(false);
    }
  });
});
