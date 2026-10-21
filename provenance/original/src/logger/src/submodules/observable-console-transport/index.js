'use strict';

import BaseTransport from '../base/BaseTransport.js';
import colors from '../colors/index.js';

const { red, yellow, cyan, blue } = colors;

class ObservableConsoleTransport extends BaseTransport {
  constructor(options = {}) {
    super(options);
    this.prefix = options.prefix || '';
    this.suffix = options.suffix || '';
    this.colors = { error: red, warn: yellow, info: blue, debug: cyan };
  }

  _transform(chunk, _encoding, callback) {
    if (this.silent) return callback(null, chunk);
    const entry = this._normalize(chunk);
    this._safeEmit('beforeWrite', entry);
    const colorFn = this.colors[entry.level] || ((text) => text);
    const output = colorFn(`${this.prefix}${entry.formatted ?? entry.message ?? ''}${this.suffix}`);
    if (entry.level === 'error') console.error(output);
    else if (entry.level === 'warn') console.warn(output);
    else console.log(output);
    this.stats.written++;
    this._safeEmit('afterWrite', entry);
    callback(null, chunk);
  }
}

export default ObservableConsoleTransport;
