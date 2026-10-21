import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MonitorRuntime, PMMonitorBridge } from '@rawnode/monitor';
import { RawNodeRuntimeAdapter, RuntimeAgent } from '@rawnode/pm';

const secret = 'synthetic-pm-composition-secret';
const directory = await mkdtemp(path.join(os.tmpdir(), 'monitor-pm-direct-'));
const adapter = new RawNodeRuntimeAdapter({ callbackTimeoutMs: 1_000, incidentDir: directory });
const monitor = new MonitorRuntime({ profile: 'test', config: {
  profile: 'test', service: 'pm-composition-fixture', system: { enabled: false },
  resources: { autoDiscover: false }, storage: { enabled: true, driver: 'memory' },
} });
const listenerEvents = ['message', 'disconnect', 'uncaughtExceptionMonitor', 'SIGTERM', 'SIGINT'];
const listeners = listenerEvents.map(name => process.listenerCount(name));
const shapes = [];
let agent;
let bridge;
try {
  await monitor.start();
  monitor.metrics.counter('composition_metric_total').inc();
  monitor.emitEvent('fixture', { password: secret });
  monitor.startSpan('fixture', { attributes: { token: secret } }).end();
  monitor.registerHealth('composition-secret', () => ({ ok: true, details: { password: secret, marker: 'visible-pm-fixture' } }));
  agent = new RuntimeAgent({ adapter, managed: false, captureSignals: false, autoExit: false });
  agent.start().start();
  assert.equal(process.listenerCount('message'), listeners[0] + 1);
  assert.equal(process.listenerCount('uncaughtExceptionMonitor'), listeners[2] + 1);
  for (const [shape, owner] of [['direct', adapter], ['runtime', { runtime: adapter }], ['adapter', { adapter }], ['RuntimeAgent', agent]]) {
    bridge = new PMMonitorBridge(owner, monitor);
    bridge.start().start();
    assert.equal(adapter.resources.size, 1);
    assert.equal((await adapter.health()).resources.monitor.ok, true);
    assert.match(JSON.stringify(await adapter.metrics()), /composition_metric_total/);
    const diagnostics = await adapter.diagnostics();
    assert.equal(diagnostics.ok, true);
    assert.ok(diagnostics.resources.monitor);
    assert.match(JSON.stringify(diagnostics), /visible-pm-fixture/);
    assert.equal(JSON.stringify(diagnostics).includes(secret), false);
    const disk = await readFile(diagnostics.file, 'utf8');
    assert.equal(disk.includes(secret), false);
    assert.match(disk, /visible-pm-fixture/);
    assert.ok(JSON.parse(disk).resources.monitor);
    await bridge.close();
    await bridge.close();
    assert.equal(adapter.resources.size, 0);
    assert.equal(monitor.closed, false);
    shapes.push(shape);
  }
  await agent.close();
  await agent.close();
  assert.deepEqual(listenerEvents.map(name => process.listenerCount(name)), listeners);
  console.log(JSON.stringify({ ok: true, shapes, contracts: [
    'fluent PM registration and boolean removal', 'health and metrics',
    'returned and disk diagnostic redaction', 'idempotent bridge/agent detach',
    'bridge does not own Monitor close', 'unchanged process listener counts',
  ], scope: 'fresh installed exact archives; synthetic telemetry; no daemon or external service' }));
} finally {
  await bridge?.close();
  await agent?.close();
  await monitor.close();
  await rm(directory, { recursive: true, force: true });
}
