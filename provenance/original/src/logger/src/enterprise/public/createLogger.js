'use strict';

import AdvancedLogger from '../../submodules/advanced-logger/index.js';
import LoggerBuilder from './LoggerBuilder.js';

/**
 * Create the full RawNode logger facade. This preserves Transform-stream and
 * v1 transport behavior while enabling the enterprise runtime underneath.
 */
export function createLogger(options = {}) {
  return new AdvancedLogger({
    ...options,
    profile: options.profile || 'production',
    mode: options.mode || 'object',
    colors: options.colors ?? false,
  });
}

createLogger.builder = (options = {}) => new LoggerBuilder(options);

export default createLogger;
