// Client application state (WBS 6): a small store fed by server messages.
// Screen choice is derived — a running round the local player takes part in
// shows the play screen, everything else the start screen. All functions are
// pure (time injected) so they are unit-testable without a DOM.

import type {
  GameConfig,
  LobbySnapshot,
  PlayerId,
  RoundEndScore,
  RoundState,
  ServerMessage,
} from '@swg/shared';

export type Phase =
  | 'connecting' // socket not open yet
  | 'active' // in the lobby or a round — the normal case
  | 'left' // sent exit; terminal until reload (DECISIONS.md #12–13)
  | 'rejected' // lobby full
  | 'disconnected'; // socket dropped

export interface RoundEndInfo {
  scores: RoundEndScore[];
  winnerIds: PlayerId[];
}

export interface AppState {
  phase: Phase;
  playerId: PlayerId | null;
  config: GameConfig | null;
  lobby: LobbySnapshot | null;
  /** Wall-clock ms when the auto-start countdown reaches zero; null = no countdown. */
  countdownEndsAt: number | null;
  round: RoundState | null;
  lastRoundEnd: RoundEndInfo | null;
  /** Non-null while the name-edit line is open; holds the draft text. */
  nameDraft: string | null;
}

export function initialState(): AppState {
  return {
    phase: 'connecting',
    playerId: null,
    config: null,
    lobby: null,
    countdownEndsAt: null,
    round: null,
    lastRoundEnd: null,
    nameDraft: null,
  };
}

export function applyServerMessage(state: AppState, message: ServerMessage, now: number): AppState {
  switch (message.type) {
    case 'welcome':
      return { ...state, phase: 'active', playerId: message.playerId, config: message.config };
    case 'lobby':
      return {
        ...state,
        lobby: message.lobby,
        countdownEndsAt:
          message.lobby.countdownSeconds === null
            ? null
            : now + message.lobby.countdownSeconds * 1000,
      };
    case 'roundStart':
      return { ...state, round: message.state, lastRoundEnd: null };
    case 'tick':
      return { ...state, round: message.state };
    case 'roundEnd':
      return {
        ...state,
        round: null,
        lastRoundEnd: { scores: message.scores, winnerIds: message.winnerIds },
      };
    case 'configChanged':
      return { ...state, config: message.config };
    case 'error':
      // The only pre-welcome error is a full lobby; later errors are informational.
      return state.playerId === null ? { ...state, phase: 'rejected' } : state;
  }
}

/** Play screen only for a participant; mid-round joiners stay on the start screen (#31). */
export function isOnPlayScreen(state: AppState): boolean {
  return (
    state.phase === 'active' &&
    state.round !== null &&
    state.round.players.some((p) => p.id === state.playerId)
  );
}

/** Whole seconds left on the auto-start countdown, or null when idle. */
export function countdownSecondsLeft(state: AppState, now: number): number | null {
  if (state.countdownEndsAt === null) return null;
  return Math.max(0, Math.ceil((state.countdownEndsAt - now) / 1000));
}
