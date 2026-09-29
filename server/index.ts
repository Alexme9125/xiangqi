import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseCommand, RoomService, type Session } from './rooms';
import type { ServerMessage } from '../shared/protocol';

export interface AppServerOptions {
  allowedOrigins?: string[];
  heartbeatMs?: number;
  maxPayloadBytes?: number;
}

interface Connection {
  session: Session;
  alive: boolean;
  windowStart: number;
  messageCount: number;
}

function sendError(socket: WebSocket, message: string): void {
  if (socket.readyState === 1) {
    const payload: ServerMessage = { type: 'error', message };
    socket.send(JSON.stringify(payload));
  }
}

function originAllowed(request: IncomingMessage, allowedOrigins: string[]): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    const from = new URL(origin);
    const host = new URL(`http://${request.headers.host || ''}`);
    return (from.protocol === 'http:' || from.protocol === 'https:') && from.hostname === host.hostname;
  } catch {
    return false;
  }
}

export function createAppServer(options: AppServerOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (_request, response) => response.json({ ok: true }));

  const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get(/.*/, (_request, response) => response.sendFile(resolve(dist, 'index.html')));
  }

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false,
    maxPayload: options.maxPayloadBytes ?? 4_096 });
  const rooms = new RoomService();
  const connections = new Map<WebSocket, Connection>();
  const allowedOrigins = options.allowedOrigins ??
    (process.env.XIANGQI_ALLOWED_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean) ?? []);

  server.on('upgrade', (request, socket, head) => {
    let pathname: string;
    try { pathname = new URL(request.url ?? '/', 'http://localhost').pathname; }
    catch { socket.destroy(); return; }
    if (pathname !== '/ws' || !originAllowed(request, allowedOrigins)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    if (wss.clients.size >= 2_048) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
  });

  wss.on('connection', (socket) => {
    const session = rooms.newSession(socket);
    const connection: Connection = { session, alive: true, windowStart: Date.now(), messageCount: 0 };
    connections.set(socket, connection);
    socket.on('pong', () => { connection.alive = true; });
    socket.on('message', (data, isBinary) => {
      const now = Date.now();
      if (now - connection.windowStart >= 10_000) {
        connection.windowStart = now;
        connection.messageCount = 0;
      }
      connection.messageCount++;
      if (connection.messageCount > 40) {
        socket.close(1008, '消息发送过于频繁');
        return;
      }
      if (isBinary) { sendError(socket, '请发送 JSON 文本消息。'); return; }
      let raw: unknown;
      try { raw = JSON.parse(data.toString()); }
      catch { sendError(socket, 'JSON 格式错误。'); return; }
      const command = parseCommand(raw);
      if (!command) { sendError(socket, '无效的操作指令。'); return; }
      try { rooms.handle(session, command); }
      catch { sendError(socket, '操作未能完成。'); }
    });
    socket.on('close', () => {
      connections.delete(socket);
      rooms.disconnect(session);
    });
    socket.on('error', () => { /* close event performs room cleanup */ });
  });

  const heartbeat = setInterval(() => {
    for (const [socket, connection] of connections) {
      if (!connection.alive) { socket.terminate(); continue; }
      connection.alive = false;
      try { socket.ping(); } catch { socket.terminate(); }
    }
  }, options.heartbeatMs ?? 30_000);
  heartbeat.unref();

  return {
    app,
    server,
    wss,
    rooms,
    listen(port = 3001, host = '0.0.0.0'): Promise<number> {
      return new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const address = server.address();
          resolveListen(typeof address === 'object' && address ? address.port : port);
        });
      });
    },
    close(): Promise<void> {
      clearInterval(heartbeat);
      for (const socket of connections.keys()) socket.terminate();
      return new Promise((resolveClose, reject) => {
        wss.close();
        if (!server.listening) { resolveClose(); return; }
        server.close((error) => error ? reject(error) : resolveClose());
      });
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const instance = createAppServer();
  const port = Number(process.env.PORT) || 3001;
  instance.listen(port).then((actual) => {
    console.log(`Xiangqi room server listening on ${actual}`);
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
