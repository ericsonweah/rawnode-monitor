'use strict';

import { RuntimeAgent } from '../../src/runtime/RuntimeAgent.js';

const adapter = {
  async health() { return { ok: process.env.APP_HEALTH_FAIL !== '1', ready: true }; },
  async metrics() { return { fixture: { pid: process.pid, marker: process.env.APP_MARKER || null } }; },
  async drain() {
    process.stdout.write(`draining:${process.pid}\n`);
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.DRAIN_DELAY_MS || 10)));
    return { ok: true };
  },
  async shutdown() {
    process.stdout.write(`shutdown:${process.pid}\n`);
    if (heartbeat) clearInterval(heartbeat);
    return { ok: true };
  },
  async reloadConfig() { return { ok: true }; },
  async diagnostics() { return { ok: true, fixture: true, pid: process.pid }; },
};

const runtime = new RuntimeAgent({ adapter, intervalMs: Number(process.env.RAWNODE_PM_TELEMETRY_INTERVAL || 100), eventLoopResolution: 10 });
runtime.start({ fixture: true });
process.stdout.write(`online:${process.pid}\n`);

if (process.env.CRASH_ALWAYS === '1') {
  setTimeout(() => process.exit(42), Number(process.env.CRASH_DELAY_MS || 20));
} else {
  setTimeout(() => runtime.ready({ fixture: true, marker: process.env.APP_MARKER || null }), Number(process.env.READY_DELAY_MS || 20));
}

const heartbeat = setInterval(() => {}, 1_000);
heartbeat.unref?.();
