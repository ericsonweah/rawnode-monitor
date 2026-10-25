import { RawNodeRuntimeAdapter, RuntimeAgent } from '@rawnode/pm/runtime';
import { MonitorRuntime } from '@rawnode/monitor';
import { PMMonitorBridge } from '@rawnode/monitor/integrations';

const adapter = new RawNodeRuntimeAdapter();
const runtime = new RuntimeAgent({ adapter, captureSignals: false, autoExit: false });
const monitor = new MonitorRuntime({ profile: 'test' });
for (const owner of [adapter, runtime, { runtime }, { adapter }]) {
  const bridge = new PMMonitorBridge(owner, monitor);
  bridge.start();
  const started: boolean = bridge.snapshot().started;
  void started;
  void bridge.close();
}
adapter.registerResource('monitor', {
  health: () => monitor.health(), metrics: () => monitor.metricsSnapshot(), diagnostics: () => monitor.diagnostics(),
});
const removed: boolean = adapter.unregisterResource('monitor');
void removed;
