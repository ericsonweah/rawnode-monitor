# @rawnode/monitor

Private standalone preparation of RawNode Monitor, owned by First Principle Lab LLC. Version **1.0.0 is provisional**, retained from the source `MONITOR_VERSION`. Node.js 22 or newer, ESM, zero runtime/dev/peer/optional dependencies. The package starts no listener, process manager, daemon, exporter, or timer merely by importing it.

```js
import { MonitorRuntime } from '@rawnode/monitor';

const monitor = new MonitorRuntime({
  config: {
    profile: 'test', service: 'my-service',
    storage: { enabled: true, driver: 'memory' },
    system: { enabled: false },
  },
});
const requests = monitor.metrics.counter('requests_total');
monitor.registerHealth('database', async ({ signal }) => {
  // Pass signal to your dependency's health operation.
  return { ok: true };
});
await monitor.start();
requests.inc({ route: '/orders' });
await monitor.trace('orders.list', async () => { /* application work */ });
console.log(await monitor.readiness());
await monitor.close();
```

Use fixed route templates and bounded labels. `start()` coalesces concurrent calls. `close()` is idempotent and terminal: create a fresh runtime for a restart. Callbacks receive cancellation where supported and must cooperate to release their own resources. Monitor bounds its waiting; it cannot forcibly stop arbitrary JavaScript.

HTTP middleware labels unmatched requests as `route: 'unmatched'`; supply a route template or resolver for useful route-specific series. Replacing a health check invalidates its cached result, and its old disposer cannot remove the replacement. Direct HTTP exporter close cancels pending delivery attempts; file-store close drains writes admitted before close, including deferred initialization. Studio Cancel dismisses operator prompts without submitting a mutation; submitting an empty silence rule ID intentionally selects all rules.

Capabilities include counters/gauges/histograms/timers, tracing and sampling, health/readiness/liveness, resource collection, bounded signal queues, memory/file/injected RawMongo/composite storage, retention, callback/event/HTTP/OTLP-JSON/StatsD exporters, alerts/silences/notifications, SLOs, incidents/runbooks, anomaly/leak/correlation analysis, synthetic checks, plugins, fleet/Redis adapters, deployment markers, diagnostic bundles, console command classes and testing helpers. Existing source capabilities are retained.

Optional entrypoints: `/studio`, `/studio/client`, `/provider`, `/config`, plus all capability groups listed in [API](docs/API.md). Studio ships the preserved frontend and CSS, with mount/destroy cleanup. The backend can register routes on an injected router; the package never opens a port automatically.

```js
import { MonitorStudioManager, registerMonitorStudioRoutes } from '@rawnode/monitor/studio';
const studio = new MonitorStudioManager({ monitor });
registerMonitorStudioRoutes(yourRouter, { studio });
// Shutdown: close Studio clients, then Monitor, then the server you own.
await studio.close();
```

PM integration requires no package dependency:

```js
import { PMMonitorBridge } from '@rawnode/monitor/integrations';
const bridge = new PMMonitorBridge(yourPmAdapter, monitor);
bridge.start();
await bridge.close();
```

Run `npm run build`, `npm test`, `node examples/basic.mjs`, and `npm pack --offline`. No install is needed. Type validation uses optional, already installed `tsc`; it is not a package dependency. `examples/studio-fixture.mjs` creates only a task-owned ephemeral 127.0.0.1 server using synthetic data; send `close` to stdin or let its 15-minute TTL expire. It is a development fixture, not a production server.

See [configuration](docs/CONFIGURATION.md), [API](docs/API.md), [lifecycle](docs/LIFECYCLE.md), [security](docs/SECURITY.md), [Studio browser checklist](docs/STUDIO.md), [migration and compatibility](docs/MIGRATION.md), [release procedure](docs/PUBLICATION.md), and [validation](docs/VALIDATION.md). The complete source/provenance archive preserves originals and hashes. `private: true` and a rejecting publication lifecycle guard remain enabled. License provenance is unresolved; see [NOTICE](NOTICE.md).
