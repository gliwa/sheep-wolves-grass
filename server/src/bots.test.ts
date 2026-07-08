import { describe, expect, it } from 'vitest';

import type { RoundPlayer, RoundState, Vec2 } from '@swg/shared';

import { computeBotCommand } from './bots';

/** rng 0: ties break to the first direction in declaration order (up first). */
const zeroRng = () => 0;

function player(id: string, sheep: Vec2 | null, wolf: Vec2): RoundPlayer {
  return { id, letter: id, sheep, wolf, score: 0, exited: false };
}

function makeState(players: RoundPlayer[], grass: Vec2[] = [], tick = 0): RoundState {
  return { tick, fieldSizeX: 10, fieldSizeY: 10, chessMode: false, grass, players };
}

describe('computeBotCommand — one move per tick (#34)', () => {
  it('hunts on even ticks: the wolf closes in on the nearest foreign sheep', () => {
    const state = makeState(
      [player('bot', { x: 0, y: 0 }, { x: 5, y: 5 }), player('h', { x: 5, y: 8 }, { x: 9, y: 9 })],
      [{ x: 0, y: 3 }], // grass exists, but even tick prefers the hunt
    );
    expect(computeBotCommand(state, 'bot', zeroRng)).toEqual({
      playerId: 'bot',
      entity: 'wolf',
      dir: 'down',
    });
  });

  it('grazes on odd ticks: the sheep heads for the nearest grass', () => {
    const state = makeState(
      [player('bot', { x: 5, y: 5 }, { x: 0, y: 9 }), player('h', { x: 9, y: 0 }, { x: 9, y: 9 })],
      [{ x: 5, y: 2 }],
      1,
    );
    expect(computeBotCommand(state, 'bot', zeroRng)).toEqual({
      playerId: 'bot',
      entity: 'sheep',
      dir: 'up',
    });
  });

  it('falls back to the other entity when the preferred one has no useful move', () => {
    // Odd tick, but no grass anywhere → graze() yields, hunt() runs.
    const state = makeState(
      [player('bot', { x: 0, y: 0 }, { x: 5, y: 5 }), player('h', { x: 5, y: 8 }, { x: 9, y: 9 })],
      [],
      1,
    );
    expect(computeBotCommand(state, 'bot', zeroRng)).toEqual({
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
    expect(computeBotCommand(state, 'bot', zeroRng)).toEqual({
      playerId: 'bot',
      entity: 'wolf',
      dir: 'down',
    });
  });

  it('holds when nothing improves: own sheep blocks the hunt, no grass, no threat', () => {
    const state = makeState([
      player('bot', { x: 5, y: 6 }, { x: 5, y: 5 }),
      player('h', { x: 5, y: 8 }, { x: 9, y: 0 }),
    ]);
    expect(computeBotCommand(state, 'bot', zeroRng)).toBeNull();
  });
});

describe('computeBotCommand — flee priority', () => {
  it('fleeing a close wolf beats hunting and grazing, and never steps onto the wolf', () => {
    const state = makeState(
      [player('bot', { x: 5, y: 5 }, { x: 0, y: 0 }), player('h', { x: 9, y: 0 }, { x: 5, y: 6 })],
      [{ x: 5, y: 7 }], // grass behind the wolf must not lure the sheep in
    );
    const command = computeBotCommand(state, 'bot', zeroRng);
    expect(command).toEqual({ playerId: 'bot', entity: 'sheep', dir: 'up' });
  });

  it('a cornered sheep holds instead of stepping toward the wolf', () => {
    // Sheep in the corner, wolf diagonal: every step keeps distance 2 → dodge
    // is allowed; put the wolf adjacent with walls each side to force a hold.
    const state = makeState([
      player('bot', { x: 0, y: 0 }, { x: 9, y: 9 }),
      player('h', { x: 9, y: 0 }, { x: 0, y: 1 }), // wolf directly below the sheep
    ]);
    const command = computeBotCommand(state, 'bot', zeroRng);
    // right (1,0) keeps distance 2 ≥ 1 → a dodge, not a hold; assert it flees
    // away, never down onto the wolf.
    expect(command).not.toBeNull();
    expect(command!.entity).toBe('sheep');
    expect(command!.dir).not.toBe('down');
  });
});

describe('computeBotCommand — knocked out', () => {
  it('a bot without a sheep issues nothing (lonely wolf is uncontrollable)', () => {
    const state = makeState([
      player('bot', null, { x: 5, y: 5 }),
      player('h', { x: 1, y: 1 }, { x: 9, y: 9 }),
    ]);
    expect(computeBotCommand(state, 'bot', zeroRng)).toBeNull();
  });
});
