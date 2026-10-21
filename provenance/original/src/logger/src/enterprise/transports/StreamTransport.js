'use strict';

import { once } from 'node:events';
import BaseTransport from './BaseTransport.js';
import JsonFormatter from '../serialization/JsonFormatter.js';

export class StreamTransport extends BaseTransport {
  constructor(stream, options = {}) {
    if (!stream || typeof stream.write !== 'function') throw new TypeError('StreamTransport requires a writable stream.');
    super({ ...options, name: options.name || 'stream' });
    this.stream = stream;
    if (options.serializer) this.serializer = options.serializer;
    this.formatter = options.formatter || new JsonFormatter();
    this.endOnClose = options.endOnClose === true;
  }

  async writeRecord(record) {
    if (this.closed || this.silent) return;
    let output = typeof this.formatter === 'function' ? await this.formatter(record, this.serializer) : await this.formatter.format(record, this.serializer);
    if (!Buffer.isBuffer(output)) output = String(output);
    if (typeof output === 'string' && !output.endsWith('\n')) output += '\n';
    if (!this.stream.write(output)) await once(this.stream, 'drain');
    this._written(Buffer.isBuffer(output) ? output.length : Buffer.byteLength(output));
    this.emit('written', record);
  }

  async close() {
    if (this.closed) return;
    if (this.endOnClose && typeof this.stream.end === 'function') await new Promise((resolve) => this.stream.end(resolve));
    await super.close();
  }
}

export default StreamTransport;
