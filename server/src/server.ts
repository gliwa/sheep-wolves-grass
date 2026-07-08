// Server assembly (WBS 5): one node:http process hosting the static client,
// the REST config API and the WebSocket play API on '/play', all wired to
// the single global lobby (SPEC.md → Stack decision). Connection identity is
// the socket: a disconnect is an exit and a reconnect joins as a brand-new
// player (DECISIONS.md #12–13).

import http from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import type { GameConfig, PlayerId, Rng, ServerMessage } from '@swg/shared';
import { PROTOCOL_VERSION, parseClientMessage } from '@swg/shared';

import { ConfigStore } from './config-store';
import { createRequestHandler } from './http';
import { Lobby } from './lobby';

export interface GameServerOptions {
  config: GameConfig;
  /** Directory with the built client bundle; null disables static hosting. */
  staticDir?: string | null;
  rng?: Rng;
}

export interface GameServer {
  httpServer: http.Server;
  lobby: Lobby;
  store: ConfigStore;
  close(): Promise<void>;
}

export function createGameServer(options: GameServerOptions): GameServer {
  const sockets = new Map<PlayerId, WebSocket>();
  const send = (socket: WebSocket, message: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };
  const broadcast = (message: ServerMessage): void => {
    const raw = JSON.stringify(message);
    for (const socket of sockets.values()) {
      if (socket.readyState === socket.OPEN) socket.send(raw);
    }
  };

  const store = new ConfigStore(options.config, (config) =>
    broadcast({ type: 'configChanged', config }),
  );
  const lobby = new Lobby({
    getConfig: store.getConfig,
    rng: options.rng,
    // Buffered next-round keys land right before the engine snapshots them.
    beforeRoundStart: () => store.applyPending(),
    events: {
      onLobby: (snapshot) => broadcast({ type: 'lobby', lobby: snapshot }),
      onRoundStart: (state) => broadcast({ type: 'roundStart', state }),
      onTick: (state, events) => broadcast({ type: 'tick', state, events }),
      onRoundEnd: (scores, winnerIds) => broadcast({ type: 'roundEnd', scores, winnerIds }),
    },
  });

  const httpServer = http.createServer(
    createRequestHandler({ store, staticDir: options.staticDir ?? null }),
  );
  const wss = new WebSocketServer({ server: httpServer, path: '/play', maxPayload: 1024 });

  wss.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    // Dev-only query-param overrides (SPEC.md → Configuration): global like
    // any other config change, honored only when the startup-only flag
    // cfgAllowClientOverrides is on.
    if (store.getConfig().cfgAllowClientOverrides) {
      store.patchFromStrings(url.searchParams);
    }

    const player = lobby.join();
    if (player === null) {
      send(socket, { type: 'error', message: 'lobby is full' });
      socket.close();
      return;
    }
    sockets.set(player.id, socket);
    send(socket, {
      type: 'welcome',
      protocolVersion: PROTOCOL_VERSION,
      playerId: player.id,
      config: store.getConfig(),
    });
    // join() broadcast before this socket was registered — catch it up, and
    // hand a mid-round joiner the running round.
    send(socket, { type: 'lobby', lobby: lobby.snapshot() });
    const state = lobby.roundState;
    if (state !== null) send(socket, { type: 'roundStart', state });

    const leave = (): void => {
      if (sockets.delete(player.id)) lobby.exit(player.id);
    };
    socket.on('message', (data) => {
      const message = parseClientMessage(String(data));
      if (message === null) return; // malformed input is ignored
      switch (message.type) {
        case 'setName':
          lobby.setName(player.id, message.name);
          break;
        case 'ready':
          lobby.ready(player.id);
          break;
        case 'addBot':
          lobby.addBot();
          break;
        case 'voteChess':
          lobby.voteChess(player.id);
          break;
        case 'exit':
          leave();
          socket.close();
          break;
        case 'move':
          lobby.submitMove({ playerId: player.id, entity: message.entity, dir: message.dir });
          break;
      }
    });
    socket.on('close', leave);
    socket.on('error', leave);
  });

  const close = async (): Promise<void> => {
    lobby.dispose();
    for (const socket of sockets.values()) socket.terminate();
    sockets.clear();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  };

  return { httpServer, lobby, store, close };
}
