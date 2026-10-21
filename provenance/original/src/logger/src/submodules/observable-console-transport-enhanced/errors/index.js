'use strict';
import Transformer from "../../Transformer/index.js";
import { blue, red, yellow, green, magenta, reset } from "../../colors/index.js";


// Require your color module (adjust the path as needed)// moved import for { blue, red, yellow, green, magenta, reset }// moved import for Transformer

/**
 * ObservableConsoleTransportEnhanced extends Transformer to provide an enterprise-grade,
 * fully event-driven console transport with configurable formatting using your color module.
 */
class ObservableConsoleTransportEnhanced extends Transformer {
  /**
   * Creates a new ObservableConsoleTransportEnhanced instance.
   * @param {Object} options - Configuration options.
   * @param {string} [options.prefix=''] - Optional prefix to prepend to each log message.
   * @param {string} [options.suffix=''] - Optional suffix to append to each log message.
   * @param {Function} [options.formatter] - Custom formatter function; receives (message, logEntry).
   */
  constructor(options = {}) {
    super({ objectMode: true });
    this.prefix = options.prefix || '';
    this.suffix = options.suffix || '';
    // Use the color module to set default colors for each log level.
    this.levelColors = {
      error: red,
      warn: yellow,
      info: blue,
      debug: magenta
    };
    // Allow custom formatter; defaults to identity function.
    this.formatter = options.formatter || ((msg) => msg);
  }

  /**
   * _transform processes each log entry. It emits events at various stages:
   * - 'beforeFormat': right before applying formatting.
   * - 'afterFormat': after formatting is applied.
   * - 'beforeWrite': just before outputting to the console.
   * - 'afterWrite': immediately after the log entry is output.
   *
   * @param {Object} logEntry - The log entry object (expects a 'formatted' property).
   * @param {string} encoding - Not used in object mode.
   * @param {Function} callback - Callback to signal completion.
   * @private
   */

  // In AdvancedLogger.js
// _transform(logEntry, encoding, callback) {
//   this.transports.forEach((transport) => {
//     try {
//       // Pass the full log entry object rather than separate arguments.
//       transport.write(logEntry);
//     } catch (err) {
//       console.error('Transport error in AdvancedLogger:', err);
//     }
//   });
//   callback(null, logEntry);
// }

  _transform(logEntry, encoding, callback) {
    // Emit event before formatting.
    this.emit('beforeFormat', logEntry);

    // Build the message with prefix and suffix.
    let message = `${this.prefix}${logEntry.formatted}${this.suffix}`;
    // Apply the custom formatter.
    message = this.formatter(message, logEntry);

    // Emit event after formatting.
    this.emit('afterFormat', message, logEntry);

    // Use the color module for colorizing based on log level.
    const colorFn = this.levelColors[logEntry.level] || ((text) => text);
    const output = colorFn(message) + reset();

    // Emit event before writing to console.
    this.emit('beforeWrite', output, logEntry);

    // Write to console using appropriate method.
    switch (logEntry.level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }

    // Emit event after writing.
    this.emit('afterWrite', output, logEntry);

    // Signal that transformation is complete.
    callback(null, logEntry);
  }
}

export default ObservableConsoleTransportEnhanced;
