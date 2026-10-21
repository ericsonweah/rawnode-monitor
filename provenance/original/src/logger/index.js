'use strict';

// Existing v1 public API — intentionally retained.
import AdvancedLogger from './src/submodules/advanced-logger/index.js';
import Logger from './src/submodules/simple-logger/index.js';
import defaultLogger from './src/submodules/default-logger/index.js';
import logger from './logger.js';
import ConsoleTransport from './src/submodules/console-transport/index.js';
import FileTransport from './src/submodules/file-transport/index.js';
import ObservableFileTransport from './src/submodules/observable-file-transport/index.js';
import ObservableFileTransportEnhanced from './src/submodules/observable-file-transport-enhanced/index.js';
import ObservableConsoleTransport from './src/submodules/observable-console-transport/index.js';
import ObservableConsoleTransportEnhanced from './src/submodules/observable-console-transport-enhanced/index.js';
import Config from './src/submodules/config/index.js';
import colors from './src/submodules/colors/index.js';

export * from './src/enterprise/index.js';

/** Lazy access for applications that deliberately avoid loading terminal code. */
export async function loadColors() {
  return (await import('./src/submodules/colors/index.js')).default;
}

export default defaultLogger;
export {
  Logger,
  AdvancedLogger,
  defaultLogger,
  logger,
  Config,
  colors,
  ConsoleTransport,
  FileTransport,
  ObservableFileTransport,
  ObservableFileTransportEnhanced,
  ObservableConsoleTransport,
  ObservableConsoleTransportEnhanced,
};
