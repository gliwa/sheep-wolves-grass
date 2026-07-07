// Game-state model: field, entities, players, and the player-status state
// machine. All types are plain JSON-serializable data so round state can be
// sent over the play API as-is. See SPEC.md → Game specification.

export interface Vec2 {
  x: number;
  y: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export const DIRECTION_DELTAS: Record<Direction, Vec2> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export type EntityKind = 'sheep' | 'wolf';

/** Server-assigned opaque player id (stable for the connection's lifetime). */
export type PlayerId = string;

export const GRASS_CHAR = ',';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** Player letter by join index: sheep renders lowercase, wolf uppercase. */
export function letterForIndex(index: number): string {
  const letter = LETTERS[index];
  if (letter === undefined) throw new Error(`no letter for player index ${index}`);
  return letter;
}

/**
 * Player status across lobby and round (SPEC.md → Screens, Round lifecycle):
 * - waiting      on the start screen, not ready yet
 * - ready        pressed P (irreversible, DECISIONS.md #10) — or bot after a round
 * - playing      in a round with a live sheep
 * - knocked-out  sheep eaten; wolf remains as an uncontrollable lonely wolf
 * - left         exited (E) or disconnected; terminal, a reload joins as a new player
 */
export type PlayerStatus = 'waiting' | 'ready' | 'playing' | 'knocked-out' | 'left';

export const PLAYER_STATUS_TRANSITIONS: Record<PlayerStatus, readonly PlayerStatus[]> = {
  waiting: ['ready', 'left'],
  ready: ['playing', 'left'],
  // Round end: humans go back to 'waiting', bots straight to 'ready'.
  playing: ['knocked-out', 'waiting', 'ready', 'left'],
  'knocked-out': ['waiting', 'ready', 'left'],
  left: [],
};

export function canTransition(from: PlayerStatus, to: PlayerStatus): boolean {
  return PLAYER_STATUS_TRANSITIONS[from].includes(to);
}

/** A player as listed on the start screen (persists across rounds). */
export interface LobbyPlayer {
  id: PlayerId;
  letter: string;
  name: string;
  /** Index into cfgColors; sheep and wolf share the color (DECISIONS.md #21). */
  colorIndex: number;
  isBot: boolean;
  status: PlayerStatus;
  roundsPlayed: number;
  /** Accumulated across rounds; in-memory only (DECISIONS.md #15). */
  totalScore: number;
  chessVote: boolean;
}

/** A player's per-round presence on the field. */
export interface RoundPlayer {
  id: PlayerId;
  letter: string;
  /** null once eaten or removed on exit — the wolf stays as a lonely wolf. */
  sheep: Vec2 | null;
  wolf: Vec2;
  /** This round's score (grazing + kill bonuses); scored even when knocked out. */
  score: number;
  exited: boolean;
}

/** Authoritative per-round world state; coordinates are 0-based interior cells. */
export interface RoundState {
  tick: number;
  fieldSizeX: number;
  fieldSizeY: number;
  chessMode: boolean;
  grass: Vec2[];
  players: RoundPlayer[];
}

export function inBounds(state: RoundState, pos: Vec2): boolean {
  return pos.x >= 0 && pos.x < state.fieldSizeX && pos.y >= 0 && pos.y < state.fieldSizeY;
}

export function countAliveSheep(state: RoundState): number {
  return state.players.filter((p) => p.sheep !== null).length;
}

/** Round ends once at most one sheep remains (DECISIONS.md #1). */
export function isRoundOver(state: RoundState): boolean {
  return countAliveSheep(state) <= 1;
}
