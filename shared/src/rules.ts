// Pure game rules: the tick phase model (SPEC.md → Movement & tick
// resolution, DECISIONS.md #23) and grass growth. No I/O, no timers, no
// global state — randomness comes in through an injected rng, so every
// outcome is reproducible in tests.

import type { TickEvent } from './protocol';
import type { Direction, EntityKind, PlayerId, RoundPlayer, RoundState, Vec2 } from './state';
import { DIRECTION_DELTAS, inBounds, isRoundOver } from './state';

/** Uniform random in [0, 1) — Math.random-compatible, injectable for tests. */
export type Rng = () => number;

export interface MoveCommand {
  playerId: PlayerId;
  entity: EntityKind;
  dir: Direction;
}

export interface TickResult {
  state: RoundState;
  events: TickEvent[];
  roundEnded: boolean;
}

function cellKey(pos: Vec2): number {
  // Field max is 200×200, so 1024 columns cannot collide.
  return pos.y * 1024 + pos.x;
}

function cloneState(state: RoundState): RoundState {
  return {
    ...state,
    grass: state.grass.map((g) => ({ ...g })),
    players: state.players.map((p) => ({
      ...p,
      sheep: p.sheep === null ? null : { ...p.sheep },
      wolf: { ...p.wolf },
    })),
  };
}

/** ≤1 command per entity per tick: if duplicates slip through, the last one wins. */
function dedupeCommands(commands: MoveCommand[]): MoveCommand[] {
  const byEntity = new Map<string, MoveCommand>();
  for (const command of commands) {
    byEntity.set(`${command.playerId}/${command.entity}`, command);
  }
  return [...byEntity.values()];
}

interface ValidMove {
  player: RoundPlayer;
  entity: EntityKind;
  target: Vec2;
}

/**
 * Phase (b): validate a command against positions as of tick start. Invalid
 * targets — walls, the player's own entities, same-type entities — make the
 * move a no-op. The only permitted collisions are wolf→foreign sheep and
 * sheep→foreign wolf, both resolved by the kill sweep.
 */
function validateCommand(
  state: RoundState,
  command: MoveCommand,
  sheepAt: Map<number, PlayerId>,
  wolfAt: Map<number, PlayerId>,
): ValidMove | null {
  const player = state.players.find((p) => p.id === command.playerId);
  if (player === undefined || player.exited) return null;
  // A knocked-out or exited player's wolf is a lonely wolf — uncontrollable.
  if (player.sheep === null) return null;

  const from = command.entity === 'sheep' ? player.sheep : player.wolf;
  const delta = DIRECTION_DELTAS[command.dir];
  const target = { x: from.x + delta.x, y: from.y + delta.y };

  if (!inBounds(state, target)) return null;
  const key = cellKey(target);
  const sheepOwner = sheepAt.get(key);
  const wolfOwner = wolfAt.get(key);
  if (command.entity === 'sheep') {
    if (sheepOwner !== undefined) return null; // sheep→any sheep
    if (wolfOwner === command.playerId) return null; // own wolf
  } else {
    if (wolfOwner !== undefined) return null; // wolf→any wolf
    if (sheepOwner === command.playerId) return null; // own sheep
  }
  return { player, entity: command.entity, target };
}

/**
 * Phases (c)/(d): apply all moves of one entity kind. If several movers
 * contest the same target cell, a random one moves and the others hold.
 * Returns the winners so the caller can apply grass effects.
 */
function moveEntities(moves: ValidMove[], rng: Rng): ValidMove[] {
  const byTarget = new Map<number, ValidMove[]>();
  for (const move of moves) {
    const key = cellKey(move.target);
    const group = byTarget.get(key);
    if (group === undefined) byTarget.set(key, [move]);
    else group.push(move);
  }
  const winners: ValidMove[] = [];
  for (const group of byTarget.values()) {
    const winner = group.length === 1 ? group[0]! : group[Math.floor(rng() * group.length)]!;
    if (winner.entity === 'sheep') winner.player.sheep = winner.target;
    else winner.player.wolf = winner.target;
    winners.push(winner);
  }
  return winners;
}

function removeGrassAt(state: RoundState, pos: Vec2): boolean {
  const index = state.grass.findIndex((g) => g.x === pos.x && g.y === pos.y);
  if (index === -1) return false;
  state.grass.splice(index, 1);
  return true;
}

