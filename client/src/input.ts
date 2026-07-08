// Keyboard mapping (WBS 6): pure functions from key events to protocol
// messages and local edits. Movement (arrows / Shift+arrows) is handled by
// the caller's held-key repeater in main.ts; everything else — start-screen
// keys (SPEC.md → Screens), the name editor, and E to leave — lives here.

import type { ClientMessage, Direction } from '@swg/shared';
import { MAX_NAME_LENGTH } from '@swg/shared';

import type { AppState } from './state';
import { isOnPlayScreen } from './state';

export interface KeyResult {
  send?: ClientMessage;
  /** New name draft; null closes the editor; absent leaves it untouched. */
  draft?: string | null;
  /** The player leaves for good — the caller closes the socket. */
  exit?: boolean;
}

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export function directionForKey(key: string): Direction | null {
  return KEY_DIRECTIONS[key] ?? null;
}

export function handleKey(state: AppState, key: string): KeyResult {
  if (state.phase !== 'active') return {};

  // Play screen: movement is handled elsewhere; only E leaves (#31).
  if (isOnPlayScreen(state)) {
    if (key === 'e' || key === 'E') return { send: { type: 'exit' }, exit: true };
    return {};
  }

  // Name editor captures everything while open.
  if (state.nameDraft !== null) {
    if (key === 'Enter') {
      const name = state.nameDraft.trim();
      if (name.length === 0) return { draft: null }; // nothing to confirm
      return { send: { type: 'setName', name }, draft: null };
    }
    if (key === 'Escape') return { draft: null }; // restore the old name
    if (key === 'Backspace') return { draft: state.nameDraft.slice(0, -1) };
    if (key.length === 1 && state.nameDraft.length < MAX_NAME_LENGTH) {
      return { draft: state.nameDraft + key };
    }
    return {};
  }

  switch (key) {
    case 'Enter': {
      // Editing is only possible while still 'waiting' (SPEC.md → Screens).
      const me = state.lobby?.players.find((p) => p.id === state.playerId);
      return me !== undefined && me.status === 'waiting' ? { draft: me.name } : {};
    }
    case 'p':
    case 'P':
      return { send: { type: 'ready' } };
    case 'b':
    case 'B':
      return { send: { type: 'addBot' } };
    case 'c':
    case 'C':
      return { send: { type: 'voteChess' } };
    case 'e':
    case 'E':
      return { send: { type: 'exit' }, exit: true };
    default:
      return {};
  }
}
