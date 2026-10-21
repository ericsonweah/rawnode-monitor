'use strict';

import { randomUUID } from 'node:crypto';
import BaseTransport from './BaseTransport.js';

function method(client, ...names) {
  for (const name of names) if (typeof client?.[name] === 'function') return client[name].bind(client);
  return null;
}

export class RedisStreamTransport extends BaseTransport {
  constructor(client, options = {}) {
    if (!client) throw new TypeError('RedisStreamTransport requires a Redis client.');
    super({ ...options, name: options.name || 'redis-stream' });
    this.client = client;
    if (options.serializer) this.serializer = options.serializer;
    this.stream = options.stream || 'rawnode:logs';
    this.maxLength = Math.max(100, Number(options.maxLength) || 100_000);
    this.approximate = options.approximate !== false;
    this.nodeId = options.nodeId || `${process.pid}`;
  }

  async writeRecord(record) {
    if (this.closed || this.silent) return;
    const xadd = method(this.client, 'xadd', 'xAdd');
    if (!xadd) throw new Error('Redis client does not expose XADD/xAdd.');
    const payload = this.serializer.stringify(record);
    const args = [this.stream, 'MAXLEN'];
    if (this.approximate) args.push('~');
    args.push(this.maxLength, '*',
      'id', record.id || randomUUID(),
      'payload', payload,
      'level', String(record.level || ''),
      'channel', String(record.channel || ''),
      'tenant', String(record.tenantId || ''),
      'node', this.nodeId,
      'createdAt', String(record.timeUnixMs || Date.now()));
    const id = await xadd(...args);
    this._written(Buffer.byteLength(payload));
    this.emit('written', { id, record });
    return id;
  }
}

export default RedisStreamTransport;
