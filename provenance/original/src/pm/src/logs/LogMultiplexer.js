'use strict';

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { LogWriter } from './LogWriter.js';
import { LineRingBuffer } from './LineRingBuffer.js';
import { safeName } from '../support/paths.js';

function timestampLine(prefix, chunk, enabled) {
  if (!enabled) return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  const stamp = new Date().toISOString();
  return Buffer.from(text.split(/(?<=\n)/).map((part) => part ? `${stamp} ${prefix}${part}` : '').join(''));
}

export class LogMultiplexer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.root = path.resolve(options.root || 'storage/logs/pm');
    this.buffers = new Map();
    this.attachments = new Map();
  }

  _buffer(name, maxBytes) {
    let buffer = this.buffers.get(name);
    if (!buffer) {
      buffer = new LineRingBuffer({ maxBytes });
      this.buffers.set(name, buffer);
    }
    return buffer;
  }

  attach(record) {
    const handle = record.handle;
    if (!handle || record.definition.logs.enabled === false) return null;
    const name = safeName(record.name);
    const slot = Number(record.slot) || 0;
    const dir = path.join(this.root, name);
    const config = record.definition.logs;
    const writers = {
      stdout: new LogWriter({ file: path.join(dir, `${slot}-out.log`), maxBytes: config.maxBytes, maxFiles: config.maxFiles }),
      stderr: new LogWriter({ file: path.join(dir, `${slot}-error.log`), maxBytes: config.maxBytes, maxFiles: config.maxFiles }),
    };
    const partial = { stdout: '', stderr: '' };
    const listeners = [];
    const buffer = this._buffer(record.name, config.bufferBytes);

    const bind = (source, streamName) => {
      if (!source?.on) return;
      const onData = async (chunk) => {
        source.pause?.();
        try {
          const prefixed = timestampLine(`[${record.name}:${slot}:${record.pid || '?'}] `, chunk, config.timestamp);
          await writers[streamName].write(prefixed);
          this._captureLines(record, streamName, chunk, partial, buffer);
        } catch (error) {
          this.emit('error', error, record);
        } finally {
          source.resume?.();
        }
      };
      source.on('data', onData);
      listeners.push(() => source.off('data', onData));
    };

    bind(handle.stdout, 'stdout');
    bind(handle.stderr, 'stderr');
    const attachment = { record, writers, listeners, partial };
    this.attachments.set(record.id, attachment);
    return attachment;
  }

  _captureLines(record, stream, chunk, partial, buffer) {
    const text = partial[stream] + (Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    const values = text.split(/\r?\n/);
    partial[stream] = values.pop() || '';
    for (const line of values) {
      const entry = { at: Date.now(), name: record.name, slot: record.slot, pid: record.pid, stream, line };
      buffer.push(entry);
      this.emit('line', entry);
    }
  }

  query(name, options = {}) {
    return this.buffers.get(name)?.query(options) || [];
  }

  async detach(record) {
    const attachment = this.attachments.get(record.id);
    if (!attachment) return;
    this.attachments.delete(record.id);
    for (const off of attachment.listeners) off();
    for (const [stream, value] of Object.entries(attachment.partial)) {
      if (value) {
        const entry = { at: Date.now(), name: record.name, slot: record.slot, pid: record.pid, stream, line: value };
        this._buffer(record.name, record.definition.logs.bufferBytes).push(entry);
        this.emit('line', entry);
      }
    }
    await Promise.all(Object.values(attachment.writers).map((writer) => writer.close()));
  }

  async close() {
    await Promise.all(Array.from(this.attachments.values(), async (attachment) => {
      for (const off of attachment.listeners) off();
      await Promise.all(Object.values(attachment.writers).map((writer) => writer.close()));
    }));
    this.attachments.clear();
  }
}

export default LogMultiplexer;
