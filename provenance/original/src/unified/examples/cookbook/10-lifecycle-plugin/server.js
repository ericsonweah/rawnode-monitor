'use strict';

import Unified from '#unified';

const lifecyclePlugin = {
  name: 'deployment-audit',

  async beforeStart({ options }) {
    console.log('[plugin] beforeStart', { host: options.host, port: options.port });
  },

  async afterStart({ health }) {
    console.log('[plugin] afterStart', { ready: health.ready, degraded: health.degraded });
  },

  async beforeDrain({ options }) {
    console.log('[plugin] beforeDrain', options);
  },

  async beforeClose({ shutdown }) {
    console.log('[plugin] beforeClose', shutdown);
  },

  async afterClose({ forced, error }) {
    console.log('[plugin] afterClose', { forced, error: error?.message || null });
  },

  async onError({ error, phase }) {
    console.error('[plugin] unified failure', { phase, message: error?.message });
  },
};

const app = Unified({ profile: 'enterprise', plugins: [lifecyclePlugin] });

// Equivalent additive registration:
app.useUnifiedPlugin((manager) => ({
  name: 'address-observer',
  afterStart() {
    console.log('[plugin] addresses', manager.addresses());
  },
}));

app.get('/', (_req, res) => res.send('Plugin-enabled Unified server'));
app.manageSignals({ signals: ['SIGINT', 'SIGTERM'], timeoutMs: 15_000 });
await app.start({ host: '127.0.0.1', port: Number(process.env.PORT || 3000) });
