import { writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MonitorRuntime } from '@rawnode/monitor';
import { PMMonitorBridge } from '@rawnode/monitor/integrations';
import { RuntimeAgent, RawNodeRuntimeAdapter } from '@rawnode/pm/runtime';

setTimeout(() => process.exit(124), 15_000).unref();
const monitor = new MonitorRuntime({ profile: 'test', config: {
  profile: 'test', service: 'pm-child-composition', system: { enabled: false },
  resources: { autoDiscover: false }, storage: { enabled: true, driver: 'memory' },
} });
await monitor.start();
monitor.metrics.counter('pm_monitor_composition_total').inc();
monitor.emitEvent('child-composition', { password: 'synthetic-pm-reciprocal-secret' });
monitor.startSpan('child-composition', { attributes: { token: 'synthetic-pm-reciprocal-secret' } }).end();
monitor.registerHealth('composition-secret', () => ({ ok: true, details: { token: 'synthetic-pm-reciprocal-secret', marker: 'visible-pm-fixture' } }));
const adapter = new RawNodeRuntimeAdapter({ incidentDir: process.env.INCIDENT_DIR, callbackTimeoutMs: 1_000 });
const runtime = new RuntimeAgent({ adapter, intervalMs: 250, callbackTimeoutMs: 2_000, autoExit: false });
await writeFile(path.join(process.env.INCIDENT_DIR, 'identity.json'), JSON.stringify({ pid: process.pid, execPath: process.execPath, node: process.version }));
process.once('exit', code => writeFileSync(path.join(process.env.INCIDENT_DIR, 'exit.json'), JSON.stringify({ code, monitorClosed: monitor.closed, runtimeClosed: runtime.closed, bridgeStarted: bridge.started, ownedMonitorTimers: monitor.timers.size })));
runtime.on('packet', packet => { if (packet.type === 'runtime:shutdown-complete' && process.connected) process.disconnect(); });
const bridge = new PMMonitorBridge(runtime, monitor);
bridge.start();
adapter.registerResource('monitor-lifecycle', { shutdown: async () => {
  await bridge.close();
  await monitor.close();
  await writeFile(path.join(process.env.INCIDENT_DIR, 'shutdown.json'), JSON.stringify({ monitorClosed: monitor.closed, bridgeStarted: bridge.started }));
  return { ok: true };
} });
runtime.start().ready({ composition: 'fresh-exact-pm-monitor' });
