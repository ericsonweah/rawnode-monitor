'use strict';

import { computeWildcardEvents, firstStaticSegment, globPrefix, globToRegExp } from '../support/glob.js';
import { ListenerHandle } from './ListenerHandle.js';
import { EventAdmissionError } from '../errors/EventError.js';

const DEFAULT_MAX = 5000;

function finiteLimit(value, fallback) {
  if (value === 0) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

function compareEntries(left, right) {
  if (left.priority !== right.priority) return right.priority - left.priority;
  return left.order - right.order;
}

function insertSorted(bucket, entry) {
  let low = 0;
  let high = bucket.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareEntries(entry, bucket[middle]) < 0) high = middle;
    else low = middle + 1;
  }
  bucket.splice(low, 0, entry);
}

export class ListenerRegistry {
  constructor(options = {}) {
    this.exact = new Map();
    this.patterns = [];
    this.any = [];
    this.entries = new Map();
    this.patternIndex = new Map();
    this.ownerIndex = new Map();
    this.tagIndex = new Map();
    this.patternCounts = new Map();

    this.sequence = 0;
    this.total = 0;
    this.generation = 0;
    this.registrationFrozen = false;

    const compatibilityLimit = finiteLimit(options.maxListenersPerEvent, DEFAULT_MAX);
    this.limits = Object.freeze({
      maxListenersPerEvent: compatibilityLimit,
      maxListenersTotal: finiteLimit(options.maxListenersTotal, 0),
      maxPatternListeners: finiteLimit(options.maxPatternListeners, compatibilityLimit),
      maxListenersPerPattern: finiteLimit(options.maxListenersPerPattern, compatibilityLimit),
      maxAnyListeners: finiteLimit(options.maxAnyListeners, compatibilityLimit),
    });

    this.planCacheMax = Math.max(0, finiteLimit(options.planCacheMax, 1024));
    this.planCache = new Map();
  }

  _nextId() { this.sequence = (this.sequence + 1) >>> 0 || 1; return this.sequence; }

  _touch() {
    this.generation = (this.generation + 1) >>> 0;
    this.planCache.clear();
  }

  _assertMutable() {
    if (this.registrationFrozen) {
      throw new EventAdmissionError('Listener registration is frozen.', { code: 'EVENT_LISTENER_REGISTRY_FROZEN' });
    }
  }

  _assertTotal() {
    this._assertMutable();
    const max = this.limits.maxListenersTotal;
    if (max && this.total >= max) {
      throw new EventAdmissionError(`Exceeded maxListenersTotal (${max}).`, { code: 'EVENT_LISTENER_TOTAL_LIMIT' });
    }
  }

  _assertBucket(bucket, label, max = this.limits.maxListenersPerEvent) {
    if (max && bucket.length >= max) {
      throw new EventAdmissionError(`Exceeded listener limit (${max}) for "${label}".`, {
        code: 'EVENT_LISTENER_BUCKET_LIMIT',
        details: { label, maximum: max },
      });
    }
  }

  _entry(kind, key, fn, options = {}) {
    if (typeof fn !== 'function') throw new TypeError(`Listener for "${key ?? '*'}" must be a function`);
    const id = this._nextId();
    const prepend = options.prepend === true;
    const tags = Array.from(new Set((Array.isArray(options.tags) ? options.tags : options.tag ? [options.tag] : []).map(String)));
    return {
      id,
      kind,
      key,
      fn,
      once: options.once === true,
      prepend,
      priority: Number(options.priority ?? 0) || 0,
      order: prepend ? -id : id,
      meta: options.meta ?? null,
      owner: options.owner == null ? null : String(options.owner),
      tags,
      timeoutMs: Math.max(0, Number(options.timeoutMs) || 0),
      errorPolicy: options.errorPolicy || null,
      active: true,
      paused: options.paused === true,
      createdAt: Date.now(),
    };
  }

  _index(entry) {
    this.entries.set(entry.id, entry);
    if (entry.owner) {
      let ids = this.ownerIndex.get(entry.owner);
      if (!ids) this.ownerIndex.set(entry.owner, ids = new Set());
      ids.add(entry.id);
    }
    for (const tag of entry.tags) {
      let ids = this.tagIndex.get(tag);
      if (!ids) this.tagIndex.set(tag, ids = new Set());
      ids.add(entry.id);
    }
    this.total++;
    this._touch();
    return new ListenerHandle(this, entry.id);
  }

