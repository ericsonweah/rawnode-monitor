'use strict';

import { EventEmitter } from 'node:events';
import { RAWNODE_RESOURCE_CATALOG } from './RawNodeResourceCatalog.js';
import { callFirst, deepFreeze, errorRecord, safeResolve, withTimeout } from '../support.js';

export class ResourceRegistry extends EventEmitter {
  constructor(options = {}) {
    super();
    this.app = options.app || null;
    this.timeoutMs = Math.max(1, Number(options.timeoutMs) || 5_000);
    this.maxPayloadBytes = Math.max(1_024, Number(options.maxPayloadBytes) || 512 * 1024);
    this.serializer = options.serializer || null;
    this.healthRegistry = options.healthRegistry || null;
    this.resources = new Map();
    this.pending = new WeakMap();
    this.latest = new Map();
    this.frozen = false;
    this.stats = { registered: 0, discovered: 0, collections: 0, errors: 0, oversized: 0 };
  }

  register(name, resource, options = {}) {
    if (!name || !resource) throw new TypeError('ResourceRegistry.register(name, resource) requires both values.');
    if (this.frozen) throw new Error('Resource registry is frozen.');
    const key = String(name).toLowerCase();
    if (this.resources.has(key) && options.replace !== true) return this.resources.get(key);
    const record = {
      name: key,
      resource,
      critical: options.critical === true,
      required: options.required === true,
      health: options.health || null,
      metrics: options.metrics || null,
      diagnostics: options.diagnostics || null,
      timeoutMs: Math.max(1, Number(options.timeoutMs) || this.timeoutMs),
      tags: Object.freeze(Array.from(new Set(options.tags || []))),
      sourceBinding: options.sourceBinding || null,
    };
    if (this.resources.has(key)) this.healthRegistry?.unregister(`resource.${key}`);
    this.resources.set(key, record);
    this.stats.registered++;
    if (this.healthRegistry && (record.health || hasMethod(resource, ['health', 'readiness', 'liveness', 'ping']))) {
      this.healthRegistry.register(`resource.${key}`, async ({ signal }) => {
        const snapshot = await this.collectOne(key, { metrics: false, health: true, signal });
        return snapshot.health || { ok: !snapshot.error, details: snapshot };
      }, { kind: 'dependency', critical: record.critical || record.required, timeoutMs: record.timeoutMs, tags: ['resource', key] });
    }
    this.emit('registered', publicRecord(record));
    return record;
  }

  unregister(name) { this.healthRegistry?.unregister(`resource.${String(name).toLowerCase()}`); this.latest.delete(String(name).toLowerCase()); return this.resources.delete(String(name).toLowerCase()); }
  freeze() { this.frozen = true; return this; }
  list() { return Object.freeze(Array.from(this.resources.values(), publicRecord)); }

  discover(app = this.app, options = {}) {
    const include = options.include?.length ? new Set(options.include.map((name) => String(name).toLowerCase())) : null;
    const exclude = new Set((options.exclude || []).map((name) => String(name).toLowerCase()));
    const required = new Set((options.required || []).map((name) => String(name).toLowerCase()));
    const discovered = [];
    for (const descriptor of options.catalog || RAWNODE_RESOURCE_CATALOG) {
      if ((include && !include.has(descriptor.name)) || exclude.has(descriptor.name) || this.resources.has(descriptor.name)) continue;
      let resource = null;
      let binding = null;
      for (const candidate of descriptor.bindings) {
        resource = safeResolve(app, candidate, null);
        if (resource != null) { binding = candidate; break; }
      }
      if (resource == null) continue;
      const record = this.register(descriptor.name, resource, {
        required: required.has(descriptor.name),
        critical: required.has(descriptor.name),
        sourceBinding: binding,
        health: () => callResource(resource, descriptor.healthMethods),
        metrics: () => callResource(resource, descriptor.metricMethods),
      });
      discovered.push(publicRecord(record));
      this.stats.discovered++;
    }
    return Object.freeze(discovered);
  }

