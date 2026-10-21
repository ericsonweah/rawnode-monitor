'use strict';

function runWithTimeout(factory, timeoutMs, label, signal = null) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error(`${label} aborted.`));
  if (!timeoutMs || timeoutMs <= 0) return Promise.resolve().then(factory);
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
    const onAbort = () => finish(reject, signal.reason || Object.assign(new Error(`${label} aborted.`), { code: 'LOGGER_PROCESSOR_ABORTED' }));
    const timer = setTimeout(() => {
      finish(reject, Object.assign(new Error(`${label} timed out after ${timeoutMs}ms.`), { code: 'LOGGER_PROCESSOR_TIMEOUT' }));
    }, timeoutMs);
   
    signal?.addEventListener?.('abort', onAbort, { once: true });
    Promise.resolve().then(factory).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function normalizePhase(value) {
  const phase = String(value || 'enrich').toLowerCase();
  if (['pre', 'before-redaction', 'beforeredaction', 'enrich', 'trusted'].includes(phase)) return 'before-redaction';
  if (['post', 'after-redaction', 'afterredaction', 'untrusted'].includes(phase)) return 'after-redaction';
  if (phase === 'before-write' || phase === 'beforewrite') return 'before-write';
  return phase;
}

export class ProcessorRegistry {
  constructor(options = {}) {
    this.processors = [];
    this.errorPolicy = options.errorPolicy || 'isolate';
    this.diagnostics = options.diagnostics || null;
  }

  use(processor, options = {}) {
    if (typeof processor !== 'function') throw new TypeError('Logger processor must be a function.');
    const entry = {
      name: options.name || processor.name || `processor-${this.processors.length + 1}`,
      processor,
      priority: Number.isFinite(Number(options.priority)) ? Number(options.priority) : 10,
      timeoutMs: Math.max(0, Number(options.timeoutMs) || 0),
      phase: normalizePhase(options.phase),
      trusted: options.trusted !== false,
      enabled: options.enabled !== false,
    };
    if (this.processors.some((item) => item.name === entry.name) && options.replace !== true) {
      throw new Error(`Logger processor [${entry.name}] is already registered.`);
    }
    if (options.replace === true) this.remove(entry.name);
    this.processors.push(entry);
    this.processors.sort((a, b) => a.priority - b.priority);
    return () => this.remove(entry.name);
  }

  remove(name) {
    const before = this.processors.length;
    this.processors = this.processors.filter((entry) => entry.name !== name);
    return this.processors.length !== before;
  }

  hasPhase(phase, filter = {}) {
    const normalized = normalizePhase(phase);
    return this.processors.some((entry) => {
      if (!entry.enabled || entry.phase !== normalized) return false;
      if (filter.trustedOnly === true && entry.trusted !== true) return false;
      if (filter.untrustedOnly === true && entry.trusted === true) return false;
      return true;
    });
  }

  async run(record, context = {}, filter = {}) {
    let current = record;
    const phase = filter.phase ? normalizePhase(filter.phase) : null;
    const trustedOnly = filter.trustedOnly === true;
    const untrustedOnly = filter.untrustedOnly === true;
    const snapshot = [...this.processors];
    for (const entry of snapshot) {
      if (!entry.enabled) continue;
      if (phase && entry.phase !== phase) continue;
      if (trustedOnly && entry.trusted !== true) continue;
      if (untrustedOnly && entry.trusted === true) continue;
      if (context.signal?.aborted) throw context.signal.reason || new Error('Logger processing aborted.');
      try {
        const result = await runWithTimeout(
          () => entry.processor(current, { ...context, processor: entry }),
          entry.timeoutMs,
          `Logger processor [${entry.name}]`,
          context.signal,
        );
        if (result === false || result === null) return null;
        if (result !== undefined) current = result;
      } catch (error) {
        this.diagnostics?.report?.('LOGGER_PROCESSOR_ERROR', error, { processor: entry.name, phase: entry.phase });
        if (this.errorPolicy === 'propagate') throw error;
      }
    }
    return current;
  }

  runPhase(phase, record, context = {}, filter = {}) {
    return this.run(record, context, { ...filter, phase });
  }

  clone(options = {}) {
    const copy = new ProcessorRegistry({
      errorPolicy: options.errorPolicy || this.errorPolicy,
      diagnostics: options.diagnostics || this.diagnostics,
    });
    copy.processors = this.processors.map((entry) => ({ ...entry }));
    return copy;
  }

  snapshot() {
    return this.processors.map(({ name, priority, timeoutMs, phase, trusted, enabled }) => ({
      name,
      priority,
      timeoutMs,
      phase,
      trusted,
      enabled,
    }));
  }
}

export default ProcessorRegistry;
