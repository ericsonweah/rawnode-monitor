'use strict';

import { AdvancedEventDispatcher } from '../AdvancedEventDispatcher.js';
import { resolveEventCompatibilityProfile } from '../compatibility/CompatibilityProfile.js';
import { UniversalEventFabric } from '../universal/UniversalEventFabric.js';
import { NodeRuntimeAdapter } from './runtime/NodeRuntimeAdapter.js';
import { NodeEventCrypto } from './crypto/NodeEventCrypto.js';
import {
  IpcEventTransport,
  RawNodeTcpEventTransport,
  RawNodeUdpEventTransport,
  RawNodeWebSocketEventTransport,
  RedisPubSubEventTransport,
  RedisStreamsEventTransport,
} from './transports/index.js';

export class NodeEventFabric extends UniversalEventFabric {
  constructor(options = {}) {
    const profile = resolveEventCompatibilityProfile(options.profile || options.configuration?.profile || 'compat', options.compatibilityOverrides || {});
    const dispatcher = options.dispatcher || new AdvancedEventDispatcher({
      profile: profile.name,
      ...(options.bus || {}),
      context: options.context,
      metrics: options.dispatcherMetrics,
      diagnostics: options.dispatcherDiagnostics,
    });
    const runtime = options.runtime || new NodeRuntimeAdapter(options.runtimeOptions || {});
    const cryptoProvider = options.cryptoProvider || createCrypto(options.crypto || options.security || {});
    super({
      ...options,
      profile,
      dispatcher,
      runtime,
      cryptoProvider,
      transportList: [...(options.transportList || []), ...createNodeTransports(options)],
      ownTransports: true,
      application: options.application || options.app?.name || process.env.APP_NAME || null,
      nodeId: options.nodeId || process.env.RAWNODE_NODE_ID || runtime.id,
    });
    this.expose = options.exposeGlobal === true || options.global === true;
    this.globalKey = options.globalKey || 'events';
    this.ownsDispatcher = !options.dispatcher;
  }

  async start(context = {}) {
    await super.start(context);
    if (this.expose) this.exposeGlobal();
    this.dispatch('events:fabric:node:started', { profile: this.profile.name, runtime: this.runtime.id, transports: this.transports.names() });
    return this;
  }

  exposeGlobal() {
    if (globalThis[this.globalKey] == null || globalThis[this.globalKey] === this.dispatcher) globalThis[this.globalKey] = this.dispatcher;
    globalThis.RawNode ||= {};
    globalThis.RawNode.events = globalThis[this.globalKey];
    globalThis.RawNode.eventFabric = this;
    return this;
  }

  async close(options = {}) {
    const snapshot = await super.close(options);
    if (globalThis.RawNode?.eventFabric === this) delete globalThis.RawNode.eventFabric;
    if (this.ownsDispatcher && options.closeDispatcher !== false) await this.dispatcher.close?.(options);
    this.cryptoProvider?.close?.();
    return snapshot;
  }
}

export function createNodeEventFabric(options = {}) { return new NodeEventFabric(options); }

function createCrypto(options) {
  if (!options || (!options.secret && !Array.isArray(options.keys))) return null;
  return new NodeEventCrypto(options);
}

function createNodeTransports(options) {
  const output = [];
  if (options.redis && options.redisPubSub !== false) output.push(new RedisPubSubEventTransport(options.redis, object(options.redisPubSub)));
  if (options.redis && options.redisStreams) output.push(new RedisStreamsEventTransport(options.redis, object(options.redisStreams)));
  if (options.websocket || options.ws) output.push(new RawNodeWebSocketEventTransport(options.websocket || options.ws, object(options.websocketTransport)));
  if (options.tcp) output.push(new RawNodeTcpEventTransport(options.tcp, object(options.tcpTransport)));
  if (options.udp) output.push(new RawNodeUdpEventTransport(options.udp, object(options.udpTransport)));
  if (options.ipc === true) output.push(new IpcEventTransport(process, {}));
  else if (options.ipc && typeof options.ipc === 'object') output.push(new IpcEventTransport(options.ipc.endpoint || options.ipc, options.ipc.endpoint ? options.ipc : {}));
  return output;
}
function object(value) { return value && typeof value === 'object' ? value : {}; }
export default NodeEventFabric;
