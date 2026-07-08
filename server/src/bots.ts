// Bot players (WBS 4): a deliberately light heuristic. Like every player, a
// bot issues at most ONE move per tick — sheep or wolf (DECISIONS.md #34) —
// so it has to split its attention: a threatened sheep flees first,
// otherwise the bot alternates between hunting with the wolf and grazing
// with the sheep. Commands go through the identical phase-b validation as
// human input; ties between equally good directions break via the injected
// rng. How often a bot acts at all is the lobby's job (cfgBotSpeedThrottle).

import type { Direction, MoveCommand, PlayerId, Rng, RoundState, Vec2 } from '@swg/shared';
import { DIRECTION_DELTAS, inBounds } from '@swg/shared';

const DIRECTIONS = Object.keys(DIRECTION_DELTAS) as Direction[];

/** How close a wolf must be (Manhattan) before a bot sheep flees instead of grazing. */
const FLEE_DISTANCE = 2;

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function samePos(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

function nearest(from: Vec2, targets: Vec2[]): Vec2 | null {
  let best: Vec2 | null = null;
  let bestDistance = Infinity;
  for (const target of targets) {
    const distance = manhattan(from, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  return best;
}

/** Highest-scoring allowed step from `from`; ties break via rng. */
function bestStep(
  from: Vec2,
  isAllowed: (target: Vec2) => boolean,
  score: (target: Vec2) => number,
  rng: Rng,
): { dir: Direction; score: number } | null {
  let best: Direction[] = [];
  let bestScore = -Infinity;
  for (const dir of DIRECTIONS) {
    const delta = DIRECTION_DELTAS[dir];
    const target = { x: from.x + delta.x, y: from.y + delta.y };
    if (!isAllowed(target)) continue;
    const s = score(target);
    if (s > bestScore) {
      bestScore = s;
      best = [dir];
    } else if (s === bestScore) {
      best.push(dir);
    }
  }
  const dir = best[Math.floor(rng() * best.length)];
  return dir === undefined ? null : { dir, score: bestScore };
}

/**
 * The bot's single command for this tick, or null to hold. Priority: flee a
 * close wolf; otherwise alternate hunt (even ticks) and graze (odd ticks),
 * falling back to the other when the preferred entity has no useful move.
 * A knocked-out or exited bot has only an uncontrollable lonely wolf left,
 * so it issues nothing.
 */
export function computeBotCommand(
  state: RoundState,
  botId: PlayerId,
  rng: Rng,
): MoveCommand | null {
  const bot = state.players.find((p) => p.id === botId);
  if (bot === undefined || bot.exited || bot.sheep === null) return null;
  const botSheep = bot.sheep;

  const foreignSheep: Vec2[] = [];
  const foreignWolves: Vec2[] = [];
  const anySheep: Vec2[] = [];
  const anyWolves: Vec2[] = [];
  for (const player of state.players) {
    anyWolves.push(player.wolf);
    if (player.sheep !== null) anySheep.push(player.sheep);
    if (player.id === botId) continue;
    foreignWolves.push(player.wolf);
    if (player.sheep !== null) foreignSheep.push(player.sheep);
  }

  // Sheep steps: never onto any wolf (foreign is suicide, own is invalid).
  const sheepAllowed = (target: Vec2): boolean =>
    inBounds(state, target) &&
    !anySheep.some((s) => samePos(s, target)) &&
    !anyWolves.some((w) => samePos(w, target));

  // Flee first: take the step that maximizes the distance to the closest
  // wolf, as long as it doesn't get closer (a sideways dodge counts).
  const threat = nearest(botSheep, foreignWolves);
  if (threat !== null && manhattan(botSheep, threat) <= FLEE_DISTANCE) {
    const step = bestStep(botSheep, sheepAllowed, (t) => manhattan(t, threat), rng);
    if (step !== null && step.score >= manhattan(botSheep, threat)) {
      return { playerId: botId, entity: 'sheep', dir: step.dir };
    }
    return null; // cornered — hold rather than step toward the wolf
  }

  // Wolf: close in on the nearest foreign sheep, but only with a strictly
  // improving step. Stepping onto the prey is the kill and is allowed;
  // walls, wolves and the own sheep block (as in phase b).
  const hunt = (): MoveCommand | null => {
    const prey = nearest(bot.wolf, foreignSheep);
    if (prey === null) return null;
    const wolfAllowed = (target: Vec2): boolean =>
      inBounds(state, target) &&
      !anyWolves.some((w) => samePos(w, target)) &&
      !samePos(botSheep, target);
    const step = bestStep(bot.wolf, wolfAllowed, (t) => -manhattan(t, prey), rng);
    if (step !== null && -step.score < manhattan(bot.wolf, prey)) {
      return { playerId: botId, entity: 'wolf', dir: step.dir };
    }
    return null;
  };

  const graze = (): MoveCommand | null => {
    const grass = nearest(botSheep, state.grass);
    if (grass === null) return null;
    const step = bestStep(botSheep, sheepAllowed, (t) => -manhattan(t, grass), rng);
    if (step !== null && -step.score < manhattan(botSheep, grass)) {
      return { playerId: botId, entity: 'sheep', dir: step.dir };
    }
    return null;
  };

  return state.tick % 2 === 0 ? (hunt() ?? graze()) : (graze() ?? hunt());
}
