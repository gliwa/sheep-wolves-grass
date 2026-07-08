// Round-start placement (WBS 3): wolf+sheep pairs spread to maximize the
// minimum pairwise distance — corners for 2/4 players, evenly distributed
// otherwise (DECISIONS.md #17) — then initial grass on random empty cells.
// Which player gets which spot is drawn with the injected rng.

import type { PlayerId, Rng, RoundPlayer, RoundState, Vec2 } from '@swg/shared';

/** The lobby-side identity a round needs per player. */
export interface RoundSeat {
  id: PlayerId;
  letter: string;
}

export interface PlacementOptions {
  fieldSizeX: number;
  fieldSizeY: number;
  initialNofGrass: number;
  chessMode: boolean;
  players: RoundSeat[];
  rng: Rng;
}

interface Pair {
  wolf: Vec2;
  sheep: Vec2;
}

// Same encoding as rules.ts: field max is 200×200, so 1024 columns cannot collide.
function cellKey(pos: Vec2): number {
  return pos.y * 1024 + pos.x;
}

/** DECISIONS.md #28: sheep right of its wolf, mirrored left at the right wall. */
function sheepCellFor(wolf: Vec2, fieldSizeX: number): Vec2 {
  const x = wolf.x + 1 < fieldSizeX ? wolf.x + 1 : wolf.x - 1;
  return { x, y: wolf.y };
}

function squaredDistance(a: Vec2, b: Vec2): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * Pair layout per DECISIONS.md #17: 2 players take opposite corners and 4
 * take all corners (prescribed — on elongated fields the strict maximin
 * would prefer edge midpoints over the last two corners); every other count
 * is spread greedily farthest-point: anchor at (0,0), then each wolf takes a
 * cell (with room for its sheep) maximizing the distance to the nearest
 * placed wolf. Ties break in row-major scan order.
 */
function selectPairs(fieldSizeX: number, fieldSizeY: number, count: number): Pair[] {
  const occupied = new Set<number>();
  const pairs: Pair[] = [];
  const place = (wolf: Vec2): void => {
    const sheep = sheepCellFor(wolf, fieldSizeX);
    pairs.push({ wolf, sheep });
    occupied.add(cellKey(wolf));
    occupied.add(cellKey(sheep));
  };
  const corners: Vec2[] = [
    { x: 0, y: 0 },
    { x: fieldSizeX - 1, y: fieldSizeY - 1 },
    { x: fieldSizeX - 1, y: 0 },
    { x: 0, y: fieldSizeY - 1 },
  ];
  if (count === 2 || count === 4) {
    for (const corner of corners.slice(0, count)) place(corner);
  } else if (count > 0) {
    place({ x: 0, y: 0 });
  }
  while (pairs.length < count) {
    let best: Vec2 | null = null;
    let bestScore = -1;
    for (let y = 0; y < fieldSizeY; y++) {
      for (let x = 0; x < fieldSizeX; x++) {
        const wolf = { x, y };
        if (occupied.has(cellKey(wolf))) continue;
        if (occupied.has(cellKey(sheepCellFor(wolf, fieldSizeX)))) continue;
        let score = Infinity;
        for (const pair of pairs) score = Math.min(score, squaredDistance(wolf, pair.wolf));
        if (score > bestScore) {
          bestScore = score;
          best = wolf;
        }
      }
    }
    // Unreachable for configs that passed cross-param validation (DECISIONS.md #27).
    if (best === null) throw new Error(`no free cells to place pair ${pairs.length + 1}/${count}`);
    place(best);
  }
  return pairs;
}

/** Uniform Fisher-Yates; an all-zeros rng keeps the original order. */
function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const copy = [...items];
  for (let i = 0; i < copy.length - 1; i++) {
    const j = i + Math.floor(rng() * (copy.length - i));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

/** Draw `count` distinct empty cells for the initial grass. */
function drawGrassCells(
  fieldSizeX: number,
  fieldSizeY: number,
  count: number,
  occupied: ReadonlySet<number>,
  rng: Rng,
): Vec2[] {
  const empty: Vec2[] = [];
  for (let y = 0; y < fieldSizeY; y++) {
    for (let x = 0; x < fieldSizeX; x++) {
      if (!occupied.has(cellKey({ x, y }))) empty.push({ x, y });
    }
  }
  return shuffled(empty, rng).slice(0, count);
}

/**
 * Build the authoritative state for a fresh round (SPEC.md → Round
 * lifecycle): pairs first (their layout ignores grass), then grass on the
 * remaining empty cells, so pairs and initial grass never overlap.
 */
export function placeRound(options: PlacementOptions): RoundState {
  const { fieldSizeX, fieldSizeY, players, rng } = options;
  const pairs = selectPairs(fieldSizeX, fieldSizeY, players.length);
  const seatedPairs = shuffled(pairs, rng);
  const roundPlayers: RoundPlayer[] = players.map((player, i) => {
    const pair = seatedPairs[i]!;
    return {
      id: player.id,
      letter: player.letter,
      sheep: { ...pair.sheep },
      wolf: { ...pair.wolf },
      score: 0,
      exited: false,
    };
  });
  const occupied = new Set<number>();
  for (const pair of pairs) {
    occupied.add(cellKey(pair.wolf));
    occupied.add(cellKey(pair.sheep));
  }
  const grass = drawGrassCells(fieldSizeX, fieldSizeY, options.initialNofGrass, occupied, rng);
  return {
    tick: 0,
    fieldSizeX,
    fieldSizeY,
    chessMode: options.chessMode,
    grass,
    players: roundPlayers,
  };
}
