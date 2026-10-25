import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import MonitorConfiguration from '../../../package/src/config/MonitorConfiguration.js';

const run = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(run, '../..');
const files = [
  'package/src/config/MonitorConfiguration.js',
  'package/src/compatibility/CompatibilityProfile.js',
  'package/src/MonitorRuntime.js',
  'package/src/storage/createTelemetryStore.js',
  'package/src/storage/RawMongoTelemetryStore.js',
  'package/src/cluster/RedisMonitorBridge.js',
  'package/src/cluster/LeaderLease.js',
  'package/src/cluster/MonitorClusterEnvelope.js',
  'package/src/cluster/FleetRegistry.js',
  'package/src/exporters/OtlpJsonExporter.js',
  'package/src/exporters/StatsdExporter.js',
  'package/src/alerts/NotificationRouter.js',
  'package/src/integrations/RawNodeIntegrationManager.js',
  'package/src/integrations/EventMonitorBridge.js',
  'package/src/integrations/LoggerMonitorBridge.js',
  'package/src/integrations/ProtocolMonitorBridge.js',
  'package/src/provider/MonitorServiceProvider.js',
  'package/src/diagnostics/DiagnosticBundleBuilder.js',
  'package/docs/CONFIGURATION.md',
  'package/docs/SECURITY.md',
];
const sourceHashes = {};
for (const file of files) sourceHashes[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
const profiles = {};
for (const profile of ['compat', 'test', 'enterprise', 'production', 'strict']) {
  const input = { profile, environment: 'development' };
  const configuration = new MonitorConfiguration(input, { root: path.join(run, 'illustrative-root-not-created') });
  profiles[profile] = { input, snapshot: configuration.snapshot(), validation: configuration.validate() };
}
const productionEnvironment = new MonitorConfiguration({ profile: 'production', environment: 'production' }, { root: path.join(run, 'illustrative-root-not-created') });
const receipt = {
  observedAt: new Date().toISOString(),
  command: [process.execPath, fileURLToPath(import.meta.url)],
  cwd: process.cwd(),
  runtime: { node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch },
  scope: 'Pure configuration construction and source hashing only. No MonitorRuntime, service client, collector, server, notification, production key or process manager was started. The illustrative root was not created.',
  sourceHashes,
  profiles,
  productionEnvironment: { input: { profile: 'production', environment: 'production' }, snapshot: productionEnvironment.snapshot(), validation: productionEnvironment.validate() },
};
await writeFile(path.join(run, 'operator-defaults.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ result: 'PASS', profiles: Object.keys(profiles), productionEnvironment: true, output: path.join(run, 'operator-defaults.json') }));
