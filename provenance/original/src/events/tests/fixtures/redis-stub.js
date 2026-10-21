'use strict';

import { EventEmitter } from 'node:events';

const channels = new Map();
const streams = new Map();
let streamSequence = 0;

export class FakeRedisClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.status = 'wait';
    this.ready = false;
    this.subscriptions = new Map();
    this.published = [];
    this.failPublish = options.failPublish || false;
  }

  isReady() { return this.ready; }
  connect() { this.status = 'ready'; this.ready = true; queueMicrotask(() => this.emit('ready')); return this; }
  async connectAsync() { this.connect(); return this; }

  async publish(channel, message) {
    if (this.failPublish) throw new Error('publish failed');
    this.published.push({ channel, message });
    const subscribers = Array.from(channels.get(channel) || []);
    for (const record of subscribers) queueMicrotask(() => record.callback(message, channel));
    return subscribers.length;
  }

  async subscribe(channel, callback) {
    let records = channels.get(channel);
    if (!records) channels.set(channel, records = new Set());
    const record = { client: this, callback };
    records.add(record);
    this.subscriptions.set(channel, record);
    return {
      ready: async () => true,
      unsubscribe: async () => {
        records.delete(record);
        this.subscriptions.delete(channel);
      },
    };
  }

  async unsubscribe(channel) {
    const record = this.subscriptions.get(channel);
    if (record) channels.get(channel)?.delete(record);
    this.subscriptions.delete(channel);
  }

  async quit() {
    for (const channel of Array.from(this.subscriptions.keys())) await this.unsubscribe(channel);
    this.status = 'closed';
    this.ready = false;
  }

  async xgroup() { return 'OK'; }
  async xadd(stream, ...parts) {
    const id = `${Date.now()}-${++streamSequence}`;
    let list = streams.get(stream);
    if (!list) streams.set(stream, list = []);
    const star = parts.indexOf('*');
    list.push([id, parts.slice(star + 1)]);
    return id;
  }
  async xreadgroup(...parts) {
    const streamIndex = parts.indexOf('STREAMS');
    const stream = parts[streamIndex + 1];
    const list = streams.get(stream) || [];
    return list.length ? [[stream, list.splice(0)]] : [];
  }
  async xack(_stream, _group, ...ids) { return ids.length; }
}

export function createClient(options = {}) { return new FakeRedisClient(options); }
export function resetRedisStub() { channels.clear(); streams.clear(); streamSequence = 0; }
