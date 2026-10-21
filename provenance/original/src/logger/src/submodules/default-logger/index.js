'use strict';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Logger from '../advanced-logger/index.js';
import ConsoleTransport from '../console-transport/index.js';
import FileTransport from '../file-transport/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDirectory = path.resolve(__dirname, '..', 'logs');

const defaultLogger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    new ConsoleTransport(),
    new FileTransport({ logDirectory }),
  ],
});

export default defaultLogger;
