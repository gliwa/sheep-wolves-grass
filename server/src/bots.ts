// Bot players (WBS 4): a deliberately light heuristic — the wolf hunts the
// nearest foreign sheep, the sheep flees a nearby wolf and grazes otherwise.
// Bots issue the same MoveCommands as humans (≤1 per entity per tick) and go
// through the identical phase-b validation; ties between equally good
// directions break via the injected rng.

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
 * The bot's commands for one tick: up to one wolf move (hunting) and one
 * sheep move (fleeing or grazing). A knocked-out or exited bot has only an
 * uncontrollable lonely wolf left, so it issues nothing.
 */
export function computeBotCommands(state: RoundState, botId: PlayerId, rng: Rng): MoveCommand[] {
  const bot = state.players.find((p) => p.id === botId);
  if (bot === undefined || bot.exited || bot.sheep === null) return [];
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

  const commands: MoveCommand[] = [];

  // Wolf: close in on the nearest foreign sheep, but only with a strictly
  // improving step — otherwise hold. Stepping onto the prey is the kill and
  // is allowed; walls, wolves and the own sheep block (as in phase b).
  const prey = nearest(bot.wolf, foreignSheep);
  if (prey !== null) {
    const wolfAllowed = (target: Vec2): boolean =>
      inBounds(state, target) &&
      !anyWolves.some((w) => samePos(w, target)) &&
      !samePos(botSheep, target);
    const step = bestStep(bot.wolf, wolfAllowed, (t) => -manhattan(t, prey), rng);
    if (step !== null && -step.score < manhattan(bot.wolf, prey)) {
      commands.push({ playerId: botId, entity: 'wolf', dir: step.dir });
    }
  }

  // Sheep: never step onto any wolf (foreign is suicide, own is invalid).
  const sheepAllowed = (target: Vec2): boolean =>
    inBounds(state, target) &&
    !anySheep.some((s) => samePos(s, target)) &&
    !anyWolves.some((w) => samePos(w, target));
  const threat = nearest(botSheep, foreignWolves);
  if (threat !== null && manhattan(botSheep, threat) <= FLEE_DISTANCE) {
    // Flee: take the step that maximizes the distance to the threat, as long
    // as it doesn't get closer (a sideways dodge is fine when cornered).
    const step = bestStep(botSheep, sheepAllowed, (t) => manhattan(t, threat), rng);
    if (step !== null && step.score >= manhattan(botSheep, threat)) {
      commands.push({ playerId: botId, entity: 'sheep', dir: step.dir });
    }
  } else {
    const grass = nearest(botSheep, state.grass);
    if (grass !== null) {
      const step = bestStep(botSheep, sheepAllowed, (t) => -manhattan(t, grass), rng);
      if (step !== null && -step.score < manhattan(botSheep, grass)) {
        commands.push({ playerId: botId, entity: 'sheep', dir: step.dir });
      }
    }
  }

  return commands;
}
