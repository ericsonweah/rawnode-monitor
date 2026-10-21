'use strict';

import { resolveEventCompatibilityProfile } from '../compatibility/CompatibilityProfile.js';
import { UniversalEventFabric } from '../universal/UniversalEventFabric.js';
import { BrowserEventDispatcher } from './BrowserEventDispatcher.js';
import { BrowserRuntimeAdapter } from './runtime/BrowserRuntimeAdapter.js';
import { WebEventCrypto } from './crypto/WebEventCrypto.js';
import { DomEventTargetAdapter } from './DomEventTargetAdapter.js';
import { BrowserLifecycleAdapter } from './BrowserLifecycleAdapter.js';
import { BrowserIntegrationManager } from './integrations/BrowserIntegrationManager.js';
import {
  BroadcastChannelEventTransport,
  DomCustomEventTransport,
  LiveEventTransport,
  MessagePortEventTransport,
  ServiceWorkerEventTransport,
  WebSocketEventTransport,
} from './transports/index.js';

/** Complete RawNode Universal Event Fabric runtime for windows and workers. */
export class BrowserEventFabric extends UniversalEventFabric {
  constructor(options = {}) {
    const profile = resolveEventCompatibilityProfile(options.profile || options.configuration?.profile || 'compat', options.compatibilityOverrides || {});
    const browser = { ...profile.browser, ...(options.browser || {}) };
    const runtime = options.runtime || new BrowserRuntimeAdapter(options.runtimeOptions || {});
    const dispatcher = options.dispatcher || new BrowserEventDispatcher({
      profile: profile.name,
      normalizeDot: options.normalizeDot === true,
      errorPolicy: options.errorPolicy || (profile.name === 'compat' ? 'isolate' : 'fail-fast'),
      listeners: options.listeners,
      history: options.history,
      context: options.context,
    });
    const cryptoProvider = options.cryptoProvider || createCrypto(options.crypto || options.security || {});
    const transportList = [
      ...(options.transportList || []),
      ...createBrowserTransports({ ...options, browser, profile }),
    ];
    super({
      ...options,
      profile,
      runtime,
      dispatcher,
      cryptoProvider,
      transportList,
      ownTransports: true,
      application: options.application || globalThis.RawNode?.application || null,
      nodeId: options.nodeId || browser.tabId || readTabId(),
    });
    this.browserOptions = Object.freeze(browser);
    this.dom = options.domAdapter || new DomEventTargetAdapter(this, options.document || globalThis.document || null, options.dom || {});
    this.lifecycle = options.lifecycleAdapter || new BrowserLifecycleAdapter(this, {
      ...browser,
      ...(options.lifecycle || {}),
      captureErrors: options.lifecycle?.captureErrors ?? browser.captureErrors,
    });
    this.integrations = options.integrationManager || new BrowserIntegrationManager(this, {
      ...(options.integrations || {}),
      live: options.integrations?.live ?? options.liveIntegration,
      sdspa: options.integrations?.sdspa ?? options.sdspaIntegration,
      reactive: options.integrations?.reactive ?? options.reactiveIntegration,
      view: options.integrations?.view ?? options.viewIntegration,
    });
    this.exposed = false;
  }

  async start(context = {}) {
    await super.start(context);
    if (this.browserOptions.captureLifecycle !== false) this.lifecycle.start();
    if (context.startIntegrations !== false) await this.integrations.start();
    if (this.browserOptions.exposeGlobal !== false) this.exposeGlobal({ replace: context.replaceGlobal === true });
    this.dispatch('events:fabric:browser:started', { profile: this.profile.name, runtime: this.runtime.name, transports: this.transports.names() });
    return this;
  }

  exposeGlobal(options = {}) {
    const root = globalThis.RawNode ||= {};
    const lower = globalThis.rawnode ||= root;
    const key = this.browserOptions.globalKey || 'events';
    root.eventFabric = this;
    root.EventFabric = this;
    root.Events = root.Events || {};
    root.Events.fabric = this;
    root.Events.dispatcher = this.dispatcher;
    root.Events.createContext = (meta) => this.createContext(meta);
    root.Events.target = (target) => this.target(target);
    if (options.replace === true || root[key] == null) root[key] = this.dispatcher;
    if (options.replace === true || lower[key] == null) lower[key] = root[key];
    lower.eventFabric = this;
    this.exposed = true;
    return this;
  }

  target(target = globalThis.document) { return this.dom.target(target); }
  listen(type, options, listener) { return this.dom.listen(type, options, listener); }
  async installIntegrations(options = {}) { await this.integrations.install(options); return this; }

  snapshot() {
    return Object.freeze({
      ...super.snapshot(),
      browser: {
        exposed: this.exposed,
        options: this.browserOptions,
        dom: this.dom.snapshot(),
        lifecycle: this.lifecycle.snapshot(),
        integrations: this.integrations.snapshot(),
      },
    });
  }

  async close(options = {}) {
    try { await this.integrations.close(); } catch {}
    try { this.lifecycle.close(); } catch {}
    try { this.dom.close(); } catch {}
    const snapshot = await super.close(options);
    if (this.exposed) {
      const root = globalThis.RawNode;
      if (root?.eventFabric === this) delete root.eventFabric;
      if (root?.EventFabric === this) delete root.EventFabric;
      if (root?.Events?.fabric === this) delete root.Events.fabric;
      if (globalThis.rawnode?.eventFabric === this) delete globalThis.rawnode.eventFabric;
    }
    this.exposed = false;
    return snapshot;
  }
}

export function createBrowserEventFabric(options = {}) { return new BrowserEventFabric(options); }

function createCrypto(options) {
  if (!options || (!options.secret && !Array.isArray(options.keys))) return null;
  return new WebEventCrypto(options);
}

function createBrowserTransports(options) {
  const transports = [];
  const browser = options.browser || {};
  if (browser.crossTab === true && typeof globalThis.BroadcastChannel === 'function') {
    transports.push(new BroadcastChannelEventTransport({ ...(object(options.crossTab)), channelName: options.crossTab?.channelName || browser.channelName }));
  }
  if ((browser.bridgeDomEvents === true || options.domTransport === true || typeof options.domTransport === 'object') && globalThis.document) {
    transports.push(new DomCustomEventTransport({ ...(object(options.domTransport)), target: options.domTransport?.target || globalThis.document }));
  }
  if ((browser.serviceWorker === true || options.serviceWorker === true || typeof options.serviceWorker === 'object') && (globalThis.navigator?.serviceWorker || globalThis.clients)) {
    transports.push(new ServiceWorkerEventTransport(object(options.serviceWorker)));
  }
  if (options.socket) transports.push(new WebSocketEventTransport(options.socket, object(options.websocket)));
  const live = options.liveRuntime || globalThis.RawNodeLive || globalThis.RawNode?.live || null;
  if (live && options.liveTransport !== false) transports.push(new LiveEventTransport(live, object(options.liveTransport)));
  for (const entry of options.messagePorts || []) {
    const port = entry?.port || entry;
    if (port) transports.push(new MessagePortEventTransport(port, entry?.port ? entry : {}));
  }
  return transports;
}
function object(value) { return value && typeof value === 'object' ? value : {}; }
function readTabId() {
  try {
    const key = 'rawnode.events.tabId';
    let value = globalThis.sessionStorage?.getItem?.(key);
    if (!value) { value = globalThis.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`; globalThis.sessionStorage?.setItem?.(key, value); }
    return value;
  } catch { return globalThis.crypto?.randomUUID?.() || `browser-${Date.now()}`; }
}
export default BrowserEventFabric;
