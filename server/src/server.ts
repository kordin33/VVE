import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';

import { config, paths } from './config';
import { logger } from './logger';
import { RoomManager, RoomContext } from './rooms';
import { FilePersistence } from './persistence';
import { createHttpApp } from './httpApp';
import { OpenRouterEquationSolver } from './services/aiSolver';
import { createCapabilityAccess } from './pilot/capabilityAccess';
import { createWsAdmission } from './wsAdmission';
import { BoardYjsPersistence } from './services/boardYjsPersistence';
import { getDb } from './db';

// Startup config check (no secrets logged)
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  logger.warn('OPENROUTER_API_KEY is not set - AI features will be unavailable');
} else {
  logger.info('OPENROUTER_API_KEY configured', { length: apiKey.length });
}

const messageSync = 0;
const messageAwareness = 1;

type ManagedSocket = WebSocket & {
  isAlive?: boolean;
  msgCount?: number;
  msgWindowStart?: number;
};
type AwarenessChange = {
  added: number[];
  updated: number[];
  removed: number[];
};

const send = (ws: WebSocket, data: Uint8Array) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(data, { binary: true });
  }
};

const createMessage = (type: number, payload: Uint8Array = new Uint8Array(0)) => {
  const message = new Uint8Array(1 + payload.length);
  message[0] = type;
  message.set(payload, 1);
  return message;
};

const broadcast = (
  room: RoomContext,
  type: number,
  payload: Uint8Array,
  exclude?: WebSocket | null
) => {
  const msg = createMessage(type, payload);
  let sentCount = 0;
  room.connections.forEach((_, client) => {
    if (client !== exclude) {
      send(client, msg);
      sentCount++;
    }
  });
  // Verbose sync logging removed for performance
};

const toUint8Array = (raw: WebSocket.RawData): Uint8Array => {
  if (typeof raw === 'string') {
    return new Uint8Array(Buffer.from(raw));
  }
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw));
  if (Buffer.isBuffer(raw)) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return new Uint8Array(Buffer.from(raw as any));
};

const initializeRoom = (room: RoomContext) => {
  if (room.initialized) return;

  room.doc.on('update', (update: Uint8Array, origin) => {
    const timestamp = Date.now();
    room.meta.updatedAt = timestamp;
    room.meta.lastActiveAt = timestamp;
    room.lastActive = timestamp;
    logger.debug('Generated update', { size: update.length, originIsWs: origin instanceof WebSocket });
    boardPersistence
      .recordUpdate(room.id, update, room.doc)
      .catch((error) =>
        logger.error('Failed to persist Yjs update', {
          boardId: room.id,
          error: (error as Error).message
        })
      );
    broadcast(room, messageSync, update, origin as WebSocket | null);
  });

  room.awareness.on('update', (changes: AwarenessChange, origin: WebSocket | null) => {
    const timestamp = Date.now();
    room.meta.lastActiveAt = timestamp;
    room.lastActive = timestamp;
    const { added, updated, removed } = changes;
    const targets = added.concat(updated, removed);
    if (targets.length === 0) {
      return;
    }
    const awarenessPayload = awarenessProtocol.encodeAwarenessUpdate(room.awareness, targets);
    broadcast(room, messageAwareness, awarenessPayload, origin as WebSocket | null);

    if (origin instanceof WebSocket) {
      const trackedStates = room.connections.get(origin);
      if (trackedStates) {
        added.concat(updated).forEach((clientId) => trackedStates.add(clientId));
        removed.forEach((clientId) => trackedStates.delete(clientId));
      }
    }
  });

  room.initialized = true;
};

const sendInitialSync = (room: RoomContext, ws: WebSocket) => {
  const docState = Y.encodeStateAsUpdate(room.doc);
  send(ws, createMessage(messageSync, docState));

  const awarenessStates = room.awareness.getStates();
  if (awarenessStates.size > 0) {
    const payload = awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(awarenessStates.keys()));
    send(ws, createMessage(messageAwareness, payload));
  }
};

// SEC-002: Simple per-connection rate limiting
const WS_RATE_LIMIT = 300; // max messages per window
const WS_RATE_WINDOW_MS = 1000; // 1-second window

const checkRateLimit = (ws: ManagedSocket): boolean => {
  const now = Date.now();
  if (!ws.msgWindowStart || now - ws.msgWindowStart > WS_RATE_WINDOW_MS) {
    ws.msgWindowStart = now;
    ws.msgCount = 1;
    return true;
  }
  ws.msgCount = (ws.msgCount || 0) + 1;
  return ws.msgCount <= WS_RATE_LIMIT;
};

// H8: Per-IP connection limiting to prevent resource exhaustion
const MAX_CONNECTIONS_PER_IP = 20;
const ipConnectionCounts = new Map<string, number>();

const getClientIp = (request: http.IncomingMessage): string => {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown';
  }
  return request.socket.remoteAddress || 'unknown';
};

const trackIpConnect = (ip: string): boolean => {
  const current = ipConnectionCounts.get(ip) || 0;
  if (current >= MAX_CONNECTIONS_PER_IP) return false;
  ipConnectionCounts.set(ip, current + 1);
  return true;
};

const trackIpDisconnect = (ip: string): void => {
  const current = ipConnectionCounts.get(ip) || 0;
  if (current <= 1) {
    ipConnectionCounts.delete(ip);
  } else {
    ipConnectionCounts.set(ip, current - 1);
  }
};

