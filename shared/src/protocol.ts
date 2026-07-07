// Play-API protocol: the WebSocket messages exchanged between client and
// server. Everything is JSON; RoundState/LobbyPlayer from state.ts are sent
// verbatim. See SPEC.md → Stack decision (play API) and Screens.

import type { GameConfig } from './config';
import type { Direction, EntityKind, LobbyPlayer, PlayerId, RoundState, Vec2 } from './state';
import { DIRECTION_DELTAS } from './state';

export const PROTOCOL_VERSION = 1;

export const MAX_NAME_LENGTH = 24;

// ---------------------------------------------------------------------------
// Client → server

export type ClientMessage =
  | { type: 'setName'; name: string }
  | { type: 'ready' }
  | { type: 'addBot' }
  | { type: 'voteChess' }
  | { type: 'exit' }
  | { type: 'move'; entity: EntityKind; dir: Direction };

/**
 * Parse and validate a raw WebSocket payload into a ClientMessage.
 * Returns null for anything malformed — the server ignores such messages.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Record<string, unknown>;
  switch (msg.type) {
    case 'setName':
      if (typeof msg.name !== 'string') return null;
      if (msg.name.length === 0 || msg.name.length > MAX_NAME_LENGTH) return null;
      return { type: 'setName', name: msg.name };
    case 'ready':
    case 'addBot':
    case 'voteChess':
    case 'exit':
      return { type: msg.type };
    case 'move': {
      if (msg.entity !== 'sheep' && msg.entity !== 'wolf') return null;
      if (typeof msg.dir !== 'string' || !(msg.dir in DIRECTION_DELTAS)) return null;
      return { type: 'move', entity: msg.entity, dir: msg.dir as Direction };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Server → client

/** Things that happened during a tick, for rendering/effects on the client. */
export type TickEvent =
  | { type: 'grass-eaten'; playerId: PlayerId; pos: Vec2 }
  | { type: 'grass-trampled'; playerId: PlayerId; pos: Vec2 }
  | { type: 'sheep-killed'; victimId: PlayerId; killerId: PlayerId; pos: Vec2 };

export interface LobbySnapshot {
  players: LobbyPlayer[];
  /** Seconds until forced round start, null while the countdown hasn't begun. */
  countdownSeconds: number | null;
  /** Whether the next round will run in chess mode (vote threshold reached). */
  chessMode: boolean;
}

export interface RoundEndScore {
  playerId: PlayerId;
  name: string;
  score: number;
}

export type ServerMessage =
  | {
      type: 'welcome';
      protocolVersion: number;
      playerId: PlayerId;
      config: GameConfig;
    }
  | { type: 'lobby'; lobby: LobbySnapshot }
  | { type: 'roundStart'; state: RoundState }
  | { type: 'tick'; state: RoundState; events: TickEvent[] }
  | { type: 'roundEnd'; scores: RoundEndScore[]; winnerIds: PlayerId[] }
  | { type: 'configChanged'; config: GameConfig }
  | { type: 'error'; message: string };
