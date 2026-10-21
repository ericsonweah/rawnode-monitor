'use strict';

import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

function resolve(app, key, fallback = null) {
  try { return app?.resolve?.(key) ?? fallback; } catch { return fallback; }
}

function eventBus(app) {
  const events = resolve(app, 'events');
  if (!events) throw new Error('RawNode events service is not available');
  return events;
}

export class EventsListCommand {
  constructor(app) { this.app = app; this.signature = 'events:list'; this.description = 'List event listeners by event, pattern, owner, priority, and tag.'; }
  async handle(options = {}) {
    let listeners = eventBus(this.app).listenerManifest?.() || [];
    if (options.owner) listeners = listeners.filter((entry) => entry.owner === String(options.owner));
    if (options.tag) listeners = listeners.filter((entry) => entry.tags?.includes(String(options.tag)));
    if (options.event) listeners = listeners.filter((entry) => entry.eventName === String(options.event) || entry.pattern === String(options.event));
    return { count: listeners.length, listeners };
  }
}

export class EventsInspectCommand {
  constructor(app) { this.app = app; this.signature = 'events:inspect {event}'; this.description = 'Explain exactly which listeners would receive an event.'; }
  async handle(eventName) {
    if (!eventName) throw new Error('events:inspect requires an event name');
    return eventBus(this.app).inspect(String(eventName));
  }
}

export class EventsDoctorCommand {
  constructor(app) { this.app = app; this.signature = 'events:doctor'; this.description = 'Check event-bus bounds, listener registry, diagnostics, bridge, and durable delivery health.'; }
  async handle() {
    const events = eventBus(this.app);
    const health = events.health?.() || { ok: true };
    const snapshot = events.snapshot?.() || null;
    const bridge = resolve(this.app, 'events.bridge.redis');
    const outboxPublisher = resolve(this.app, 'events.outbox.publisher');
    const findings = [];
    const config = events.configuration?.value || {};

    if (config.profile === 'production' && !config.listeners?.maxTotal) findings.push({ level: 'error', code: 'EVENTS_UNBOUNDED_LISTENERS', message: 'Production listener total is unbounded.' });
    if (config.profile === 'production' && config.history?.maxEntriesPerEvent > 0 && !config.history?.maxEventNames) findings.push({ level: 'error', code: 'EVENTS_UNBOUNDED_HISTORY_NAMES', message: 'Production replay history has no event-name ceiling.' });
    if (config.profile === 'production' && config.deferred?.maxItems === 0) findings.push({ level: 'warning', code: 'EVENTS_UNBOUNDED_DEFERRED', message: 'Deferred queue is unbounded.' });
    if (bridge?.required && !bridge.ready) findings.push({ level: 'error', code: 'EVENTS_BRIDGE_NOT_READY', message: `Required Redis bridge is ${bridge.state}.` });
    if (events.listenerManifest?.().some((entry) => !entry.owner)) findings.push({ level: 'info', code: 'EVENTS_OWNERLESS_LISTENERS', message: 'Some listeners have no lifecycle owner.' });

    return {
      ok: health.ok !== false && !findings.some((finding) => finding.level === 'error'),
      health,
      snapshot,
      bridge: bridge?.snapshot?.() || null,
      outbox: outboxPublisher?.snapshot?.() || resolve(this.app, 'events.outbox')?.snapshot?.() || null,
      findings,
    };
  }
}

export class EventsStatsCommand {
  constructor(app) { this.app = app; this.signature = 'events:stats'; this.description = 'Show event metrics, queue, history, bridge, and health snapshots.'; }
  async handle(options = {}) {
    const events = eventBus(this.app);
    return options.prometheus ? events.prometheus?.(options.prefix) : events.snapshot?.();
  }
}

export class EventsHistoryCommand {
  constructor(app) { this.app = app; this.signature = 'events:history {event?}'; this.description = 'Inspect bounded redacted event replay history.'; }
  async handle(eventName = null, options = {}) {
    const events = eventBus(this.app);
    const history = eventName ? events.getHistory(String(eventName), options) : events.getHistoryAll(options);
    return { count: history.length, history };
  }
}

export class EventsReplayCommand {
  constructor(app) { this.app = app; this.signature = 'events:replay {event}'; this.description = 'Replay retained entries through the event bus or into a dry-run report.'; }
  async handle(eventName, options = {}) {
    if (!eventName) throw new Error('events:replay requires an event name');
    const events = eventBus(this.app);
    const history = events.getHistory(String(eventName), { limit: Number(options.limit) || 0 });
    if (options.dryRun !== false) return { dryRun: true, eventName: String(eventName), count: history.length, history };
    const reports = [];
    for (const entry of history) reports.push(await events.dispatchSettled(String(eventName), ...entry.args));
    return { dryRun: false, eventName: String(eventName), count: reports.length, reports };
  }
}

