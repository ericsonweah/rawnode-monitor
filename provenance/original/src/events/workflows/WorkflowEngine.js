'use strict';

import { randomUUID } from 'node:crypto';
import { MemoryWorkflowStore } from './MemoryWorkflowStore.js';
import { EventAdmissionError } from '../errors/EventError.js';

function normalizeStep(step, index) {
  if (typeof step === 'function') return { name: step.name || `step-${index + 1}`, run: step, compensate: null, retries: 0 };
  if (!step || typeof step.run !== 'function') throw new TypeError(`Workflow step ${index + 1} must expose run()`);
  return {
    name: String(step.name || step.run.name || `step-${index + 1}`),
    run: step.run,
    compensate: typeof step.compensate === 'function' ? step.compensate : null,
    retries: Math.max(0, Number(step.retries) || 0),
    retryDelayMs: Math.max(0, Number(step.retryDelayMs) || 0),
    timeoutMs: Math.max(0, Number(step.timeoutMs) || 0),
  };
}

async function withTimeout(promise, timeoutMs, signal) {
  if (!(timeoutMs > 0)) return promise;
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Workflow step timed out after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
        signal?.addEventListener?.('abort', () => reject(signal.reason || new Error('Workflow aborted')), { once: true });
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Persistable sequential workflow/saga engine with reverse compensation. */
export class WorkflowEngine {
  constructor(options = {}) {
    this.store = options.store || new MemoryWorkflowStore(options.memory || {});
    this.dispatcher = options.dispatcher || null;
    this.definitions = new Map();
    this.maxDefinitions = Math.max(1, Number(options.maxDefinitions) || 1000);
    this.maxSteps = Math.max(1, Number(options.maxSteps) || 1000);
    this.active = new Map();
    this.stats = { started: 0, completed: 0, failed: 0, compensated: 0, compensationFailed: 0, resumed: 0 };
  }

  define(name, steps, options = {}) {
    const key = String(name || '').trim();
    if (!key) throw new TypeError('Workflow name is required');
    if (!Array.isArray(steps) || !steps.length || steps.length > this.maxSteps) throw new TypeError(`Workflow steps must contain 1-${this.maxSteps} entries`);
    if (!this.definitions.has(key) && this.definitions.size >= this.maxDefinitions) throw new EventAdmissionError('Workflow definition limit exceeded', { code: 'EVENT_WORKFLOW_DEFINITION_LIMIT' });
    if (this.definitions.has(key) && options.replace !== true) throw new EventAdmissionError(`Workflow already defined: ${key}`, { code: 'EVENT_WORKFLOW_DUPLICATE' });
    this.definitions.set(key, Object.freeze({ name: key, version: Math.max(1, Number(options.version) || 1), steps: Object.freeze(steps.map(normalizeStep)), compensateOnFailure: options.compensateOnFailure !== false }));
    return this;
  }

  async start(name, input = null, options = {}) {
    const definition = this.definitions.get(String(name));
    if (!definition) throw new EventAdmissionError(`Unknown workflow: ${name}`, { code: 'EVENT_WORKFLOW_UNKNOWN' });
    const now = Date.now();
    const record = await this.store.create({
      id: options.id || randomUUID(),
      name: definition.name,
      version: definition.version,
      status: 'pending',
      stepIndex: 0,
      input,
      state: options.state && typeof options.state === 'object' ? { ...options.state } : {},
      results: [],
      completedSteps: [],
      error: null,
      createdAt: now,
      updatedAt: now,
      correlationId: options.correlationId || this.dispatcher?.getContext?.()?.correlationId || null,
      meta: options.meta || null,
    });
    this.stats.started++;
    this._emit('workflow:started', record);
    return this.run(record.id, options);
  }

  async resume(id, options = {}) { this.stats.resumed++; return this.run(id, options); }

  async run(id, options = {}) {
    const key = String(id);
    if (this.active.has(key)) return this.active.get(key);
    const operation = this._run(key, options).finally(() => this.active.delete(key));
    this.active.set(key, operation);
    return operation;
  }

  async _run(id, options) {
    const record = await this.store.get(id);
    if (!record) throw new EventAdmissionError(`Workflow not found: ${id}`, { code: 'EVENT_WORKFLOW_NOT_FOUND' });
    if (['completed', 'compensated'].includes(record.status)) return record;
    const definition = this.definitions.get(record.name);
    if (!definition) throw new EventAdmissionError(`Workflow definition unavailable: ${record.name}`, { code: 'EVENT_WORKFLOW_UNKNOWN' });

    const signal = options.signal || null;
    record.status = 'running';
    await this.store.save(record);
    try {
      while (record.stepIndex < definition.steps.length) {
        if (signal?.aborted) throw signal.reason || new Error('Workflow aborted');
        const step = definition.steps[record.stepIndex];
        const result = await this._executeStep(step, record, signal);
        record.results[record.stepIndex] = result;
        record.completedSteps.push({ index: record.stepIndex, name: step.name, completedAt: Date.now() });
        record.stepIndex++;
        record.updatedAt = Date.now();
        await this.store.save(record);
        this._emit('workflow:step:completed', { workflow: record, step: step.name, result });
      }
      record.status = 'completed';
      record.updatedAt = Date.now();
      await this.store.save(record);
      this.stats.completed++;
      this._emit('workflow:completed', record);
      return record;
    } catch (error) {
      record.status = 'failed';
      record.error = { name: error?.name || 'Error', message: error?.message || String(error), code: error?.code, at: Date.now() };
      record.updatedAt = Date.now();
      await this.store.save(record);
      this.stats.failed++;
      this._emit('workflow:failed', { workflow: record, error });
      if (definition.compensateOnFailure && options.compensate !== false) return this.compensate(record.id, { cause: error, signal });
      throw error;
    }
  }

  async _executeStep(step, record, signal) {
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        return await withTimeout(Promise.resolve(step.run({
          id: record.id,
          input: record.input,
          state: record.state,
          results: record.results,
          stepIndex: record.stepIndex,
          attempt,
          signal,
          engine: this,
        })), step.timeoutMs, signal);
      } catch (error) {
        if (attempt > step.retries) throw error;
        if (step.retryDelayMs) await new Promise((resolve) => { const timer = setTimeout(resolve, step.retryDelayMs); timer.unref?.(); });
      }
    }
  }

  async compensate(id, options = {}) {
    const record = await this.store.get(id);
    if (!record) throw new EventAdmissionError(`Workflow not found: ${id}`, { code: 'EVENT_WORKFLOW_NOT_FOUND' });
    const definition = this.definitions.get(record.name);
    record.status = 'compensating';
    await this.store.save(record);
    const errors = [];
    for (let index = record.completedSteps.length - 1; index >= 0; index--) {
      const completed = record.completedSteps[index];
      const step = definition.steps[completed.index];
      if (!step.compensate) continue;
      try {
        await step.compensate({
          id: record.id,
          input: record.input,
          state: record.state,
          result: record.results[completed.index],
          cause: options.cause,
          signal: options.signal,
          engine: this,
        });
        this._emit('workflow:step:compensated', { workflow: record, step: step.name });
      } catch (error) {
        errors.push({ step: step.name, error: { name: error.name, message: error.message, code: error.code } });
        this.stats.compensationFailed++;
      }
    }
    record.status = errors.length ? 'compensation_failed' : 'compensated';
    record.compensationErrors = errors;
    record.updatedAt = Date.now();
    await this.store.save(record);
    if (!errors.length) this.stats.compensated++;
    this._emit(errors.length ? 'workflow:compensation:failed' : 'workflow:compensated', record);
    return record;
  }

  _emit(eventName, payload) {
    try { this.dispatcher?.dispatch?.(eventName, payload); } catch {}
  }

  get(id) { return this.store.get(id); }
  list(options) { return this.store.list(options); }
  snapshot() { return Object.freeze({ definitions: this.definitions.size, active: this.active.size, stats: Object.freeze({ ...this.stats }), store: this.store.snapshot?.() || null }); }
  async close() { await Promise.allSettled(this.active.values()); this.active.clear(); }
  async [Symbol.asyncDispose]() { await this.close(); }
}

export default WorkflowEngine;
