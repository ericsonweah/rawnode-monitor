import { MonitorRuntime } from '@rawnode/monitor';

const monitor = new MonitorRuntime({
  profile: 'test',
  config: { profile: 'test', service: 'example', system: { enabled: false }, storage: { enabled: true, driver: 'memory' } },
});
const requests = monitor.metrics.counter('example_requests_total');
monitor.registerHealth('fixture', () => ({ ok: true }), { kind: 'readiness' });
await monitor.start();
await monitor.trace('example.operation', async () => { requests.inc({ route: '/example' }); });
console.log(JSON.stringify({ ready: (await monitor.readiness()).ok, state: monitor.state }));
await monitor.close();
