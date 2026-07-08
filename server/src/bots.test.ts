import { describe, expect, it } from 'vitest';

import type { RoundPlayer, RoundState, Vec2 } from '@swg/shared';

import { computeBotCommands } from './bots';

/** rng 0: ties break to the first direction in declaration order (up first). */
const zeroRng = () => 0;

function player(id: string, sheep: Vec2 | null, wolf: Vec2): RoundPlayer {
  return { id, letter: id, sheep, wolf, score: 0, exited: false };
}

function makeState(players: RoundPlayer[], grass: Vec2[] = []): RoundState {
  return { tick: 0, fieldSizeX: 10, fieldSizeY: 10, chessMode: false, grass, players };
}

describe('computeBotCommands — wolf', () => {
  it('closes in on the nearest foreign sheep', () => {
    const state = makeState([
      player('bot', { x: 0, y: 0 }, { x: 5, y: 5 }),
      player('h', { x: 5, y: 8 }, { x: 9, y: 9 }),
    ]);
    expect(computeBotCommands(state, 'bot', zeroRng)).toContainEqual({
      playerId: 'bot',
      entity: 'wolf',
      dir: 'down',
    });
  });

  it('steps onto an adjacent foreign sheep (the kill move)', () => {
    const state = makeState([
      player('bot', { x: 0, y: 0 }, { x: 5, y: 5 }),
      player('h', { x: 5, y: 6 }, { x: 9, y: 9 }),
    ]);
    expect(computeBotCommands(state, 'bot', zeroRng)).toContainEqual({
      playerId: 'bot',
      entity: 'wolf',
      dir: 'down',
    });
  });

  it('holds instead of detouring when the own sheep blocks the only closing step', () => {
    const state = makeState([
      player('bot', { x: 5, y: 6 }, { x: 5, y: 5 }),
      player('h', { x: 5, y: 8 }, { x: 9, y: 0 }),
    ]);
    const wolfCommands = computeBotCommands(state, 'bot', zeroRng).filter(
      (c) => c.entity === 'wolf',
    );
    expect(wolfCommands).toEqual([]);
  });
});

describe('computeBotCommands — sheep', () => {
  it('flees a foreign wolf within reach, never onto it', () => {
    const state = makeState([
      player('bot', { x: 5, y: 5 }, { x: 0, y: 0 }),
      player('h', { x: 9, y: 0 }, { x: 5, y: 6 }),
    ]);
    const sheepCommand = computeBotCommands(state, 'bot', zeroRng).find(
      (c) => c.entity === 'sheep',
    );
    expect(sheepCommand).toBeDefined();
    expect(sheepCommand!.dir).not.toBe('down'); // 'down' would be the wolf's cell
    expect(sheepCommand!.dir).toBe('up'); // farthest of the allowed steps
  });

  it('grazes toward the nearest grass when no wolf is close', () => {
    const state = makeState(
      [player('bot', { x: 5, y: 5 }, { x: 0, y: 0 }), player('h', { x: 9, y: 0 }, { x: 9, y: 9 })],
      [{ x: 5, y: 2 }],
    );
    expect(computeBotCommands(state, 'bot', zeroRng)).toContainEqual({
      playerId: 'bot',
      entity: 'sheep',
      dir: 'up',
    });
  });

  it('holds when there is no grass and no threat', () => {
    const state = makeState([
      player('bot', { x: 5, y: 5 }, { x: 0, y: 0 }),
      player('h', { x: 9, y: 0 }, { x: 9, y: 9 }),
    ]);
    const sheepCommands = computeBotCommands(state, 'bot', zeroRng).filter(
      (c) => c.entity === 'sheep',
    );
    expect(sheepCommands).toEqual([]);
  });
});

describe('computeBotCommands — knocked out', () => {
  it('a bot without a sheep issues nothing (lonely wolf is uncontrollable)', () => {
    const state = makeState([
      player('bot', null, { x: 5, y: 5 }),
      player('h', { x: 1, y: 1 }, { x: 9, y: 9 }),
    ]);
    expect(computeBotCommands(state, 'bot', zeroRng)).toEqual([]);
  });
});
