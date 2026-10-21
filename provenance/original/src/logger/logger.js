'use strict';

import Config from './src/submodules/config/index.js';
import AdvancedLogger from './src/submodules/advanced-logger/index.js';
import ObservableConsoleTransportEnhanced from './src/submodules/observable-console-transport-enhanced/index.js';

const { getLevelConfig } = Config;

const enhancedConsole = new ObservableConsoleTransportEnhanced({
  prefix: '[APP] ',
  suffix: ' [END]',
  formatter: (message, entry) => {
    const config = getLevelConfig(entry?.level);
    return config
      ? `${config.formatted(message)} [${entry?.timestamp || new Date().toISOString()}]`
      : `${message} [${entry?.timestamp || new Date().toISOString()}]`;
  },
});

const logger = new AdvancedLogger({
  level: 'debug',
  transports: [enhancedConsole],
});

export { enhancedConsole };
export default logger;
