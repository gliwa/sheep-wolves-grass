// HTTP layer (WBS 5): the REST config API (GET/PATCH /config, SPEC.md →
// Configuration) plus static hosting for the built client. Deliberately
// node:http — two endpoints and a handful of static files need no framework.

import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

import type { ConfigStore } from './config-store';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const MAX_BODY_BYTES = 64 * 1024;

export interface HttpHandlerOptions {
  store: ConfigStore;
  /** Directory with the built client bundle; null disables static hosting. */
  staticDir: string | null;
}

export function createRequestHandler(
  options: HttpHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void handle(options, req, res);
  };
}

async function handle(
  options: HttpHandlerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/config') {
      handleConfig(options.store, req, res);
      return;
    }
    if (req.method === 'GET' && options.staticDir !== null) {
      await serveStatic(options.staticDir, url.pathname, res);
      return;
    }
    sendText(res, 404, 'not found');
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}

function handleConfig(store: ConfigStore, req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET') {
    sendJson(res, 200, store.getConfig());
    return;
  }
  if (req.method === 'PATCH') {
    void readBody(req).then(
      (raw) => {
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          sendJson(res, 400, { error: 'invalid JSON' });
          return;
        }
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          sendJson(res, 400, { error: 'expected a JSON object of cfg* keys' });
          return;
        }
        sendJson(res, 200, store.patch(body as Record<string, unknown>));
      },
      (error: unknown) => {
        sendJson(res, 400, { error: error instanceof Error ? error.message : 'bad request' });
      },
    );
    return;
  }
  res.writeHead(405, { allow: 'GET, PATCH' });
  res.end();
}

async function serveStatic(
  staticDir: string,
  pathname: string,
  res: ServerResponse,
): Promise<void> {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const root = path.resolve(staticDir);
  const filePath = path.resolve(root, relative);
  const mime = MIME_TYPES[path.extname(filePath).toLowerCase()];
  // Resolving outside the static root (traversal) or to an unknown file type
  // is a plain 404 — nothing else on this server is servable.
  if (!filePath.startsWith(root + path.sep) || mime === undefined) {
    sendText(res, 404, 'not found');
    return;
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'content-type': mime });
    res.end(content);
  } catch {
    sendText(res, 404, 'not found');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
