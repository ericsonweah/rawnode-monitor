'use strict';

import { EventStudioAnalyzer } from './analysis/EventStudioAnalyzer.js';
import { clonePublic, deepFreeze, safeError } from './support/safe.js';

export class EventStudioManager {
  constructor(options = {}) {
    this.app = options.app || null;
    this.manager = options.manager || resolve(this.app, 'events.manager');
    this.fabric = options.fabric || resolve(this.app, 'events.fabric') || this.manager?._fabric || null;
    this.readOnly = options.readOnly !== false;
    this.allowMutations = options.allowMutations === true && !this.readOnly;
    this.maxTimeline = Math.max(10, Number(options.historyLimit) || 2_000);
    this.analyzer = options.analyzer || new EventStudioAnalyzer();
    this.audit = options.audit || resolve(this.app, 'security.audit') || null;
    this.authorize = typeof options.authorize === 'function' ? options.authorize : null;
    this.stats = { snapshots: 0, operations: 0, denied: 0, failures: 0 };
  }

  refresh() {
    this.manager ||= resolve(this.app, 'events.manager');
    this.fabric ||= resolve(this.app, 'events.fabric') || this.manager?._fabric || null;
    return this;
  }

  snapshot(options = {}) {
    this.refresh();
    this.stats.snapshots++;
    const manager = this.manager?.snapshot?.() || null;
    const fabric = this.fabric?.snapshot?.() || manager?.fabric || null;
    const timeline = this.timeline({ limit: options.timelineLimit || this.maxTimeline });
    const analysis = this.analyzer.analyze({
      fabric,
      crypto: !!this.fabric?.cryptoProvider,
      outbox: manager?.outboxPublisher?.store || manager?.outbox || null,
      projections: manager?.projections || null,
    });
    return deepFreeze(clonePublic({
      ok: manager?.health?.ok !== false && analysis.ok,
      readOnly: this.readOnly,
      manager,
      fabric,
      timeline,
      graph: this.analyzer.correlationGraph(timeline.records),
      analysis,
      stats: { ...this.stats },
      generatedAt: Date.now(),
    }));
  }

  timeline(options = {}) {
    this.refresh();
    const recorder = this.fabric?.flightRecorder;
    const snapshot = recorder?.snapshot?.() || {};
    let records = snapshot.records || recorder?.records || [];
    if (options.eventName) records = records.filter((entry) => (entry.eventName || entry.name) === options.eventName);
    if (options.correlationId) records = records.filter((entry) => entry.correlationId === options.correlationId || entry.context?.correlationId === options.correlationId);
    const limit = Math.max(1, Number(options.limit) || this.maxTimeline);
    return deepFreeze({ enabled: snapshot.enabled !== false, records: clonePublic(records.slice(-limit)), total: records.length });
  }

  inspectEvent(name, options = {}) {
    this.refresh();
    const eventName = String(name);
    return deepFreeze(clonePublic({
      eventName,
      dispatchPlan: this.manager?._events?.inspect?.(eventName) || null,
      definitions: this.fabric?.definitions?.versions?.(eventName) || [],
      route: this.fabric?.router?.explain?.(eventName, options) || this.fabric?.router?.resolve?.(eventName, options) || null,
      middleware: this.fabric?.middleware?.snapshot?.() || null,
    }));
  }

  async operate(action, input = {}, context = {}) {
    this.stats.operations++;
    try {
      await this._authorize(action, input, context);
      const value = await this._execute(String(action), input, context);
      await this._audit(action, input, context, true);
      return deepFreeze({ ok: true, action, value: clonePublic(value), at: Date.now() });
    } catch (error) {
      this.stats.failures++;
      await this._audit(action, input, context, false, error);
      throw error;
    }
  }

  async _authorize(action, input, context) {
    if (!this.allowMutations) {
      this.stats.denied++;
      throw studioError('Event Studio mutations are disabled.', 'EVENT_STUDIO_READ_ONLY');
    }
    if (!String(input.reason || '').trim()) throw studioError('Event Studio mutations require a reason.', 'EVENT_STUDIO_REASON_REQUIRED');
    if (this.authorize && await this.authorize({ action, input, context, studio: this }) !== true) {
      this.stats.denied++;
      throw studioError('Event Studio operation was not authorized.', 'EVENT_STUDIO_FORBIDDEN');
    }
  }