  addExact(eventName, fn, options = {}) {
    this._assertTotal();
    const bucket = this.exact.get(eventName) || [];
    this._assertBucket(bucket, eventName);
    const entry = this._entry('exact', eventName, fn, options);
    insertSorted(bucket, entry);
    this.exact.set(eventName, bucket);
    return { entry, handle: this._index(entry) };
  }

  addPattern(pattern, fn, options = {}) {
    this._assertTotal();
    this._assertBucket(this.patterns, pattern, this.limits.maxPatternListeners);
    const count = this.patternCounts.get(pattern) || 0;
    const perPattern = this.limits.maxListenersPerPattern;
    if (perPattern && count >= perPattern) {
      throw new EventAdmissionError(`Exceeded maxListenersPerPattern (${perPattern}) for "${pattern}".`, {
        code: 'EVENT_PATTERN_LISTENER_LIMIT',
      });
    }
    const entry = Object.assign(this._entry('pattern', pattern, fn, options), {
      pattern,
      prefix: globPrefix(pattern),
      regex: globToRegExp(pattern),
      segment: firstStaticSegment(pattern),
    });
    insertSorted(this.patterns, entry);
    let indexed = this.patternIndex.get(entry.segment);
    if (!indexed) this.patternIndex.set(entry.segment, indexed = new Set());
    indexed.add(entry);
    this.patternCounts.set(pattern, count + 1);
    return { entry, handle: this._index(entry) };
  }

  addAny(fn, options = {}) {
    this._assertTotal();
    this._assertBucket(this.any, '*', this.limits.maxAnyListeners);
    const entry = this._entry('any', '*', fn, options);
    insertSorted(this.any, entry);
    return { entry, handle: this._index(entry) };
  }

  getEntry(id) { return this.entries.get(Number(id)) || null; }

  describeEntry(entry) {
    return Object.freeze({
      id: entry.id,
      kind: entry.kind,
      eventName: entry.kind === 'exact' ? entry.key : null,
      pattern: entry.kind === 'pattern' ? entry.pattern : null,
      priority: entry.priority,
      once: entry.once,
      prepend: entry.prepend,
      active: entry.active,
      paused: entry.paused,
      owner: entry.owner,
      tags: entry.tags.slice(),
      timeoutMs: entry.timeoutMs,
      errorPolicy: entry.errorPolicy,
      meta: entry.meta,
      listener: entry.fn,
      listenerName: entry.fn.name || '(anonymous)',
      createdAt: entry.createdAt,
    });
  }

  _unindex(entry) {
    this.entries.delete(entry.id);
    if (entry.owner) {
      const ids = this.ownerIndex.get(entry.owner);
      ids?.delete(entry.id);
      if (ids?.size === 0) this.ownerIndex.delete(entry.owner);
    }
    for (const tag of entry.tags) {
      const ids = this.tagIndex.get(tag);
      ids?.delete(entry.id);
      if (ids?.size === 0) this.tagIndex.delete(tag);
    }
    entry.active = false;
    this.total = Math.max(0, this.total - 1);
    this._touch();
  }

  removeById(id) {
    const entry = this.entries.get(Number(id));
    if (!entry || !entry.active) return false;
    if (entry.kind === 'exact') {
      const bucket = this.exact.get(entry.key);
      if (bucket) {
        const index = bucket.indexOf(entry);
        if (index !== -1) bucket.splice(index, 1);
        if (bucket.length === 0) this.exact.delete(entry.key);
      }
    } else if (entry.kind === 'pattern') {
      const index = this.patterns.indexOf(entry);
      if (index !== -1) this.patterns.splice(index, 1);
      const indexed = this.patternIndex.get(entry.segment);
      indexed?.delete(entry);
      if (indexed?.size === 0) this.patternIndex.delete(entry.segment);
      const count = (this.patternCounts.get(entry.pattern) || 1) - 1;
      if (count <= 0) this.patternCounts.delete(entry.pattern);
      else this.patternCounts.set(entry.pattern, count);
    } else {
      const index = this.any.indexOf(entry);
      if (index !== -1) this.any.splice(index, 1);
    }
    this._unindex(entry);
    return true;
  }

