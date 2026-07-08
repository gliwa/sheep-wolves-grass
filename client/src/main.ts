// Client entry point (WBS 6): thin DOM/WebSocket wiring around the pure
// state, input and render modules. Latency handling is deliberately simple
// for v1: the server is authoritative, the client renders whatever the last
// tick said, and a held key just re-sends its move command a bit faster than
// the tick rate (the server applies ≤1 per player per tick, #34).

import type { ClientMessage, Direction, EntityKind, ServerMessage } from '@swg/shared';

import { directionForKey, handleKey } from './input';
import { renderApp } from './render';
import { applyServerMessage, initialState, isOnPlayScreen } from './state';

const MOVE_REPEAT_MS = 60;

const screen = document.getElementById('screen');
if (screen === null) throw new Error('missing #screen element');

let state = initialState();
const render = (): void => {
  screen.innerHTML = renderApp(state, Date.now());
};
render();

// Same origin as the page; the URL query passes through so dev-only
// ?cfgKey=value overrides reach the server (SPEC.md → Configuration).
const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${wsProtocol}://${location.host}/play${location.search}`);

const send = (message: ClientMessage): void => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data)) as ServerMessage;
  state = applyServerMessage(state, message, Date.now());
  render();
});
socket.addEventListener('close', () => {
  if (state.phase === 'active' || state.phase === 'connecting') {
    state = { ...state, phase: 'disconnected' };
    render();
  }
});

// Held movement keys, keyed by the arrow key name; the entity is fixed at
// press time (Shift = wolf), releasing the arrow releases the move. Only the
// most recent entry is re-sent — a player moves one entity per tick (#34) —
// and releasing it falls back to the previous still-held key.
const held = new Map<string, { entity: EntityKind; dir: Direction }>();

document.addEventListener('keydown', (event) => {
  if (state.phase !== 'active') return;

  const dir = directionForKey(event.key);
  if (dir !== null && isOnPlayScreen(state)) {
    event.preventDefault(); // no page scrolling
    if (event.repeat) return; // our own repeater handles held keys
    const entity: EntityKind = event.shiftKey ? 'wolf' : 'sheep';
    held.delete(event.key); // re-insert so the newest press is last
    held.set(event.key, { entity, dir });
    send({ type: 'move', entity, dir });
    return;
  }

  const result = handleKey(state, event.key);
  if (result.draft !== undefined) {
    state = { ...state, nameDraft: result.draft };
    event.preventDefault();
  }
  if (result.send !== undefined) send(result.send);
  if (result.exit === true) {
    state = { ...state, phase: 'left' };
    socket.close();
  }
  if (result.draft !== undefined || result.send !== undefined || result.exit === true) render();
});
document.addEventListener('keyup', (event) => held.delete(event.key));
window.addEventListener('blur', () => held.clear());

// Re-send the newest held move so holding a key means continuous movement
// (SPEC.md → Movement); slightly faster than the default tick so no tick
// goes empty. The server keeps one command per player per tick (#34).
setInterval(() => {
  if (!isOnPlayScreen(state)) {
    held.clear();
    return;
  }
  const move = [...held.values()].at(-1);
  if (move !== undefined) send({ type: 'move', ...move });
}, MOVE_REPEAT_MS);

// The countdown ticks down without server traffic — refresh the start screen.
setInterval(() => {
  if (state.phase === 'active' && state.countdownEndsAt !== null && !isOnPlayScreen(state)) {
    render();
  }
}, 250);
