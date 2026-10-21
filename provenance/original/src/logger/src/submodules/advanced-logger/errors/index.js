'use strict';
import Transformer from "../../Transformer/index.js";
import fs from "fs";
import path from "path";

// moved import for Transformer // Adjust the path as needed// moved import for fs// moved import for path

/**
 * Logging levels and their numeric severities.
 */
const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

/**
 * AdvancedLogger class that extends the Transformer.
 * Log entries are processed via middleware before being forwarded to transports.
 *
 * @extends Transformer
 */
class AdvancedLogger extends Transformer {
  /**
   * Creates a new AdvancedLogger instance.
   * @param {Object} options - Configuration options.
   * @param {string} [options.level='info'] - Minimum log level.
   * @param {Array<Object>} [options.transports=[]] - List of transport instances.
   */
  constructor(options = {}) {
    // Initialize the Transformer in object mode
    super({ objectMode: true });
    this.level = options.level || 'info';
    this.transports = options.transports || [];
  }

  /**
   * Logs a message at the specified level.
   * The log entry is passed through any middleware before being written.
   *
   * @param {string} level - Log level ('error', 'warn', 'info', 'debug').
   * @param {string} message - The log message.
   */
  log(level, message) {
    if (LEVELS[level] > LEVELS[this.level]) return;
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    const logEntry = { timestamp, level, message, formatted };

    // Apply middleware transformation (if any)
    this.applyMiddleware(logEntry)
      .then((transformedEntry) => {
        // Write the transformed log entry into the stream.
        // This triggers the _transform method.
        this.write(transformedEntry);
        // Emit a 'log' event for observers.
        this.emit('log', transformedEntry);
      })
      .catch((err) => {
        console.error('Middleware error in AdvancedLogger:', err);
      });
  }

  /**
   * Convenience method for logging error messages.
   * @param {string} message - The error message.
   */
  error(message) {
    this.log('error', message);
  }

  /**
   * Convenience method for logging warning messages.
   * @param {string} message - The warning message.
   */
  warn(message) {
    this.log('warn', message);
  }

  /**
   * Convenience method for logging informational messages.
   * @param {string} message - The informational message.
   */
  info(message) {
    this.log('info', message);
  }

  /**
   * Convenience method for logging debug messages.
   * @param {string} message - The debug message.
   */
  debug(message) {
    this.log('debug', message);
  }

  /**
   * The _transform method is called when data is written to the stream.
   * It forwards the (transformed) log entry to all configured transports.
   *
   * @param {Object} logEntry - The transformed log entry.
   * @param {string} encoding - Not used in object mode.
   * @param {Function} callback - Callback to signal completion.
   * @private
   */
  _transform(logEntry, encoding, callback) {
    this.transports.forEach((transport) => {
      try {
        transport.write(logEntry.level, logEntry.formatted);
      } catch (err) {
        console.error('Transport error in AdvancedLogger:', err);
      }
    });
    // Optionally pass the log entry downstream.
    callback(null, logEntry);
  }
}

export default AdvancedLogger
