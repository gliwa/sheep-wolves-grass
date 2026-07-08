// Entry point: resolve the startup config (default file → env vars), then
// serve the client, the config API and the play API from one process.
// PORT and STATIC_DIR are process-level (not cfg*) settings.

import path from 'node:path';

import { GAME_NAME } from '@swg/shared';

import { ConfigStore } from './config-store';
import { createGameServer } from './server';

const config = ConfigStore.resolveStartupConfig();
// dev (tsx, server/src) and prod (server/dist) both sit two levels below the
// repo root, next to client/dist.
const staticDir = process.env.STATIC_DIR ?? path.resolve(import.meta.dirname, '../../client/dist');
const port = Number(process.env.PORT ?? 8080);

const server = createGameServer({ config, staticDir });
server.httpServer.listen(port, () => {
  console.log(`${GAME_NAME} — http://localhost:${port} (play API: ws /play, config API: /config)`);
  console.log(`serving client from ${staticDir}`);
});
