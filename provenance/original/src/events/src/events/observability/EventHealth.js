'use strict';

function utilization(value, limit) {
  if (!(limit > 0)) return 0;
  return Math.max(0, Number(value) || 0) / limit;
}

function subsystemUnhealthy(entry) {
  if (!entry?.required) return false;
  const snapshot = entry.snapshot;
  if (!snapshot) return false;
  if (snapshot.ok === false || snapshot.ready === false || snapshot.healthy === false) return true;
  if (snapshot.closed === true) return true;
  if (['failed', 'degraded', 'closed'].includes(String(snapshot.state || '').toLowerCase())) return true;
  if (snapshot.error) return true;
  return false;
}

export class EventHealth {
  constructor(dispatcher, options = {}) {
    this.dispatcher = dispatcher;
    this.options = {
      maxDeferredUtilization: Number(options.maxDeferredUtilization ?? 0.9),
      maxDeferredByteUtilization: Number(options.maxDeferredByteUtilization ?? options.maxDeferredUtilization ?? 0.9),
      maxHistoryUtilization: Number(options.maxHistoryUtilization ?? 0.95),
      maxHistoryByteUtilization: Number(options.maxHistoryByteUtilization ?? options.maxHistoryUtilization ?? 0.95),
      maxInFlightAsync: Math.max(0, Number(options.maxInFlightAsync ?? 0) || 0),
      requireAccepting: options.requireAccepting !== false,
    };
  }

  check() {
    const bus = this.dispatcher;
    const scheduler = bus?._scheduler?.snapshot?.() || null;
    const history = bus?._journal?.snapshot?.() || null;
    const bridge = bus?._bridge?.health?.() || bus?._bridge?.snapshot?.() || null;
    const subsystems = bus?.subsystems?.() || Object.freeze({});
    const reasons = [];

    if (!bus) reasons.push('dispatcher_missing');
    if (bus?._closed) reasons.push('dispatcher_closed');
    if (this.options.requireAccepting && bus?._accepting === false) reasons.push('dispatcher_draining');
    if (this.options.maxInFlightAsync && bus?._inFlightAsync > this.options.maxInFlightAsync) reasons.push('async_saturated');

    if (scheduler?.limits?.maxItems && utilization(scheduler.queuedItems, scheduler.limits.maxItems) >= this.options.maxDeferredUtilization) {
      reasons.push('deferred_items_saturated');
    }
    if (scheduler?.limits?.maxBytes && utilization(scheduler.queuedBytes, scheduler.limits.maxBytes) >= this.options.maxDeferredByteUtilization) {
      reasons.push('deferred_bytes_saturated');
    }
    if (history?.enabled && history?.limits?.maxEntriesTotal && utilization(history.entries, history.limits.maxEntriesTotal) >= this.options.maxHistoryUtilization) {
      reasons.push('history_entries_saturated');
    }
    if (history?.enabled && history?.limits?.maxBytes && utilization(history.bytes, history.limits.maxBytes) >= this.options.maxHistoryByteUtilization) {
      reasons.push('history_bytes_saturated');
    }
    if (bridge && bridge.ok === false) reasons.push(...(bridge.reasons || ['bridge_unhealthy']));
    else if (bridge && ['failed', 'degraded'].includes(bridge.state) && bridge.required) reasons.push('bridge_unhealthy');

    for (const [name, entry] of Object.entries(subsystems)) {
      if (subsystemUnhealthy(entry)) reasons.push(`subsystem_${name.replace(/[^a-zA-Z0-9]+/g, '_')}_unhealthy`);
    }

    return Object.freeze({
      ok: reasons.length === 0,
      ready: reasons.length === 0,
      state: bus?._closed ? 'closed' : bus?._accepting === false ? 'draining' : 'ready',
      reasons: Object.freeze(Array.from(new Set(reasons))),
      asyncInFlight: bus?._inFlightAsync || 0,
      pendingAsync: bus?._pendingAsync?.size || 0,
      scheduler,
      history,
      bridge,
      subsystems,
      checkedAt: Date.now(),
    });
  }
}

export default EventHealth;
