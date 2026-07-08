// Integration tests over real sockets: REST config API, static hosting and
// the WebSocket play API — including two headless clients completing a full
// round, the core verification scenario from TODO.md.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ClientMessage, GameConfig, RoundState, ServerMessage, Vec2 } from '@swg/shared';
import { DEFAULT_CONFIG } from '@swg/shared';

import type { GameServer } from './server';
import { createGameServer } from './server';

let staticDir: string;
let server: GameServer | null = null;

beforeAll(() => {
  staticDir = mkdtempSync(path.join(tmpdir(), 'swg-static-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<h1>swg test client</h1>');
  writeFileSync(path.join(staticDir, 'app.js'), 'console.log("swg");');
});

afterAll(() => {
  rmSync(staticDir, { recursive: true, force: true });
});

afterEach(async () => {
  await server?.close();
  server = null;
});

/** 10×10 field, no grass, 10ms ticks, rng 0 — same geometry as the lobby tests. */
async function startServer(overrides: Partial<GameConfig> = {}): Promise<number> {
  const config: GameConfig = {
    ...DEFAULT_CONFIG,
    cfgFieldSizeX: 10,
    cfgFieldSizeY: 10,
    cfgInitialNofGrass: 0,
    cfgGrassGrowRate: 0,
    cfgSheepKillBonus: 10,
    cfgStartTimeout: 60,
    cfgTickMs: 10,
    ...overrides,
  };
  const gameServer = createGameServer({ config, staticDir, rng: () => 0 });
  server = gameServer;
  return new Promise((resolve) => {
    gameServer.httpServer.listen(0, '127.0.0.1', () => {
      resolve((gameServer.httpServer.address() as AddressInfo).port);
    });
  });
}

class TestClient {
  playerId = '';
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: ((message: ServerMessage) => void)[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter !== undefined) waiter(message);
      else this.queue.push(message);
    });
  }

  static async connect(port: number, query = ''): Promise<TestClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/play${query}`);
    const client = new TestClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve());
      socket.on('error', reject);
    });
    return client;
  }

  /** Connect and consume the welcome; returns [client, welcome message]. */
  static async join(
    port: number,
    query = '',
  ): Promise<[TestClient, Extract<ServerMessage, { type: 'welcome' }>]> {
    const client = await TestClient.connect(port, query);
    const welcome = await client.until('welcome');
    client.playerId = welcome.playerId;
    return [client, welcome];
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Next message of the given type (optionally matching); others are discarded. */
  async until<T extends ServerMessage['type']>(
    type: T,
    predicate?: (message: Extract<ServerMessage, { type: T }>) => boolean,
    timeoutMs = 3000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const message = await this.next(deadline);
      if (message.type !== type) continue;
      const match = message as Extract<ServerMessage, { type: T }>;
      if (predicate === undefined || predicate(match)) return match;
    }
  }

  /** Wait for a tick whose state satisfies the predicate. */
  async untilTick(predicate: (state: RoundState) => boolean): Promise<RoundState> {
    const tick = await this.until('tick', (m) => predicate(m.state));
    return tick.state;
  }

  close(): void {
    this.socket.close();
  }

  private next(deadline: number): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for a server message')),
        Math.max(1, deadline - Date.now()),
      );
      this.waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }
}

function wolfOf(state: RoundState, playerId: string): Vec2 {
  const player = state.players.find((p) => p.id === playerId);
  if (player === undefined) throw new Error(`no player ${playerId}`);
  return player.wolf;
}

describe('REST config API', () => {
  it('serves the effective config and patches per mutability class', async () => {
    const port = await startServer();
    const base = `http://127.0.0.1:${port}`;

    const initial = (await (await fetch(`${base}/config`)).json()) as GameConfig;
    expect(initial.cfgFieldSizeX).toBe(10);
    expect(initial.cfgTickMs).toBe(10);

    const patch = await fetch(`${base}/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cfgGrassGrowRate: 7, // live
        cfgSheepKillBonus: 99, // next-round
        cfgAllowClientOverrides: true, // startup-only → rejected
      }),
    });
    expect(patch.status).toBe(200);
    const outcome = (await patch.json()) as {
      applied: string[];
      pending: string[];
      rejected: { key: string }[];
    };
    expect(outcome.applied).toEqual(['cfgGrassGrowRate']);
    expect(outcome.pending).toEqual(['cfgSheepKillBonus']);
    expect(outcome.rejected.map((r) => r.key)).toEqual(['cfgAllowClientOverrides']);

    const effective = (await (await fetch(`${base}/config`)).json()) as GameConfig;
    expect(effective.cfgGrassGrowRate).toBe(7); // live: immediate
    expect(effective.cfgSheepKillBonus).toBe(10); // next-round: still buffered

    const bad = await fetch(`${base}/config`, { method: 'PATCH', body: 'not json' });
    expect(bad.status).toBe(400);
  });
});

describe('static hosting', () => {
  it('serves the client bundle and blocks traversal', async () => {
    const port = await startServer();
    const base = `http://127.0.0.1:${port}`;

    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(await index.text()).toContain('swg test client');

    expect((await fetch(`${base}/app.js`)).status).toBe(200);
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/..%2f..%2fpackage.json`)).status).toBe(404);
  });
});

describe('play API', () => {
  it('two headless clients complete a full round', async () => {
    const port = await startServer();
    const [c1, w1] = await TestClient.join(port);
    expect(w1.protocolVersion).toBe(1);
    expect(w1.config.cfgFieldSizeX).toBe(10);
    const [c2, w2] = await TestClient.join(port);
    expect(w2.playerId).not.toBe(w1.playerId);

    c1.send({ type: 'setName', name: 'Alice' });
    await c2.until('lobby', (m) => m.lobby.players.some((p) => p.name === 'Alice'));

    c1.send({ type: 'ready' });
    c2.send({ type: 'ready' });
    const start = await c1.until('roundStart');
    expect(start.state.players.map((p) => p.id)).toEqual([c1.playerId, c2.playerId]);
    expect(wolfOf(start.state, c1.playerId)).toEqual({ x: 0, y: 0 });
    await c2.until('roundStart');

    // Hunt: 9 down along the left edge, then 8 right onto c2's sheep (8,9).
    for (let y = 1; y <= 9; y++) {
      c1.send({ type: 'move', entity: 'wolf', dir: 'down' });
      await c1.untilTick((state) => wolfOf(state, c1.playerId).y === y);
    }
    for (let x = 1; x <= 8; x++) {
      c1.send({ type: 'move', entity: 'wolf', dir: 'right' });
      await c1.untilTick((state) => wolfOf(state, c1.playerId).x === x);
    }

    const end = await c2.until('roundEnd');
    expect(end.scores).toEqual([
      { playerId: c1.playerId, name: 'Alice', score: 10 },
      { playerId: c2.playerId, name: 'Player 2', score: 0 },
    ]);
    expect(end.winnerIds).toEqual([c1.playerId]);
    await c1.until('lobby', (m) => m.lobby.players.every((p) => p.status === 'waiting'));

    c1.close();
    c2.close();
  }, 15000);

  it('rejects joins beyond the cap and treats a disconnect as an exit', async () => {
    const port = await startServer({ cfgMaxNofPlayers: 2 });
    const [c1] = await TestClient.join(port);
    const [c2] = await TestClient.join(port);

    const c3 = await TestClient.connect(port);
    const error = await c3.until('error');
    expect(error.message).toMatch(/full/);

    c2.close();
    await c1.until('lobby', (m) => m.lobby.players.length === 1);
    c1.close();
  });

  it('applies buffered next-round config at the round boundary and broadcasts it', async () => {
    const port = await startServer();
    const base = `http://127.0.0.1:${port}`;
    const [c1] = await TestClient.join(port);
    const [c2] = await TestClient.join(port);

    await fetch(`${base}/config`, {
      method: 'PATCH',
      body: JSON.stringify({ cfgSheepKillBonus: 99 }),
    });
    expect(((await (await fetch(`${base}/config`)).json()) as GameConfig).cfgSheepKillBonus).toBe(
      10,
    );

    c1.send({ type: 'ready' });
    c2.send({ type: 'ready' });
    const changed = await c1.until('configChanged');
    expect(changed.config.cfgSheepKillBonus).toBe(99);
    await c1.until('roundStart');
    expect(((await (await fetch(`${base}/config`)).json()) as GameConfig).cfgSheepKillBonus).toBe(
      99,
    );

    c1.close();
    c2.close();
  });

  it('honors query-param overrides only when cfgAllowClientOverrides is on', async () => {
    let port = await startServer({ cfgAllowClientOverrides: true });
    const [c1, welcome] = await TestClient.join(port, '?cfgGrassGrowRate=42');
    expect(welcome.config.cfgGrassGrowRate).toBe(42);
    c1.close();
    await server!.close();
    server = null;

    port = await startServer(); // overrides off (default)
    const [c2, locked] = await TestClient.join(port, '?cfgGrassGrowRate=42');
    expect(locked.config.cfgGrassGrowRate).toBe(0); // test default, unchanged
    c2.close();
  });
});
