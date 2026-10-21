'use strict';

import { AsyncLocalStorage } from 'node:async_hooks';

function runWithTimeout(factory, ms, label, signal = null) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error(`${label} aborted.`));
  if (!ms || ms <= 0) return Promise.resolve().then(factory);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => finish(reject, signal.reason || Object.assign(new Error(`${label} aborted.`), { code: 'LOGGER_PLUGIN_ABORTED' }));
    const timer = setTimeout(() => {
      finish(reject, Object.assign(new Error(`${label} timed out after ${ms}ms.`), { code: 'LOGGER_PLUGIN_TIMEOUT' }));
    }, ms);
   
    signal?.addEventListener?.('abort', onAbort, { once: true });
    Promise.resolve().then(factory).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

export class PluginManager {
  constructor(options = {}) {
    this.plugins = [];
    this.duplicate = options.duplicate || 'reject';
    this.errorPolicy = options.errorPolicy || 'isolate';
    this.defaultTimeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
    this.maxDepth = Math.max(1, Number(options.maxDepth) || 16);
    this.diagnostics = options.diagnostics || null;
    this.scope = new AsyncLocalStorage();
    this.stats = {
      hooks: 0,
      errors: 0,
      timeouts: 0,
      recursionSkips: 0,
      removed: 0,
    };
  }

  use(plugin = {}) {
    if (!plugin || typeof plugin !== 'object') throw new TypeError('Logger plugin must be an object.');
    const name = String(plugin.name || `plugin-${this.plugins.length + 1}`);
    const existing = this.plugins.findIndex((entry) => entry.name === name);
    if (existing !== -1) {
      if (this.duplicate === 'ignore') return this;
      if (this.duplicate === 'replace') this.plugins.splice(existing, 1);
      else throw new Error(`Logger plugin [${name}] is already registered.`);
    }
    this.plugins.push({
      name,
      plugin,
      priority: Number.isFinite(Number(plugin.priority)) ? Number(plugin.priority) : 10,
      timeoutMs: Math.max(0, Number(plugin.timeoutMs) || this.defaultTimeoutMs),
      trusted: plugin.trusted === true,
      enabled: plugin.enabled !== false,
    });
    this.plugins.sort((a, b) => a.priority - b.priority);
    return this;
  }

  remove(name) {
    const before = this.plugins.length;
    this.plugins = this.plugins.filter((entry) => entry.name !== name);
    const removed = before - this.plugins.length;
    this.stats.removed += removed;
    return removed > 0;
  }

  hasHook(hookName, filter = {}) {
    return this.plugins.some((entry) => {
      if (!entry.enabled) return false;
      if (filter.trustedOnly === true && entry.trusted !== true) return false;
      if (filter.untrustedOnly === true && entry.trusted === true) return false;
      const hook = entry.plugin?.hooks?.[hookName] || entry.plugin?.[hookName];
      return typeof hook === 'function';
    });
  }

  async runHook(hookName, value, context = {}) {
    if (!this.hasHook(hookName, context)) return value;
    const parent = this.scope.getStore() || { depth: 0, path: [] };
    if (parent.depth >= this.maxDepth) {
      this.stats.recursionSkips++;
      this.diagnostics?.report?.('LOGGER_PLUGIN_RECURSION_LIMIT', new Error(`Logger plugin hook recursion exceeded ${this.maxDepth}.`), {
        hook: hookName,
        path: parent.path,
      });
      return value;
    }

    return await this.scope.run({ depth: parent.depth + 1, path: [...parent.path, hookName] }, async () => {
      let current = value;
      const snapshot = [...this.plugins];
      for (const entry of snapshot) {
        if (!entry.enabled) continue;
        if (context.trustedOnly === true && entry.trusted !== true) continue;
        if (context.untrustedOnly === true && entry.trusted === true) continue;
        const hook = entry.plugin?.hooks?.[hookName] || entry.plugin?.[hookName];
        if (typeof hook !== 'function') continue;
        try {
          this.stats.hooks++;
          const result = await runWithTimeout(
            () => hook.call(entry.plugin, current, { ...context, plugin: entry.name, trusted: entry.trusted }),
            entry.timeoutMs,
            `Logger plugin [${entry.name}] hook [${hookName}]`,
            context.signal,
          );
          if (result === false || result === null) return null;
          if (result !== undefined) current = result;
        } catch (error) {
          this.stats.errors++;
          if (error?.code === 'LOGGER_PLUGIN_TIMEOUT') this.stats.timeouts++;
          this.diagnostics?.report?.('LOGGER_PLUGIN_ERROR', error, { plugin: entry.name, hook: hookName });
          if (this.errorPolicy === 'propagate') throw error;
        }
      }
      return current;
    });
  }

  clone(options = {}) {
    const copy = new PluginManager({
      duplicate: options.duplicate || this.duplicate,
      errorPolicy: options.errorPolicy || this.errorPolicy,
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
      maxDepth: options.maxDepth ?? this.maxDepth,
      diagnostics: options.diagnostics || this.diagnostics,
    });
    copy.plugins = this.plugins.map((entry) => ({ ...entry }));
    return copy;
  }

  async close(context = {}) {
    await this.runHook('close', undefined, context);
    this.plugins.length = 0;
    this.scope.disable();
  }

  snapshot() {
    return {
      plugins: this.plugins.map(({ name, priority, timeoutMs, trusted, enabled }) => ({
        name,
        priority,
        timeoutMs,
        trusted,
        enabled,
      })),
      stats: { ...this.stats },
    };
  }
}

export default PluginManager;
