'use strict';

import { RuntimeAgent } from '../runtime/RuntimeAgent.js';
import { RawNodeRuntimeAdapter } from '../runtime/RawNodeRuntimeAdapter.js';

export function attachRawNodeRuntime(app, options = {}) {
  const adapter = options.adapter || new RawNodeRuntimeAdapter({ app, ...options });
  const runtime = options.runtime || new RuntimeAgent({ adapter, ...options });
  runtime.start({ framework: 'rawnode' });
  for (const server of options.servers || []) runtime.trackServer(server);
  if (options.server) runtime.trackServer(options.server, { name: options.serverName || 'main' });
  if (options.ready === true) runtime.ready(options.readyMeta || {});
  return runtime;
}

export default attachRawNodeRuntime;
