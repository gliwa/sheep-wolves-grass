import { describe, expect, it } from 'vitest';

import type { LobbyPlayer, LobbySnapshot, RoundState } from '@swg/shared';
import { DEFAULT_CONFIG } from '@swg/shared';

import type { AppState } from './state';
import { applyServerMessage, countdownSecondsLeft, initialState, isOnPlayScreen } from './state';

const NOW = 1_000_000;

export function lobbyPlayer(id: string, overrides: Partial<LobbyPlayer> = {}): LobbyPlayer {
  return {
    id,
    letter: 'a',
    name: `Player ${id}`,
    colorIndex: 0,
    isBot: false,
    status: 'waiting',
    roundsPlayed: 0,
    totalScore: 0,
    chessVote: false,
    ...overrides,
  };
}

export function roundState(playerIds: string[]): RoundState {
  return {
    tick: 0,
    fieldSizeX: 10,
    fieldSizeY: 10,
    chessMode: false,
    grass: [],
    players: playerIds.map((id, i) => ({
      id,
      letter: String.fromCharCode(97 + i),
      sheep: { x: 1 + i, y: 1 },
      wolf: { x: 8, y: 8 - i },
      score: 0,
      exited: false,
    })),
  };
}

export function activeState(overrides: Partial<AppState> = {}): AppState {
  const lobby: LobbySnapshot = {
    players: [lobbyPlayer('me'), lobbyPlayer('other', { letter: 'b', colorIndex: 1 })],
    countdownSeconds: null,
    chessMode: false,
  };
  return {
    ...initialState(),
    phase: 'active',
    playerId: 'me',
    config: DEFAULT_CONFIG,
    lobby,
    ...overrides,
  };
}

describe('applyServerMessage', () => {
  it('welcome activates the client with id and config', () => {
    const state = applyServerMessage(
      initialState(),
      { type: 'welcome', protocolVersion: 1, playerId: 'me', config: DEFAULT_CONFIG },
      NOW,
    );
    expect(state.phase).toBe('active');
    expect(state.playerId).toBe('me');
    expect(state.config).toBe(DEFAULT_CONFIG);
  });

  it('lobby snapshots convert the countdown into a wall-clock deadline', () => {
    const lobby: LobbySnapshot = { players: [], countdownSeconds: 42, chessMode: false };
    const state = applyServerMessage(activeState(), { type: 'lobby', lobby }, NOW);
    expect(state.countdownEndsAt).toBe(NOW + 42_000);
    expect(countdownSecondsLeft(state, NOW + 41_500)).toBe(1);
    expect(countdownSecondsLeft(state, NOW + 60_000)).toBe(0);

    const idle = applyServerMessage(
      state,
      { type: 'lobby', lobby: { ...lobby, countdownSeconds: null } },
      NOW,
    );
    expect(countdownSecondsLeft(idle, NOW)).toBeNull();
  });

  it('roundStart/tick/roundEnd drive the round state and the result banner', () => {
    let state = activeState({ lastRoundEnd: { scores: [], winnerIds: [] } });
    state = applyServerMessage(state, { type: 'roundStart', state: roundState(['me']) }, NOW);
    expect(state.round).not.toBeNull();
    expect(state.lastRoundEnd).toBeNull(); // stale banner cleared

    const moved = { ...roundState(['me']), tick: 5 };
    state = applyServerMessage(state, { type: 'tick', state: moved, events: [] }, NOW);
    expect(state.round?.tick).toBe(5);

    state = applyServerMessage(
      state,
      {
        type: 'roundEnd',
        scores: [{ playerId: 'me', name: 'Me', score: 10 }],
        winnerIds: ['me'],
      },
      NOW,
    );
    expect(state.round).toBeNull();
    expect(state.lastRoundEnd?.winnerIds).toEqual(['me']);
  });

  it('a pre-welcome error means the lobby is full', () => {
    const rejected = applyServerMessage(
      initialState(),
      { type: 'error', message: 'lobby is full' },
      NOW,
    );
    expect(rejected.phase).toBe('rejected');

    const joined = activeState();
    expect(applyServerMessage(joined, { type: 'error', message: 'x' }, NOW).phase).toBe('active');
  });
});

describe('isOnPlayScreen', () => {
  it('is true only for a participant of a running round', () => {
    expect(isOnPlayScreen(activeState())).toBe(false); // no round
    expect(isOnPlayScreen(activeState({ round: roundState(['me', 'other']) }))).toBe(true);
    // A mid-round joiner spectates from the start screen (#31).
    expect(isOnPlayScreen(activeState({ round: roundState(['other']) }))).toBe(false);
  });
});
