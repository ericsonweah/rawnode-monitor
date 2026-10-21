'use strict';

import Unified from '#unified';

const app = Unified({
  profile: 'production',
  observability: {
    enabled: true,
    prefix: 'rawnode_unified',
    historyLimit: 256,
    eventLoopMonitoring: true,
    eventLoopResolutionMs: 20,
  },
});

app.on('unified:state', (event) => console.log('state:', event));
app.on('unified:starting', ({ options }) => console.log('starting:', options.host, options.port));
app.on('unified:listening', (addresses) => console.log('listening:', addresses));
app.on('unified:draining', (event) => console.log('draining:', event));
app.on('unified:close', (event) => console.log('closed:', event));
app.on('unified:error', (error, context) => console.error('unified error:', error, context));

app.get('/health/live', (_req, res) => {
  const health = app.health();
  res.status(health.live ? 200 : 503).json({ live: health.live, state: health.state });
});

app.get('/health/ready', (_req, res) => {
  const health = app.health();
  res.status(health.ready ? 200 : 503).json(health);
});

app.get('/metrics', (_req, res) => {
  res.type('text/plain; version=0.0.4').send(app.metrics('prometheus'));
});

app.get('/internal/snapshot', (_req, res) => res.json(app.snapshot()));
app.tcp.handle('work', async (_socket, payload, ack) => ack?.({ completed: payload }));
app.udp.on('work', (body, response) => response.reply({ completed: body }));

await app.start({ host: '127.0.0.1', port: Number(process.env.PORT || 3000) });

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping admission and draining.`);

  app.beginDrain({ timeoutMs: 15_000, deadline: Date.now() + 15_000 });
  try {
    await app.waitForIdle(15_000);
    await app.close({ timeoutMs: 15_000, forceCloseTimeoutMs: 2_000, force: true });
  } catch (error) {
    console.error('Shutdown failed:', error);
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