/**
 * Resolve one tick (one turn in chess mode) through the fixed phases:
 * validate → move sheep (eat) → move wolves (trample) → kill sweep →
 * round-end check. Input collection (phase a) is the server's job; this
 * function assumes ≤1 command per entity and keeps the last on duplicates.
 */
export function resolveTick(
  state: RoundState,
  commands: MoveCommand[],
  sheepKillBonus: number,
  rng: Rng,
): TickResult {
  const next = cloneState(state);
  next.tick += 1;
  const events: TickEvent[] = [];

  // Tick-start occupancy, the reference for all validation.
  const sheepAt = new Map<number, PlayerId>();
  const wolfAt = new Map<number, PlayerId>();
  for (const player of next.players) {
    if (player.sheep !== null) sheepAt.set(cellKey(player.sheep), player.id);
    wolfAt.set(cellKey(player.wolf), player.id);
  }

  const validMoves = dedupeCommands(commands)
    .map((command) => validateCommand(next, command, sheepAt, wolfAt))
    .filter((move): move is ValidMove => move !== null);

  // Phase (c): all sheep move; a sheep landing on grass eats it (+1).
  const sheepWinners = moveEntities(
    validMoves.filter((m) => m.entity === 'sheep'),
    rng,
  );
  for (const move of sheepWinners) {
    if (removeGrassAt(next, move.target)) {
      move.player.score += 1;
      events.push({ type: 'grass-eaten', playerId: move.player.id, pos: { ...move.target } });
    }
  }

  // Phase (d): all wolves move; a wolf landing on grass tramples it.
  const wolfWinners = moveEntities(
    validMoves.filter((m) => m.entity === 'wolf'),
    rng,
  );
  for (const move of wolfWinners) {
    if (removeGrassAt(next, move.target)) {
      events.push({ type: 'grass-trampled', playerId: move.player.id, pos: { ...move.target } });
    }
  }

  // Phase (e): kill sweep — every sheep sharing a cell with another player's
  // wolf is eaten, regardless of who moved onto whom. Wolves are unique per
  // cell (same-type targets are invalid), so the killer is unambiguous.
  const wolfAtEnd = new Map<number, RoundPlayer>();
  for (const player of next.players) wolfAtEnd.set(cellKey(player.wolf), player);
  for (const victim of next.players) {
    if (victim.sheep === null) continue;
    const killer = wolfAtEnd.get(cellKey(victim.sheep));
    if (killer !== undefined && killer.id !== victim.id) {
      killer.score += sheepKillBonus;
      events.push({
        type: 'sheep-killed',
        victimId: victim.id,
        killerId: killer.id,
        pos: { ...victim.sheep },
      });
      victim.sheep = null;
    }
  }

  return { state: next, events, roundEnded: isRoundOver(next) };
}

/**
 * A player exits mid-round (DECISIONS.md #11): the sheep is removed without
 * awarding points and the wolf stays behind as a lonely wolf. The caller
 * re-checks isRoundOver afterwards.
 */
export function applyPlayerExit(state: RoundState, playerId: PlayerId): RoundState {
  const next = cloneState(state);
  const player = next.players.find((p) => p.id === playerId);
  if (player !== undefined) {
    player.sheep = null;
    player.exited = true;
  }
  return next;
}

/**
 * Grow one grass on a random empty cell (no grass, no sheep, no wolf),
 * respecting the cap. If the field is full or the cap is reached, the spawn
 * is skipped, not deferred. Scheduling (rate or chess tick cadence) is the
 * server's job.
 */
export function growGrass(state: RoundState, maxNofGrass: number, rng: Rng): RoundState {
  if (state.grass.length >= maxNofGrass) return state;
  const occupied = new Set<number>();
  for (const grass of state.grass) occupied.add(cellKey(grass));
  for (const player of state.players) {
    if (player.sheep !== null) occupied.add(cellKey(player.sheep));
    occupied.add(cellKey(player.wolf));
  }
  const empty: Vec2[] = [];
  for (let y = 0; y < state.fieldSizeY; y++) {
    for (let x = 0; x < state.fieldSizeX; x++) {
      if (!occupied.has(cellKey({ x, y }))) empty.push({ x, y });
    }
  }
  if (empty.length === 0) return state;
  const next = cloneState(state);
  next.grass.push(empty[Math.floor(rng() * empty.length)]!);
  return next;
}
