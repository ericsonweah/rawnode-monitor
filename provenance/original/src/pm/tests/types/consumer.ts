import {
  ProcessDefinition,
  ProcessManager,
  RuntimeAgent,
  StartupGenerator,
  formatPrometheus,
  type ProcessGroupSnapshot,
} from '../../types/index.js';

const definition = new ProcessDefinition({
  name: 'api',
  script: './server.js',
  mode: 'cluster',
  instances: 2,
  readiness: { mode: 'ipc', timeoutMs: 30_000 },
  watch: { enabled: true, mode: 'reload', paths: ['src'] },
});

const manager = new ProcessManager({ stateDir: '/tmp/rawnode-pm-types' });
const started: Promise<ProcessGroupSnapshot | ProcessGroupSnapshot[]> = manager.startProcesses({ definition: definition.toJSON() });
void started;

const runtime = new RuntimeAgent({ managed: true });
runtime.start().ready({ port: 3000 });

const startup = new StartupGenerator({ binPath: '/opt/rawnode/rawnode-pm.js' });
const unit: string = startup.systemd();
void unit;

const metrics: string = formatPrometheus({ registry: manager.registry, metrics: manager.metrics });
void metrics;
