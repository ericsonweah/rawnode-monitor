export default {
  options: {
    resurrectOnDaemonStart: true,
  },

  apps: [
    {
      name: 'rawnode-api',
      script: './raw',
      args: ['serve', '3000'],
      mode: 'cluster',
      instances: 'auto',

      readiness: {
        mode: 'ipc',
        timeoutMs: 30000,
      },

      health: {
        enabled: true,
        heartbeatTimeoutMs: 12000,
        unhealthyThreshold: 3,
      },

      restart: {
        maxRestarts: 10,
        windowMs: 60000,
        stableMs: 30000,
        minDelayMs: 100,
        maxDelayMs: 30000,
        factor: 2,
        jitter: 0.2,
      },

      shutdown: {
        graceMs: 15000,
        killMs: 5000,
      },

      watch: {
        enabled: process.env.NODE_ENV !== 'production',
        mode: 'reload',
        paths: ['app', 'src', 'config', 'resources'],
        ignore: ['node_modules/**', '.git/**', 'storage/**', '*.log'],
        debounceMs: 250,
      },
    },
  ],
};