export class EventsBridgeStatusCommand {
  constructor(app) { this.app = app; this.signature = 'events:bridge:status'; this.description = 'Show Redis event bridge readiness, queue, deduplication, and circuit state.'; }
  async handle() {
    const bridge = resolve(this.app, 'events.bridge.redis');
    return bridge ? { health: bridge.health?.(), snapshot: bridge.snapshot?.() } : { health: { ok: true, ready: false }, disabled: true };
  }
}

export class EventsBridgeTestCommand {
  constructor(app) { this.app = app; this.signature = 'events:bridge:test'; this.description = 'Publish a signed bounded loopback probe through the configured Redis bridge.'; }
  async handle(options = {}) {
    const bridge = resolve(this.app, 'events.bridge.redis');
    if (!bridge?.ready) return { ok: false, reason: 'bridge-not-ready', state: bridge?.state || 'missing' };
    const id = randomUUID();
    const admission = bridge.publish(options.event || 'events:bridge:probe', [{ id, timestamp: Date.now() }], {
      id,
      ttlMs: Number(options.ttlMs) || 10_000,
      headers: { probe: true },
    });
    const delivery = await admission.promise;
    return { ok: admission.accepted === true && delivery?.published === true, admission: { ...admission, promise: undefined }, delivery };
  }
}

export class EventsBenchCommand {
  constructor(app) { this.app = app; this.signature = 'events:bench'; this.description = 'Run a dependency-free event-dispatch microbenchmark.'; }
  async handle(options = {}) {
    const iterations = Math.max(1, Math.min(10_000_000, Number(options.iterations) || 250_000));
    const events = eventBus(this.app);
    let sink = 0;
    const eventName = `events:bench:${randomUUID()}`;
    const handle = events.subscribe(eventName, (value) => { sink += value; }, { owner: 'events:bench' });
    const started = performance.now();
    for (let index = 0; index < iterations; index++) events.dispatch(eventName, 1);
    const elapsedMs = performance.now() - started;
    handle.dispose();
    return { iterations, elapsedMs, operationsPerSecond: elapsedMs ? Math.round(iterations / elapsedMs * 1000) : Infinity, sink };
  }
}


export class EventsFabricStatusCommand {
  constructor(app) { this.app = app; this.signature = 'events:fabric'; this.description = 'Show Universal Event Fabric health, definitions, transports, admission, resources, and request state.'; }
  async handle(options = {}) {
    const fabric = resolve(this.app, 'events.fabric') || eventBus(this.app).fabric?.();
    if (!fabric) return { enabled: false, ok: true };
    return options.health === true ? fabric.health?.() : fabric.snapshot?.();
  }
}

export class EventsDefinitionsCommand {
  constructor(app) { this.app = app; this.signature = 'events:definitions {event?}'; this.description = 'List versioned Event Fabric definitions, contracts, security policy, and transport requirements.'; }
  async handle(eventName = null, options = {}) {
    const registry = resolve(this.app, 'events.definitions') || resolve(this.app, 'events.fabric')?.definitions;
    if (!registry) return { enabled: false, count: 0, definitions: [] };
    if (eventName) {
      const versions = registry.versions?.(String(eventName)) || [];
      return { eventName: String(eventName), count: versions.length, definitions: versions };
    }
    const manifest = registry.manifest?.() || registry.snapshot?.() || [];
    const definitions = Array.isArray(manifest) ? manifest : manifest.definitions || manifest.events || [];
    let values = definitions;
    if (options.owner) values = values.filter((entry) => entry.owner === String(options.owner));
    if (options.visibility) values = values.filter((entry) => entry.visibility === String(options.visibility));
    return { count: values.length, definitions: values };
  }
}

export class EventsTransportsCommand {
  constructor(app) { this.app = app; this.signature = 'events:transports {id?}'; this.description = 'Inspect registered Event Fabric transports and their delivery capabilities.'; }
  async handle(id = null) {
    const registry = resolve(this.app, 'events.transports') || resolve(this.app, 'events.fabric')?.transports;
    if (!registry) return { enabled: false, transports: {} };
    if (id) {
      const transport = registry.get?.(String(id));
      return transport ? { id: String(id), health: transport.health?.(), diagnostics: transport.diagnostics?.() } : { id: String(id), found: false };
    }
    return registry.snapshot?.() || { names: registry.names?.() || [] };
  }
}

export class EventsRouteCommand {
  constructor(app) { this.app = app; this.signature = 'events:route {event}'; this.description = 'Explain transport policy, fallback order, capability compatibility, and delivery constraints for an event.'; }
  async handle(eventName, options = {}) {
    if (!eventName) throw new Error('events:route requires an event name');
    const router = resolve(this.app, 'events.router') || resolve(this.app, 'events.fabric')?.router;
    if (!router?.explain) throw new Error('Event Fabric transport router is unavailable');
    return router.explain(String(eventName), {
      via: options.via,
      fallback: options.fallback,
      durable: options.durable === true,
      requireAcknowledgement: options.ack === true || options.acknowledged === true,
      requireOrdering: options.ordered === true,
      partitionKey: options.partition || options.partitionKey,
      bytes: Number(options.bytes) || 0,
    });
  }
}

