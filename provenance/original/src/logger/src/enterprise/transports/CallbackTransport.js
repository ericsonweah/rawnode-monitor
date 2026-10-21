'use strict';

import BaseTransport from './BaseTransport.js';

export class CallbackTransport extends BaseTransport {
  constructor(callback, options = {}) {
    if (typeof callback !== 'function') throw new TypeError('CallbackTransport requires a callback.');
    super({ ...options, name: options.name || callback.name || 'callback' });
    this.callback = callback;
  }

  async writeRecord(record) {
    if (this.closed || this.silent) return;
    await this.callback(record, this);
    this._written(0);
    this.emit('written', record);
  }
}

export default CallbackTransport;
