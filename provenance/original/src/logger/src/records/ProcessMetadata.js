'use strict';

import os from 'node:os';
import { threadId, isMainThread } from 'node:worker_threads';

const snapshot = Object.freeze({
  pid: process.pid,
  ppid: process.ppid,
  threadId,
  isMainThread,
  hostname: os.hostname(),
  platform: process.platform,
  arch: process.arch,
  nodeVersion: process.version,
});

export function processMetadata() {
  return snapshot;
}

export default snapshot;