  claimOnce(entry) {
    if (!entry.once) return entry.active;
    if (!entry.active) return false;
    return this.removeById(entry.id);
  }

  removeExact(eventName, fn) {
    const bucket = this.exact.get(eventName);
    if (!bucket) return false;
    const entry = bucket.find((candidate) => candidate.fn === fn && candidate.active);
    return entry ? this.removeById(entry.id) : false;
  }

  removePattern(pattern, fn) {
    const entry = this.patterns.find((candidate) => candidate.pattern === pattern && candidate.fn === fn && candidate.active);
    return entry ? this.removeById(entry.id) : false;
  }

  removeAny(fn) {
    const entry = this.any.find((candidate) => candidate.fn === fn && candidate.active);
    return entry ? this.removeById(entry.id) : false;
  }

  pause(id) {
    const entry = this.getEntry(id);
    if (!entry || entry.paused) return false;
    entry.paused = true;
    this._touch();
    return true;
  }

  resume(id) {
    const entry = this.getEntry(id);
    if (!entry || !entry.paused) return false;
    entry.paused = false;
    this._touch();
    return true;
  }

  removeOwner(owner) {
    const ids = Array.from(this.ownerIndex.get(String(owner)) || []);
    let removed = 0;
    for (const id of ids) if (this.removeById(id)) removed++;
    return removed;
  }

  removeTag(tag) {
    const ids = Array.from(this.tagIndex.get(String(tag)) || []);
    let removed = 0;
    for (const id of ids) if (this.removeById(id)) removed++;
    return removed;
  }

  clear(eventName = null) {
    if (eventName != null) {
      const bucket = Array.from(this.exact.get(eventName) || []);
      for (const entry of bucket) this.removeById(entry.id);
      return bucket.length;
    }
    const ids = Array.from(this.entries.keys());
    for (const id of ids) this.removeById(id);
    return ids.length;
  }

  _patternCandidates(eventName) {
    const segment = String(eventName).split(':', 1)[0];
    const output = [];
    const seen = new Set();
    for (const key of [segment, '*']) {
      const entries = this.patternIndex.get(key);
      if (!entries) continue;
      for (const entry of entries) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        if (!entry.active || entry.paused) continue;
        if (entry.prefix && !eventName.startsWith(entry.prefix)) continue;
        if (entry.regex.test(eventName)) output.push(entry);
      }
    }
    output.sort(compareEntries);
    return output;
  }

  plan(eventName, wildcardNames = null) {
    const cached = this.planCache.get(eventName);
    if (cached && cached.generation === this.generation) {
      // Dispatch plans are immutable and invalidated by registry generation.
      // A cache hit therefore needs no delete/reinsert LRU churn on the hot path.
      return cached.plan;
    }
    const resolvedWildcards = wildcardNames || computeWildcardEvents(eventName);
    const exactStages = [eventName, ...resolvedWildcards].map((name) => ({
      eventName: name,
      entries: (this.exact.get(name) || []).filter((entry) => entry.active && !entry.paused).slice(),
    }));
    const plan = Object.freeze({
      eventName,
      wildcardNames: Object.freeze(resolvedWildcards.slice()),
      exactStages,
      patterns: this._patternCandidates(eventName),
      any: this.any.filter((entry) => entry.active && !entry.paused).slice(),
    });
    if (this.planCacheMax > 0) {
      this.planCache.set(eventName, { generation: this.generation, plan });
      while (this.planCache.size > this.planCacheMax) this.planCache.delete(this.planCache.keys().next().value);
    }
    return plan;
  }

  hasPotential(eventName, wildcardNames = []) {
    if (this.exact.has(eventName)) return true;
    for (const name of wildcardNames) if (this.exact.has(name)) return true;
    return this.patterns.length > 0 || this.any.length > 0;
  }

  willDispatchTo(eventName, wildcardNames = []) {
    const plan = this.plan(eventName, wildcardNames);
    return plan.exactStages.some((stage) => stage.entries.length) || plan.patterns.length > 0 || plan.any.length > 0;
  }

  freeze() { this.registrationFrozen = true; return this; }
  unfreeze() { this.registrationFrozen = false; return this; }

  manifest() {
    return Array.from(this.entries.values())
      .filter((entry) => entry.active)
      .sort((left, right) => left.id - right.id)
      .map((entry) => this.describeEntry(entry));
  }
}

export default ListenerRegistry;
