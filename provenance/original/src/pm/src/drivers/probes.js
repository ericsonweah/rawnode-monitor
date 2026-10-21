'use strict';

import net from 'node:net';
import { sleep, withTimeout } from '../support/async.js';

async function httpProbe(probe) {
  const url = probe.url || `http://${probe.host}:${probe.port}${probe.path || '/'}`;
  const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(probe.timeoutMs) });
  return response.status === probe.expectedStatus;
}

async function tcpProbe(probe) {
  return withTimeout(new Promise((resolve, reject) => {
    const socket = net.connect({ host: probe.host, port: probe.port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', reject);
  }), probe.timeoutMs, { message: `TCP readiness probe timed out after ${probe.timeoutMs}ms` });
}

export async function waitForProbe(probe, options = {}) {
  const deadline = Date.now() + probe.timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw options.signal.reason || new Error('Probe aborted');
    try {
      const ok = probe.mode === 'http' ? await httpProbe(probe) : await tcpProbe(probe);
      if (ok) return true;
    } catch (error) { lastError = error; }
    await sleep(probe.intervalMs, options.signal);
  }
  const error = new Error(`Readiness probe '${probe.mode}' failed for ${probe.url || `${probe.host}:${probe.port}`}.`);
  error.code = 'RNPM_READINESS_FAILED';
  error.cause = lastError;
  throw error;
}
