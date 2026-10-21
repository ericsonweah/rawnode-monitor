'use strict';

import BaseTransport from './BaseTransport.js';

export class NullTransport extends BaseTransport {
  constructor(options = {}) { super({ ...options, name: options.name || 'null' }); }
  async writeRecord() { if (!this.closed) this._written(0); }
}

export default NullTransport;
