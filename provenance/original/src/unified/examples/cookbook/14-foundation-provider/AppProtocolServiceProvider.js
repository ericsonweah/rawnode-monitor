'use strict';

// Application-owned protocol registration using UnifiedServerServiceProvider.
// Keep UNIFIED_AUTO_START=false so all routes/handlers are registered before
// this provider explicitly starts the endpoint.
export class AppProtocolServiceProvider {
  static dependencies = ['app'];
  static after = ['UnifiedServerServiceProvider'];
  static priority = 100;

  constructor(app) {
    this.app = app;
  }

  register() {}

  async boot() {
    const unified = this.app.resolve('unified.app');

    unified.get('/', (_req, res) => res.json({ framework: 'RawNode', unified: true }));
    unified.get('/health/live', this.app.resolve('unified.health.handler'));
    unified.get('/health/ready', this.app.resolve('unified.ready.handler'));
    unified.get('/internal/metrics', this.app.resolve('unified.metrics.handler'));

    this.app.resolve('unified.ws').on('connection', (socket) => {
      socket.on('echo', async (payload, ack) => ack?.({ transport: 'websocket', payload }));
    });

    this.app.resolve('unified.tcp').handle('echo', async (_socket, payload, ack) => {
      await ack?.({ transport: 'tcp', payload });
    });

    this.app.resolve('unified.udp').on('echo', (body, response) => {
      response.reply({ transport: 'udp', payload: body });
    });

    const server = await this.app.resolve('unified.start')();
    this.app.resolve('logger')?.info?.('Unified endpoint ready', server.addresses());
  }
}

export default AppProtocolServiceProvider;
