'use strict';

import SimpleLogger from '../simple-logger/index.js';
import ConsoleTransport from '../console-transport/index.js';
import FileTransport from '../file-transport/index.js';

/** Compatibility factory for the historical app/core logger. */
export default function createLogger(options = {}) {
  const transports = Array.isArray(options.transports) ? [...options.transports] : [];
  if (!options.transports) {
    if (options.consoleOutput !== false) transports.push(new ConsoleTransport());
    transports.push(new FileTransport({
      logDirectory: options.logDirectory || 'logs',
      fileName: options.accessLogName || 'application.log',
      maxSize: options.maxFileSize,
      rotateInterval: options.rotationInterval,
    }));
  }
  return new SimpleLogger({ level: options.logLevel || options.level || 'info', transports, ...options });
}
