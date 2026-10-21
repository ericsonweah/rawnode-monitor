'use strict';

import MemoryTelemetryStore from './MemoryTelemetryStore.js';
import JsonlTelemetryStore from './JsonlTelemetryStore.js';
import RawMongoTelemetryStore from './RawMongoTelemetryStore.js';
import CompositeTelemetryStore from './CompositeTelemetryStore.js';
import NoopTelemetryStore from './NoopTelemetryStore.js';

export function createTelemetryStore(options = {}, dependencies = {}) {
  if (options.store) return options.store;
  if (options.enabled === false || options.driver === 'none') return new NoopTelemetryStore();
  switch (String(options.driver || 'memory').toLowerCase()) {
    case 'memory': return new MemoryTelemetryStore(options);
    case 'file': return new JsonlTelemetryStore({ ...options, serializer: dependencies.serializer });
    case 'rawmongo': {
      if (dependencies.database) return new RawMongoTelemetryStore(dependencies.database, options);
      if (options.required === true) {
        const error = new TypeError('RawNode Monitor requires a RawMongo database for the configured rawmongo telemetry store.');
        error.code = 'MONITOR_STORAGE_DEPENDENCY_MISSING';
        throw error;
      }
      return new MemoryTelemetryStore({ ...options, fallbackFrom: 'rawmongo', fallbackReason: 'database-unavailable' });
    }
    case 'composite': {
      const requested = normalizeDrivers(options.drivers || options.compositeDrivers, dependencies, options);
      const stores = [];
      for (const driver of requested) {
        if (driver === 'memory') {
          stores.push({ name: 'memory', store: new MemoryTelemetryStore(options), durable: false });
        } else if (driver === 'rawmongo') {
          if (dependencies.database) stores.push({ name: 'rawmongo', store: new RawMongoTelemetryStore(dependencies.database, options), durable: true });
        } else if (driver === 'file' && options.path) {
          stores.push({ name: 'file', store: new JsonlTelemetryStore({ ...options, serializer: dependencies.serializer }), durable: true });
        }
      }
      const durable = stores.filter((entry) => entry.durable);
      if (options.required === true && durable.length === 0) {
        const error = new TypeError('RawNode Monitor composite storage requires at least one configured durable store.');
        error.code = 'MONITOR_STORAGE_DEPENDENCY_MISSING';
        throw error;
      }
      return new CompositeTelemetryStore(stores, {
        ...options,
        requireDurable: options.required === true,
        queryStore: options.queryStore || durable[0]?.name || stores[0]?.name,
      });
    }
    default: throw new TypeError(`Unsupported Monitor telemetry store '${options.driver}'.`);
  }
}

function normalizeDrivers(value, dependencies, options) {
  const supplied = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null;
  const drivers = supplied?.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    || ['memory', ...(dependencies.database ? ['rawmongo'] : []), ...(options.path ? ['file'] : [])];
  return Array.from(new Set(drivers.filter((driver) => ['memory', 'rawmongo', 'file'].includes(driver))));
}

export default createTelemetryStore;
