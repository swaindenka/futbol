// Futbol Arena game server: serves the static client and hosts rooms over WebSocket.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { Lobby } from './lobby.js';
import { createStaticHandler } from './static.js';

const here = dirname(fileURLToPath(import.meta.url));

export function createGameServer({ publicDir = join(here, '..', 'public') } = {}) {
  const lobby = new Lobby();
  const serveStatic = createStaticHandler(publicDir);

  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...lobby.stats() }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    serveStatic(req, res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      lobby.connect(ws);
    });
  });

  // Drop dead connections.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000);
  server.on('close', () => clearInterval(heartbeat));

  return { server, wss, lobby };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const { server } = createGameServer();
  server.listen(port, host, () => {
    console.log(`⚽ Futbol Arena http://localhost:${port}`);
  });
  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
