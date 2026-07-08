import { describe, expect, it } from 'vitest';

import { directionForKey, handleKey } from './input';
import { activeState, lobbyPlayer, roundState } from './state.test';

describe('directionForKey', () => {
  it('maps arrow keys and nothing else', () => {
    expect(directionForKey('ArrowUp')).toBe('up');
    expect(directionForKey('ArrowDown')).toBe('down');
    expect(directionForKey('ArrowLeft')).toBe('left');
    expect(directionForKey('ArrowRight')).toBe('right');
    expect(directionForKey('w')).toBeNull();
  });
});

describe('handleKey — start screen', () => {
  it('maps P/B/C/E to their messages', () => {
    const state = activeState();
    expect(handleKey(state, 'p').send).toEqual({ type: 'ready' });
    expect(handleKey(state, 'B').send).toEqual({ type: 'addBot' });
    expect(handleKey(state, 'c').send).toEqual({ type: 'voteChess' });
    const exit = handleKey(state, 'E');
    expect(exit.send).toEqual({ type: 'exit' });
    expect(exit.exit).toBe(true);
    expect(handleKey(state, 'x')).toEqual({});
  });

  it("Enter opens the editor with the current name — only while 'waiting'", () => {
    const waiting = activeState();
    expect(handleKey(waiting, 'Enter').draft).toBe('Player me');

    const ready = activeState({
      lobby: {
        players: [lobbyPlayer('me', { status: 'ready' })],
        countdownSeconds: null,
        chessMode: false,
      },
    });
    expect(handleKey(ready, 'Enter')).toEqual({});
  });

  it('ignores everything when the client is not active', () => {
    const left = activeState({ phase: 'left' });
    expect(handleKey(left, 'p')).toEqual({});
  });
});

describe('handleKey — name editor', () => {
  it('types, deletes, confirms and cancels', () => {
    const editing = activeState({ nameDraft: 'Ali' });
    expect(handleKey(editing, 'c').draft).toBe('Alic');
    expect(handleKey(editing, 'Backspace').draft).toBe('Al');
    expect(handleKey(editing, 'Escape')).toEqual({ draft: null }); // restore
    const confirm = handleKey(activeState({ nameDraft: '  Alice ' }), 'Enter');
    expect(confirm.send).toEqual({ type: 'setName', name: 'Alice' });
    expect(confirm.draft).toBeNull();
  });

  it('caps the draft at the protocol name length and ignores an empty confirm', () => {
    const full = activeState({ nameDraft: 'x'.repeat(24) });
    expect(handleKey(full, 'y')).toEqual({});
    const empty = handleKey(activeState({ nameDraft: '   ' }), 'Enter');
    expect(empty.send).toBeUndefined();
    expect(empty.draft).toBeNull();
  });

  it('does not treat start-screen keys as commands while editing', () => {
    const editing = activeState({ nameDraft: '' });
    expect(handleKey(editing, 'p').send).toBeUndefined();
    expect(handleKey(editing, 'p').draft).toBe('p');
  });
});

describe('handleKey — play screen', () => {
  it('only E does anything (movement is handled by the repeater)', () => {
    const playing = activeState({ round: roundState(['me', 'other']) });
    expect(handleKey(playing, 'p')).toEqual({});
    expect(handleKey(playing, 'Enter')).toEqual({});
    const exit = handleKey(playing, 'e');
    expect(exit.send).toEqual({ type: 'exit' });
    expect(exit.exit).toBe(true);
  });
});
