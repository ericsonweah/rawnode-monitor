'use strict';

import BaseTransport from '../base/BaseTransport.js';
import colors from '../colors/index.js';

const { red, yellow, green, white, blue, cyan, magenta } = colors;

class ObservableConsoleTransportEnhanced extends BaseTransport {
  constructor(options = {}) {
    super(options);
    this.prefix = typeof options.prefix === 'function' ? options.prefix('') : typeof options.prefix === 'string' ? options.prefix : '';
    this.suffix = typeof options.suffix === 'function' ? options.suffix('') : typeof options.suffix === 'string' ? options.suffix : '';
    this.levelColors = {
      emergency: red, alert: red, critical: red, error: red, urgent: red,
      priority: yellow, warn: yellow, notice: white, success: green,
      info: blue, debug: cyan, metric: magenta || cyan, metrics: magenta || cyan, important: green,
      ...(options.levelColors || {}),
    };
    this.formatter = options.formatter || ((message) => message);
  }

  _transform(chunk, _encoding, callback) {
    if (this.silent) return callback(null, chunk);
    const entry = this._normalize(chunk);
    this._safeEmit('beforeFormat', entry);
    let message = `${this.prefix}${entry.formatted ?? entry.message ?? ''}${this.suffix}`;
    try { message = this.formatter(message, entry, chunk); }
    catch (error) {
      this._safeEmit('formatError', error, entry);
      message = `${this.prefix}${entry.formatted ?? entry.message ?? ''}${this.suffix}`;
    }
    this._safeEmit('afterFormat', message, entry);
    const colorFn = this.levelColors[entry.level] || ((text) => text);
    let output;
    try { output = colorFn(message); } catch { output = message; }
    this._safeEmit('beforeWrite', output, entry);
    if (['error','critical','alert','emergency','urgent'].includes(entry.level)) console.error(output);
    else if (['warn','priority'].includes(entry.level)) console.warn(output);
    else console.log(output);
    this.stats.written++;
    this._safeEmit('afterWrite', output, entry);
    callback(null, chunk);
  }
}

export default ObservableConsoleTransportEnhanced;