const handleMessage = (room: RoomContext, ws: ManagedSocket, data: Uint8Array) => {
  if (!data || data.length === 0) {
    logger.debug('Ignoring empty WebSocket message');
    return;
  }

  if (!checkRateLimit(ws)) {
    logger.warn('WebSocket rate limit exceeded, dropping message');
    return;
  }

  const messageType = data[0];
  const payload = data.slice(1);

  switch (messageType) {
    case messageSync: {
      try {
        logger.debug('Processing sync message', { size: payload.length });
        Y.applyUpdate(room.doc, payload, ws);
      } catch (error) {
        logger.warn('Failed to apply doc update', {
          error: (error as Error).message
        });
      }
      break;
    }
    case messageAwareness: {
      try {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, payload, ws);
      } catch (error) {
        logger.warn('Failed to apply awareness update', {
          error: (error as Error).message
        });
      }
      break;
    }
    default:
      logger.warn('Received unknown message type', {
        messageType,
        length: data.length
      });
  }
};

const removeConnection = (roomId: string, room: RoomContext, ws: WebSocket) => {
  const tracked = room.connections.get(ws);
  if (tracked) {
    room.connections.delete(ws);
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(tracked), ws);
  }
  logger.info('Client disconnected', { roomId, clients: room.connections.size });
};

const parseWsParams = (
  requestUrl?: string | null
): { roomId: string; token: string | null } | null => {
  if (!requestUrl) return null;
  try {
    const url = new URL(requestUrl, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length >= 3 && segments[0] === 'ws' && segments[1] === 'whiteboard') {
      const roomId = decodeURIComponent(segments.slice(2).join('/'));
      const token = url.searchParams.get('wsToken') || url.searchParams.get('token');
      return { roomId, token };
    }
  } catch {
    return null;
  }
  return null;
};

const persistence = new FilePersistence(config.dataDir);
const boardPersistence = new BoardYjsPersistence();
const roomManager = new RoomManager(persistence, boardPersistence);
const aiSolver = new OpenRouterEquationSolver();
boardPersistence.startCleanupJob();
// VVE-101: one CapabilityAccess instance owns every authorization decision
// for HTTP and WebSocket. Legacy peer rooms remain reachable only on the
// development surface with the internal dev flag (ADR-0010).
const capabilityAccess = createCapabilityAccess();
const wsAdmission = createWsAdmission(
  capabilityAccess,
  config.pilotEnvironment === 'development' && config.devSurface
);
export const app = createHttpApp({ roomManager, aiSolver, capabilityAccess });

const server = http.createServer(app);
// 5.7: Limit max WebSocket payload to 5 MB to prevent memory abuse
const wss = new WebSocketServer({ server, maxPayload: 5 * 1024 * 1024 });

wss.on('connection', (socket: ManagedSocket, request) => {
  const clientIp = getClientIp(request);

  // H8: Per-IP connection limiting
  if (!trackIpConnect(clientIp)) {
    logger.warn('Per-IP connection limit exceeded', { ip: clientIp, max: MAX_CONNECTIONS_PER_IP });
    socket.close(1013, 'Too many connections');
    return;
  }

  (async () => {
    const parsed = parseWsParams(request.url);
    if (!parsed) {
      trackIpDisconnect(clientIp);
      socket.close(1008, 'Invalid room');
      return;
    }

    const { roomId, token } = parsed;

    // VVE-101: admission goes through CapabilityAccess.decide() — fail-closed
    // on every database error (the previous fail-open path is deleted), with
    // expiry/revocation/credential-version re-verified at admission time.
    const admission = await wsAdmission.admit(roomId, token);
    if (!admission.admitted) {
      trackIpDisconnect(clientIp);
      socket.close(admission.closeCode, admission.closeReason);
      return;
    }

    const { room, created } = await roomManager.get(roomId);
    initializeRoom(room);

    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    room.connections.set(socket, new Set());
    logger.info('Client connected', { roomId, clients: room.connections.size, created });

    sendInitialSync(room, socket);

    socket.on('message', (raw) => {
      handleMessage(room, socket, toUint8Array(raw));
    });

    socket.on('close', () => {
      removeConnection(roomId, room, socket);
      trackIpDisconnect(clientIp);
    });
    // 5.3: Also remove connection on error to prevent leaked awareness states
    socket.on('error', (error) => {
      logger.warn('WebSocket error', { roomId, error: error.message });
      removeConnection(roomId, room, socket);
      trackIpDisconnect(clientIp);
    });
  })().catch((error) => {
    logger.error('WebSocket connection failed', { error: (error as Error).message });
    trackIpDisconnect(clientIp);
    socket.close(1011, 'Internal error');
  });
});

const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    const socket = ws as ManagedSocket;
    if (!socket.isAlive) {
      socket.terminate();
      return;
    }
    socket.isAlive = false;
    socket.ping();
  });
  roomManager.cleanup(config.roomTtlMs);
}, config.pingIntervalMs);

// Run migrations and start server
const startServer = async () => {
  try {
    // Run migrations programmatically
    if (config.databaseUrl) {
      const db = getDb();
      console.log('[Server] Running database migrations...');
      const result = await db.migrate.latest();
      console.log('[Server] Migrations completed:', result);
    } else {
      console.log('[Server] No DATABASE_URL, skipping migrations');
    }
  } catch (error) {
    console.error('[Server] Migration failed:', error);
    // Continue anyway - tables might already exist
  }

  server.listen(config.port, config.host, () => {
    logger.info('Realtime backend ready', { host: config.host, port: config.port, path: paths.whiteboard });
  });
};

startServer();

const shutdown = () => {
  logger.info('Shutting down server');
  clearInterval(pingInterval);
  // BE-004: Graceful close instead of hard terminate
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1001, 'Server shutting down');
    }
  });
  // Force terminate any lingering connections after 3 seconds
  setTimeout(() => {
    wss.clients.forEach((client) => client.terminate());
  }, 3000);
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// BE-005: Global error handlers to prevent silent crashes
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: String(reason) });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception - shutting down', { error: error.message, stack: error.stack });
  shutdown();
});
