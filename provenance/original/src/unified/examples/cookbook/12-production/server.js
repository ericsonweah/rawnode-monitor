'use strict';

import { timingSafeEqual } from 'node:crypto';
import Unified, {
  accessLog,
  compress,
  cors,
  hostPolicy,
  MemoryRateLimitStore,
  rateLimit,
  requestLimits,
  secureHeaders,
  trustedProxy,
} from '#unified';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const splitCsv = (value, fallback = []) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .concat(value ? [] : fallback);

const constantTimeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
};

const appKey = required('APP_KEY');
const managementToken = required('UNIFIED_MANAGEMENT_TOKEN');
const allowedHosts = splitCsv(process.env.UNIFIED_ALLOWED_HOSTS, ['api.example.com']);
const allowedOrigins = splitCsv(process.env.UNIFIED_ALLOWED_ORIGINS, ['https://app.example.com']);
const trustedProxies = splitCsv(process.env.UNIFIED_TRUSTED_PROXIES);

const app = Unified({
  profile: 'production',
  classification: { maxBytes: 64, timeoutMs: 300, ambiguous: 'reject' },
  http: {
    server: {
      timeouts: { handlerTimeout: 10_000 },
      limits: { maxActiveRequests: 20_000 },
    },
  },
  websocket: {
    path: '/realtime',
    allowedOrigins,
    maxConnections: 50_000,
    middlewareTimeoutMs: 5_000,
    upgradeRateLimit: { limit: 100, windowMs: 1_000 },
    eventSocket: {
      ackTimeoutMs: 5_000,
      maxPacketBytes: 256 * 1024,
      maxBufferBytes: 2 * 1024 * 1024,
      maxBufferMessages: 2_048,
      maxInboundPerWindow: 1_000,
      inboundWindowMs: 1_000,
    },
  },
  tcp: {
    heartbeat: { enabled: true, intervalMs: 25_000, timeoutMs: 60_000 },
    protocol: {
      maxPendingAcks: 10_000,
      maxRoomsPerSocket: 64,
      maxEventsPerSecond: 1_000,
      maxBytesPerSecond: 2 * 1024 * 1024,
      handlerMode: 'serial',
      maxConcurrentHandlers: 1,
      onViolation: 'disconnect',
    },
    observability: { enabled: true, metricsPrefix: 'rawnode_tcp_' },
  },
  udp: {
    maxPacketSize: 8_192,
    handshake: {
      mode: 'required',
      secret: process.env.UNIFIED_UDP_HANDSHAKE_SECRET || appKey,
      rateLimit: { windowMs: 1_000, maxAttempts: 20, maxEntries: 65_536 },
      amp: { maxFactor: 3, maxBytes: 65_536 },
    },
    admission: { maxEntries: 65_536, ttlMs: 60_000, ratePerSecond: 200, burst: 400 },
    limits: { maxJsonBytes: 64 * 1024, maxPayloadBytes: 256 * 1024 },
    peer: { maxMessageSize: 256 * 1024, maxPending: 1_024, maxQueue: 4_096, maxRetries: 8 },
  },
  observability: {
    enabled: true,
    prefix: 'rawnode_unified',
    historyLimit: 256,
    eventLoopMonitoring: true,
    eventLoopResolutionMs: 20,
  },
});

app.use(accessLog({ logger: console, slowMs: 250 }));
app.use(secureHeaders({
  hsts: { maxAge: 15_552_000, includeSubDomains: true },
  contentSecurityPolicy: {
    "default-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'none'"],
  },
}));
app.use(hostPolicy({ allow: allowedHosts }));
app.use(requestLimits({ maxRequestTargetBytes: 16 * 1024, maxHeaders: 100 }));
app.use(cors({ origins: allowedOrigins, credentials: true }));
if (trustedProxies.length) app.use(trustedProxy({ trust: trustedProxies }));
app.use(rateLimit({
  store: new MemoryRateLimitStore({ maxEntries: 250_000 }),
  window: '1m',
  max: 300,
}));
app.use(compress({ minBytes: 1024, encodings: ['br', 'gzip'] }));
app.use(Unified.json({ limit: '1mb', compressedLimit: '512kb' }));

const management = (req, res, next) => {
  const supplied = req.headers['x-rawnode-management-token'];
  if (!constantTimeEqual(supplied, managementToken)) {
    return res.status(404).json({ error: 'Not Found' });
  }
  return next();
};

app.get('/health/live', (_req, res) => {
  const health = app.health();
  res.status(health.live ? 200 : 503).json({ live: health.live, state: health.state });
});
app.get('/health/ready', (_req, res) => {
  const health = app.health();
  res.status(health.ready ? 200 : 503).json(health);
});
app.get('/internal/metrics', management, (_req, res) => {
  res.type('text/plain; version=0.0.4').send(app.metrics('prometheus'));
});
app.get('/internal/diagnostics', management, (_req, res) => res.json(app.diagnostics()));

// Authenticate WS connections from a secure HttpOnly cookie or another trusted
// handshake value. This simplified example checks a cookie value directly.
app.ws.use(async (socket) => {
  const cookie = String(socket.handshake.headers.cookie || '');
  const authenticated = cookie.split(';').some((part) => part.trim() === 'rn_session=valid-example');
  if (!authenticated) throw Object.assign(new Error('Unauthorized'), { code: 'WS_UNAUTHORIZED' });
});
app.ws.on('connection', (socket) => {
  socket.on('notification:subscribe', async (room, ack) => {
    socket.join(`notifications:${String(room)}`);
    await ack?.({ subscribed: true });
  });
});

// Application-level TCP authentication. Transport classification and admission
// happen first; protected handlers require this authenticated flag.
app.tcp.handle('auth:login', async (socket, payload, ack) => {
  const ok = constantTimeEqual(payload?.token, process.env.TCP_APPLICATION_TOKEN);
  socket.data.authenticated = ok;
  await ack?.({ ok });
  if (!ok) socket.disconnect('authentication failed');
});
app.tcp.handle('orders:create', async (socket, payload, ack) => {
  if (!socket.data.authenticated) return ack?.({ ok: false, error: 'UNAUTHENTICATED' });
  await ack?.({ ok: true, orderId: `order-${Date.now()}`, payload });
});

app.udp.on('telemetry:ingest', (body, response) => {
  const ok = constantTimeEqual(body?.token, process.env.UDP_APPLICATION_TOKEN);
  if (!ok) return response.reply({ ok: false, error: 'UNAUTHENTICATED' }, true);
  return response.reply({ ok: true, receivedAt: Date.now() }, true);
});

app.manageSignals({
  signals: ['SIGINT', 'SIGTERM'],
  timeoutMs: 30_000,
  setExitCode: true,
});

const server = await app.start({
  host: process.env.UNIFIED_HOST || '0.0.0.0',
  port: Number(process.env.UNIFIED_PORT || 3000),
  backlog: Number(process.env.UNIFIED_BACKLOG || 511),
  reuseAddr: true,
  reusePort: process.env.UNIFIED_REUSE_PORT === 'true',
  protocols: { http: true, websocket: true, tcp: true, udp: true },
});

if (!server.health().ready) throw new Error('Unified server did not become ready.');
console.log('Production Unified endpoint:', server.addresses());
