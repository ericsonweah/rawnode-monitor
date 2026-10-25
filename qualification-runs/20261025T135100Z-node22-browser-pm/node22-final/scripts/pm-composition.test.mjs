import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { MonitorRuntime } from '@rawnode/monitor';
import { PMMonitorBridge } from '@rawnode/monitor/integrations';
import { RawNodeRuntimeAdapter, RuntimeAgent, Supervisor } from '@rawnode/pm';

const pins = JSON.parse(await readFile(new URL('./composition-pins.json', import.meta.url), 'utf8'));
const config = { profile: 'test', service: 'pm-monitor-composition', system: { enabled: false }, resources: { autoDiscover: false }, storage: { enabled: true, driver: 'memory' } };
const secret = 'synthetic-pm-reciprocal-secret';

test('exact final Monitor and accepted PM archive pins', async () => {
  for (const pin of [pins.monitor, pins.pm]) {
    const bytes = await readFile(pin.archive);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
    assert.equal(bytes.length, pin.bytes);
  }
});

for (const shape of ['direct', 'runtime', 'adapter']) test(`fresh installed Monitor bridge attach/query/redacted diagnostics/detach: ${shape}`, { timeout: 8_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'monitor-pm-paired-'));
  const listenerEvents = ['message', 'disconnect', 'uncaughtExceptionMonitor', 'SIGTERM', 'SIGINT'];
  const listeners = listenerEvents.map(name => process.listenerCount(name));
  const monitor = new MonitorRuntime({ profile: 'test', config });
  const adapter = new RawNodeRuntimeAdapter({ incidentDir: directory, callbackTimeoutMs: 1_000 });
  const runtime = new RuntimeAgent({ adapter, managed: false, autoExit: false, captureSignals: false });
  const owner = shape === 'direct' ? runtime : { [shape]: shape === 'runtime' ? runtime : adapter };
  const bridge = new PMMonitorBridge(owner, monitor, { name: 'monitor' });
  try {
    await monitor.start();
    monitor.metrics.counter('composition_metric_total').inc();
    monitor.emitEvent('paired', { password: secret });
    monitor.startSpan('paired', { attributes: { token: secret } }).end();
    monitor.registerHealth('composition-secret', () => ({ ok: true, details: { token: secret, marker: 'visible-pm-fixture' } }));
    bridge.start().start();
    assert.equal(bridge.snapshot().started, true);
    assert.equal((await adapter.health()).resources.monitor.ok, true);
    assert.match(JSON.stringify(await adapter.metrics()), /composition_metric_total/);
    const diagnostics = await adapter.diagnostics();
    assert.ok(diagnostics.resources.monitor);
    assert.match(JSON.stringify(diagnostics), /visible-pm-fixture/);
    assert.equal(JSON.stringify(diagnostics).includes(secret), false);
    const disk = await readFile(diagnostics.file, 'utf8');
    assert.equal(disk.includes(secret), false);
    assert.match(disk, /visible-pm-fixture/);
    assert.ok(JSON.parse(disk).resources.monitor);
    await bridge.close();
    await bridge.close();
    assert.equal(adapter.resources.has('monitor'), false);
    assert.equal(monitor.closed, false);
    bridge.start();
    assert.equal(adapter.resources.has('monitor'), true);
    await bridge.close();
  } finally {
    await bridge.close();
    await runtime.close();
    await runtime.close();
    await monitor.close();
    await rm(directory, { recursive: true, force: true });
  }
  assert.deepEqual(listenerEvents.map(name => process.listenerCount(name)), listeners);
});

test('fresh installed Monitor health, metrics and redacted diagnostics traverse actual PM child IPC and shutdown', { timeout: 12_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'monitor-pm-child-'));
  const supervisor = new Supervisor();
  try {
    await supervisor.start({ name: 'composition-child', script: fileURLToPath(new URL('./pm-worker.mjs', import.meta.url)),
      inheritEnv: false, env: { INCIDENT_DIR: directory }, readiness: { mode: 'ipc', timeoutMs: 3_000 },
      shutdown: { graceMs: 300, killMs: 300 }, telemetry: { intervalMs: 250 },
      logs: { enabled: false }, health: { enabled: true, timeoutMs: 1_500 },
    });
    const record = supervisor.registry.active('composition-child', 0);
    assert.ok(record.pid > 0);
    const identity = JSON.parse(await readFile(path.join(directory, 'identity.json'), 'utf8'));
    assert.equal(identity.pid, record.pid);
    assert.equal(identity.execPath, process.execPath);
    assert.equal(identity.node, process.version);
    const health = await supervisor._requestRuntime(record, 'supervisor:health', {}, 2_000);
    assert.equal(health.resources.monitor.ok, true);
    const metrics = await supervisor._requestRuntime(record, 'supervisor:metrics', {}, 2_000);
    assert.match(JSON.stringify(metrics), /pm_monitor_composition_total/);
    const diagnostics = await supervisor.diagnostics('composition-child', { timeoutMs: 3_000 });
    const result = diagnostics.diagnostics[0].result;
    assert.equal(result.ok, true);
    assert.ok(result.resources.monitor);
    assert.match(JSON.stringify(result), /visible-pm-fixture/);
    assert.equal(JSON.stringify(result).includes(secret), false);
    const disk = await readFile(result.file, 'utf8');
    assert.equal(disk.includes(secret), false);
    assert.match(disk, /visible-pm-fixture/);
    assert.ok(JSON.parse(disk).resources.monitor);
    await supervisor.stop('composition-child');
    assert.equal(supervisor.registry.active('composition-child').length, 0);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'shutdown.json'), 'utf8')), { monitorClosed: true, bridgeStarted: false });
    assert.equal(supervisor.pendingRuntimeRequests.size, 0);
    assert.equal(record.exitCode, 0);
    assert.equal(record.signal, null);
    const naturalExit = JSON.parse(await readFile(path.join(directory, 'exit.json'), 'utf8'));
    assert.deepEqual(naturalExit, { code: 0, monitorClosed: true, runtimeClosed: true, bridgeStarted: false, ownedMonitorTimers: 0 });
    console.log(JSON.stringify({ taskOwnedChild: identity, exitCode: record.exitCode, signal: record.signal, naturalExit, pendingRuntimeRequests: supervisor.pendingRuntimeRequests.size }));
  } finally {
    await supervisor.close();
    await supervisor.close();
    await rm(directory, { recursive: true, force: true });
  }
});