export class EventsResourcesCommand {
  constructor(app) { this.app = app; this.signature = 'events:resources'; this.description = 'Show global, category, and tenant Event Fabric resource budgets and active leases.'; }
  async handle() {
    const governor = resolve(this.app, 'events.resources') || resolve(this.app, 'events.fabric')?.resources;
    return governor?.snapshot?.() || { enabled: false };
  }
}

export class EventsTraceCommand {
  constructor(app) { this.app = app; this.signature = 'events:trace {correlation?}'; this.description = 'Inspect the bounded redacted event flight recorder and causation graph.'; }
  async handle(correlationId = null, options = {}) {
    const studio = resolve(this.app, 'events.studio');
    if (studio) {
      const timeline = studio.timeline({ correlationId, eventName: options.event, limit: Number(options.limit) || 500 });
      return { timeline, graph: studio.analyzer?.correlationGraph?.(timeline.records) || null };
    }
    const recorder = resolve(this.app, 'events.flight-recorder') || resolve(this.app, 'events.fabric')?.flightRecorder;
    return recorder?.snapshot?.() || { enabled: false, records: [] };
  }
}

export class EventsOutboxStatusCommand {
  constructor(app) { this.app = app; this.signature = 'events:outbox'; this.description = 'Show durable outbox store and publisher health.'; }
  async handle(options = {}) {
    const publisher = resolve(this.app, 'events.outbox.publisher');
    const store = resolve(this.app, 'events.outbox.store') || publisher?.store;
    const records = options.status && store?.all ? await store.all({ status: options.status, limit: Number(options.limit) || 100 }) : undefined;
    return { publisher: publisher?.snapshot?.() || null, store: store?.snapshot?.() || null, records };
  }
}

export class EventsOutboxFlushCommand {
  constructor(app) { this.app = app; this.signature = 'events:outbox:flush'; this.description = 'Drain admitted durable outbox records through the configured transport.'; }
  async handle(options = {}) {
    const publisher = resolve(this.app, 'events.outbox.publisher');
    if (!publisher?.flush) throw new Error('Event outbox publisher is unavailable');
    return await publisher.flush({ maxCycles: Number(options.maxCycles) || 10_000, stopOnFailure: options.stopOnFailure !== false });
  }
}

export class EventsDeadLetterCommand {
  constructor(app) { this.app = app; this.signature = 'events:dead-letter {id?}'; this.description = 'List dead-lettered event deliveries or retry one through guarded Event Studio operations.'; }
  async handle(id = null, options = {}) {
    const store = resolve(this.app, 'events.outbox.store') || resolve(this.app, 'events.outbox.publisher')?.store;
    if (!id) return { records: store?.all ? await store.all({ status: 'dead', limit: Number(options.limit) || 100 }) : [], store: store?.snapshot?.() || null };
    if (options.retry !== true) return { record: await store?.get?.(String(id)) || null, retry: false };
    const studio = resolve(this.app, 'events.studio');
    if (!studio) throw new Error('Event Studio is required for guarded dead-letter retries');
    return await studio.operate('dead-letter.retry', { id: String(id), reason: options.reason || '' }, { actorId: options.actorId || 'console' });
  }
}

export class EventsStudioCommand {
  constructor(app) { this.app = app; this.signature = 'events:studio'; this.description = 'Show the read-only Event Studio operational snapshot and findings.'; }
  async handle(options = {}) {
    const studio = resolve(this.app, 'events.studio');
    return studio?.snapshot?.({ timelineLimit: Number(options.limit) || 250 }) || { enabled: false };
  }
}

export const EVENT_COMMANDS = Object.freeze([
  ['command.events.list', EventsListCommand],
  ['command.events.inspect', EventsInspectCommand],
  ['command.events.doctor', EventsDoctorCommand],
  ['command.events.stats', EventsStatsCommand],
  ['command.events.history', EventsHistoryCommand],
  ['command.events.replay', EventsReplayCommand],
  ['command.events.bridge.status', EventsBridgeStatusCommand],
  ['command.events.bridge.test', EventsBridgeTestCommand],
  ['command.events.bench', EventsBenchCommand],
  ['command.events.fabric', EventsFabricStatusCommand],
  ['command.events.definitions', EventsDefinitionsCommand],
  ['command.events.transports', EventsTransportsCommand],
  ['command.events.route', EventsRouteCommand],
  ['command.events.resources', EventsResourcesCommand],
  ['command.events.trace', EventsTraceCommand],
  ['command.events.outbox', EventsOutboxStatusCommand],
  ['command.events.outbox.flush', EventsOutboxFlushCommand],
  ['command.events.dead-letter', EventsDeadLetterCommand],
  ['command.events.studio', EventsStudioCommand],
]);