  async collect(options = {}) {
    const output = Object.create(null);
    const names = options.names ? new Set(options.names.map((name) => String(name).toLowerCase())) : null;
    for (const name of this.resources.keys()) {
      if (!names || names.has(name)) output[name] = await this.collectOne(name, options);
    }
    return deepFreeze({ timestamp: Date.now(), resources: output });
  }

  async collectOne(name, options = {}) {
    const key = String(name).toLowerCase();
    const record = this.resources.get(key);
    if (!record) return null;
    this.stats.collections++;
    const started = process.hrtime.bigint();
    const snapshot = { name: key, timestamp: Date.now(), sourceBinding: record.sourceBinding, health: null, metrics: null, diagnostics: null, error: null };
    try {
      await withTimeout((signal) => {
        if (this.pending.has(record)) throw Object.assign(new Error('Resource collector is still pending.'), {code:'MONITOR_COLLECTOR_BUSY'});
        const task = (async () => {
        if (options.health !== false) { const value = await invoke(record.health, record.resource, ['health', 'readiness', 'liveness', 'ping'], signal); signal.throwIfAborted(); snapshot.health = value; }
        if (options.metrics !== false) { const value = await invoke(record.metrics, record.resource, ['metrics', 'snapshot', 'stats', 'getStats'], signal); signal.throwIfAborted(); snapshot.metrics = value; }
        if (options.diagnostics === true) { const value = await invoke(record.diagnostics, record.resource, ['diagnostics', 'inspect'], signal); signal.throwIfAborted(); snapshot.diagnostics = value; }
        })();
        this.pending.set(record, task);
        task.finally(() => this.pending.delete(record)).catch(() => {});
        return task;
      }, record.timeoutMs, { signal: options.signal, message: `Monitor resource '${key}' collection exceeded ${record.timeoutMs}ms.` });
    } catch (error) {
      this.stats.errors++;
      snapshot.error = errorRecord(error, { stack: options.includeStack === true });
      if (record.required && options.throwOnRequired !== false) throw error;
    }
    snapshot.durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const sanitized = this.serializer?.sanitize ? this.serializer.sanitize(snapshot, { maxPayloadBytes: this.maxPayloadBytes }) : snapshot;
    if (this.resources.get(key) === record) this.latest.set(key, sanitized);
    this.emit('snapshot', sanitized);
    return sanitized;
  }

  latestSnapshot(name = null) { return name ? this.latest.get(String(name).toLowerCase()) || null : deepFreeze(Object.fromEntries(this.latest)); }
  snapshot() { return deepFreeze({ frozen: this.frozen, resources: this.list(), latest: Object.fromEntries(this.latest), stats: { ...this.stats } }); }
}

async function invoke(explicit, resource, methods, signal) {
  if (typeof explicit === 'function') return await explicit({ signal, resource });
  return await Promise.resolve(callFirst(resource, methods, { signal }));
}
async function callResource(resource, methods) { return await Promise.resolve(callFirst(resource, methods)); }
function hasMethod(value, methods) { return methods.some((name) => typeof value?.[name] === 'function'); }
function publicRecord(record) { return Object.freeze({ name: record.name, critical: record.critical, required: record.required, timeoutMs: record.timeoutMs, tags: record.tags, sourceBinding: record.sourceBinding }); }

export function flattenResourceNumbers(value, options = {}, prefix = '', output = []) {
  const maxDepth = Number(options.maxDepth) || 6;
  const maxItems = Number(options.maxItems) || 1_000;
  function visit(current, path, depth) {
    if (output.length >= maxItems || depth > maxDepth || current == null) return;
    if (typeof current === 'number' && Number.isFinite(current)) { output.push({ path, value: current }); return; }
    if (typeof current !== 'object' || Array.isArray(current)) return;
    for (const [key, item] of Object.entries(current)) visit(item, path ? `${path}.${key}` : key, depth + 1);
  }
  visit(value, prefix, 0);
  return output;
}

export default ResourceRegistry;
