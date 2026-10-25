import assert from 'node:assert/strict';
import { mock } from 'node:test';

const observations = { node: process.version, executable: process.execPath, native: {}, mocked: {}, compatibleAdapter: {} };
const outcome = operation => { try { operation(); return { ok: true }; } catch (error) { return { ok: false, name: error.name, message: error.message }; } };
for (const [label, value] of [['null', null], ['undefined', undefined]]) observations.native[label] = outcome(() => clearInterval(value));
assert.ok(Object.values(observations.native).every(row => row.ok));
const nativeClearInterval = globalThis.clearInterval;
mock.timers.enable({ apis: ['setInterval'] });
const mockedClearInterval = globalThis.clearInterval;
try {
  for (const [label, value] of [['null', null], ['undefined', undefined]]) observations.mocked[label] = outcome(() => clearInterval(value));
  globalThis.clearInterval = timer => { if (timer != null) return mockedClearInterval(timer); };
  for (const [label, value] of [['null', null], ['undefined', undefined]]) observations.compatibleAdapter[label] = outcome(() => clearInterval(value));
  let activeTicks = 0, cancelledTicks = 0;
  const active = setInterval(() => activeTicks++, 1000);
  const cancelled = setInterval(() => cancelledTicks++, 1000);
  clearInterval(cancelled);
  mock.timers.tick(3000);
  assert.equal(activeTicks, 3);
  assert.equal(cancelledTicks, 0);
  clearInterval(active);
  mock.timers.tick(2000);
  assert.equal(activeTicks, 3);
  observations.control = { activeTicks, cancelledTicks, cancellationRetained: true, schedulingRetained: true };
} finally {
  mock.timers.reset();
  globalThis.clearInterval = nativeClearInterval;
}
console.log(JSON.stringify(observations, null, 2));
