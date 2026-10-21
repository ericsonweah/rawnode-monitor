'use strict';

import Unified, {
  accessLog,
  compress,
  cors,
  hostPolicy,
  MemoryRateLimitStore,
  rateLimit,
  requestLimits,
  secureHeaders,
} from '#unified';

const app = Unified({
  profile: 'enterprise',
  http: {
    server: {
      timeouts: { handlerTimeout: 10_000 },
      limits: { maxActiveRequests: 10_000 },
    },
  },
});

const rateLimitStore = new MemoryRateLimitStore({ maxEntries: 100_000 });

app.use(accessLog({ logger: console, slowMs: 250 }));
app.use(secureHeaders({
  hsts: false,
  contentSecurityPolicy: {
    "default-src": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
  },
}));
app.use(hostPolicy({ allow: ['127.0.0.1', 'localhost', '*.example.test'] }));
app.use(requestLimits({ maxRequestTargetBytes: 16 * 1024, maxHeaders: 100 }));
app.use(cors({ origins: ['https://app.example.test'], credentials: true }));
app.use(rateLimit({ store: rateLimitStore, window: '1m', max: 120 }));
app.use(compress({ minBytes: 1024, encodings: ['br', 'gzip'] }));
app.use(Unified.json({ limit: '1mb', compressedLimit: '512kb' }));

app.get('/health/live', (_req, res) => {
  const health = app.health();
  res.status(health.live ? 200 : 503).json({ live: health.live, state: health.state });
}).name('health.live');

app.get('/health/ready', (_req, res) => {
  const health = app.health();
  res.status(health.ready ? 200 : 503).json(health);
}).name('health.ready');

app.get('/metrics', (_req, res) => {
  res.type('text/plain; version=0.0.4').send(app.metrics('prometheus'));
}).name('metrics');

app.group({ prefix: '/api', name: 'api.', domain: '{tenant}.example.test' }, () => {
  app.get('/users/:id', (req, res) => {
    res.json({
      tenant: req.domainParams.tenant,
      id: req.params.id,
      requestId: req.id,
    });
  }).whereUuid('id').name('users.show').timeout('2s');

  app.post('/echo', (req, res) => {
    res.status(201).json({ received: req.body, requestId: req.id });
  }).name('echo');
});

app.onNotFound((req, res) => {
  res.status(404).json({ error: 'Not Found', method: req.method, path: req.path });
});

app.manageSignals({ signals: ['SIGINT', 'SIGTERM'], timeoutMs: 30_000 });

await app.start({
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  protocols: { http: true, websocket: false, tcp: false, udp: false },
});