  async _execute(action, input, context) {
    this.refresh();
    switch (action) {
      case 'outbox.flush': return await this.manager?._outboxPublisher?.flush?.(input);
      case 'outbox.retry': return await retryOutbox(this.manager?._outboxStore, input.id, input);
      case 'dead-letter.retry': return await retryOutbox(this.manager?._outboxStore, input.id, input);
      case 'projection.rebuild': return await this.manager?._projections?.rebuild?.(input.name, { ...input, signal: context.signal });
      case 'workflow.cancel': return await cancelWorkflow(this.manager?._workflowStore, input.id, input);
      case 'transport.start': return await this.fabric?.transports?.require?.(input.id)?.start?.({ ...context, fabric: this.fabric });
      case 'transport.close': return await this.fabric?.transports?.require?.(input.id)?.close?.({ reason: input.reason });
      case 'event.replay': return await this._replay(input, context);
      default: throw studioError(`Unsupported Event Studio operation '${action}'.`, 'EVENT_STUDIO_OPERATION_UNKNOWN');
    }
  }

  async _replay(input, context) {
    const record = input.record || await this.manager?._eventStore?.get?.(input.id);
    if (!record) throw studioError('Replay event was not found.', 'EVENT_STUDIO_REPLAY_NOT_FOUND');
    const name = record.eventName || record.event || record.name;
    const payload = record.payload ?? record.args?.[0];
    return await this.fabric.publish({
      name,
      payload,
      version: record.eventVersion || record.version || 1,
      context: { ...(record.context || {}), replayedBy: context.actorId || null },
      metadata: { ...(record.metadata || {}), replay: true, sourceEventId: record.id || record._id || null },
    }, { via: input.via, durable: input.durable === true, localEcho: input.localEcho === true });
  }

  async _audit(action, input, context, success, error = null) {
    const record = {
      action: `events.studio.${action}`,
      success,
      actorId: context.actorId || context.principal?.id || null,
      tenantId: context.tenantId || null,
      reason: input.reason || null,
      target: input.id || input.name || null,
      error: safeError(error),
      at: Date.now(),
    };
    try {
      if (typeof this.audit?.record === 'function') await this.audit.record(record);
      else if (typeof this.audit?.write === 'function') await this.audit.write(record);
      else this.manager?._events?.dispatch?.('events:studio:operation', record);
    } catch {}
  }
}

async function retryOutbox(store, id, options = {}) {
  if (!store || !id) throw studioError('Outbox store and id are required.', 'EVENT_STUDIO_OUTBOX_REQUIRED');
  const record = await store.get?.(id);
  if (!record) throw studioError(`Outbox record '${id}' was not found.`, 'EVENT_STUDIO_OUTBOX_NOT_FOUND');
  if (typeof store.release === 'function' && record.status === 'processing') {
    return await store.release(id, {
      availableAt: Date.now(),
      owner: options.owner || record.leaseOwner,
      fencingToken: record.fencingToken,
    });
  }
  if (typeof store.append !== 'function') throw studioError('Outbox store cannot retry records.', 'EVENT_STUDIO_OUTBOX_RETRY_UNSUPPORTED');
  return await store.append({ ...record, id: options.newId, status: undefined, attempts: 0, availableAt: Date.now(), idempotencyKey: options.idempotencyKey || `${record.id || id}:retry:${Date.now()}` });
}
async function cancelWorkflow(store, id, options = {}) {
  if (!store || !id) throw studioError('Workflow store and id are required.', 'EVENT_STUDIO_WORKFLOW_REQUIRED');
  if (typeof store.update === 'function') return await store.update(id, { status: 'cancelled', cancelledAt: Date.now(), cancelReason: options.reason });
  if (typeof store.save === 'function') {
    const current = await (store.get?.(id) ?? store.load?.(id));
    if (!current) throw studioError(`Workflow '${id}' was not found.`, 'EVENT_STUDIO_WORKFLOW_NOT_FOUND');
    return await store.save(
      { ...current, id, status: 'cancelled', cancelledAt: Date.now(), cancelReason: options.reason },
      { expectedVersion: current.storeVersion },
    );
  }
  throw studioError('Workflow store cannot cancel workflows.', 'EVENT_STUDIO_WORKFLOW_CANCEL_UNSUPPORTED');
}
function resolve(app, key) { try { return app?.resolve?.(key) ?? app?.container?.resolve?.(key) ?? null; } catch { return null; } }
function studioError(message, code) { return Object.assign(new Error(message), { name: 'EventStudioError', code }); }
export default EventStudioManager;
