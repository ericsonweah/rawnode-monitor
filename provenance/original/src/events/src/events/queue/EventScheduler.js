'use strict';

import { randomUUID } from 'node:crypto';

function parsePart(part, minimum, maximum) {
  const values = new Set();
  for (const token of String(part).split(',')) {
    const [rangeToken, stepToken] = token.split('/');
    const step = Math.max(1, Number(stepToken) || 1);
    let start = minimum;
    let end = maximum;
    if (rangeToken !== '*') {
      if (rangeToken.includes('-')) [start, end] = rangeToken.split('-').map(Number);
      else start = end = Number(rangeToken);
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < minimum || end > maximum || start > end) throw new TypeError(`Invalid cron field: ${part}`);
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

export function compileCron(expression) {
  const fields = String(expression || '').trim().split(/\s+/);
  if (fields.length !== 5) throw new TypeError('Cron expression must contain five fields: minute hour day month weekday');
  const [minute, hour, day, month, weekday] = fields;
  const spec = {
    minute: parsePart(minute, 0, 59),
    hour: parsePart(hour, 0, 23),
    day: parsePart(day, 1, 31),
    month: parsePart(month, 1, 12),
    weekday: parsePart(weekday, 0, 6),
  };
  return (date) => spec.minute.has(date.getMinutes()) && spec.hour.has(date.getHours()) && spec.day.has(date.getDate()) && spec.month.has(date.getMonth() + 1) && spec.weekday.has(date.getDay());
}

export class EventScheduler {
  constructor(options = {}) {
    this.dispatcher = options.dispatcher || null;
    this.queue = options.queue || null;
    this.entries = new Map();
    this.timer = null;
    this.closed = false;
    this.stats = { scheduled: 0, fired: 0, skipped: 0, errors: 0, cancelled: 0 };
  }

  every(intervalMs, task, options = {}) {
    const interval = Math.max(1, Number(intervalMs) || 0);
    return this._add({ ...options, task, type: 'interval', intervalMs: interval, nextAt: Number(options.startAt) || Date.now() + interval });
  }

  at(date, task, options = {}) {
    const timestamp = date instanceof Date ? date.getTime() : Number(date);
    if (!Number.isFinite(timestamp)) throw new TypeError('Scheduled date is invalid');
    return this._add({ ...options, task, type: 'once', nextAt: timestamp });
  }

  cron(expression, task, options = {}) {
    const matcher = compileCron(expression);
    return this._add({ ...options, task, type: 'cron', expression: String(expression), matcher, nextAt: this._nextCron(matcher, Date.now()) });
  }

  event(eventName, args = [], options = {}) {
    const task = () => this.dispatcher?.dispatchAsync?.(eventName, ...(Array.isArray(args) ? args : [args]));
    return options.cron ? this.cron(options.cron, task, options) : options.at ? this.at(options.at, task, options) : this.every(options.everyMs, task, options);
  }

  _add(input) {
    if (this.closed) throw new Error('EventScheduler is closed');
    if (typeof input.task !== 'function') throw new TypeError('Scheduled task must be a function');
    const entry = {
      id: input.id || randomUUID(),
      name: input.name || input.id || input.type,
      type: input.type,
      task: input.task,
      nextAt: input.nextAt,
      intervalMs: input.intervalMs || 0,
      expression: input.expression || null,
      matcher: input.matcher || null,
      overlap: input.overlap === true,
      running: false,
      enabled: input.enabled !== false,
      runs: 0,
      maxRuns: Math.max(0, Number(input.maxRuns) || 0),
      lastRunAt: 0,
      lastError: null,
    };
    this.entries.set(entry.id, entry);
    this.stats.scheduled++;
    this._arm();
    return Object.freeze({ id: entry.id, cancel: () => this.cancel(entry.id), pause: () => this.pause(entry.id), resume: () => this.resume(entry.id) });
  }

  _nextCron(matcher, after) {
    const date = new Date(after);
    date.setSeconds(0, 0);
    date.setMinutes(date.getMinutes() + 1);
    const maximum = 366 * 24 * 60;
    for (let index = 0; index < maximum; index++, date.setMinutes(date.getMinutes() + 1)) if (matcher(date)) return date.getTime();
    throw new Error('Cron expression has no occurrence within one year');
  }

  _arm() {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const enabled = Array.from(this.entries.values()).filter((entry) => entry.enabled);
    if (!enabled.length) return;
    const nextAt = Math.min(...enabled.map((entry) => entry.nextAt));
    this.timer = setTimeout(() => { this.timer = null; void this._tick(); }, Math.max(1, nextAt - Date.now()));
    this.timer.unref?.();
  }

  async _tick(now = Date.now()) {
    const due = Array.from(this.entries.values()).filter((entry) => entry.enabled && entry.nextAt <= now);
    for (const entry of due) {
      if (entry.running && !entry.overlap) { this.stats.skipped++; this._advance(entry, now); continue; }
      entry.running = true;
      entry.lastRunAt = now;
      entry.runs++;
      this.stats.fired++;
      this._advance(entry, now);
      const execute = async () => {
        try {
          if (this.queue) await this.queue.enqueue(entry.name, null, { handler: entry.task });
          else await entry.task({ id: entry.id, name: entry.name, run: entry.runs, scheduledAt: now });
          entry.lastError = null;
        } catch (error) { entry.lastError = error; this.stats.errors++; }
        finally { entry.running = false; if (entry.maxRuns && entry.runs >= entry.maxRuns) this.cancel(entry.id); }
      };
      void execute();
    }
    this._arm();
  }

  _advance(entry, now) {
    if (entry.type === 'once') { entry.enabled = false; return; }
    if (entry.type === 'interval') {
      do { entry.nextAt += entry.intervalMs; } while (entry.nextAt <= now);
      return;
    }
    entry.nextAt = this._nextCron(entry.matcher, now);
  }

  cancel(id) { const removed = this.entries.delete(String(id)); if (removed) this.stats.cancelled++; this._arm(); return removed; }
  pause(id) { const entry = this.entries.get(String(id)); if (!entry) return false; entry.enabled = false; this._arm(); return true; }
  resume(id) { const entry = this.entries.get(String(id)); if (!entry) return false; entry.enabled = true; if (entry.nextAt <= Date.now()) entry.nextAt = entry.type === 'interval' ? Date.now() + entry.intervalMs : entry.type === 'cron' ? this._nextCron(entry.matcher, Date.now()) : Date.now(); this._arm(); return true; }
  list() { return Array.from(this.entries.values()).map(({ task, matcher, lastError, ...entry }) => ({ ...entry, lastError: lastError ? { name: lastError.name, message: lastError.message } : null })); }
  snapshot() { return Object.freeze({ closed: this.closed, entries: this.entries.size, stats: Object.freeze({ ...this.stats }) }); }
  close() { this.closed = true; if (this.timer) clearTimeout(this.timer); this.timer = null; this.entries.clear(); }
  [Symbol.dispose]() { this.close(); }
}

export default EventScheduler;
