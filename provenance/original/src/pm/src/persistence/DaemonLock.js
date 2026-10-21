'use strict';

import { open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir } from '../support/fs.js';

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

export class DaemonLock {
  constructor(file) {
    this.file = file;
    this.handle = null;
  }

  async acquire() {
    await ensureDir(path.dirname(this.file), 0o700);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.handle = await open(this.file, 'wx', 0o600);
        await this.handle.writeFile(`${process.pid}\n`);
        await this.handle.sync();
        return this;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        let pid = 0;
        try { pid = Number((await readFile(this.file, 'utf8')).trim()); } catch {}
        if (processAlive(pid)) {
          const lockError = new Error(`RawNode PM daemon is already running with PID ${pid}.`);
          lockError.code = 'RNPM_DAEMON_ALREADY_RUNNING';
          throw lockError;
        }
        await rm(this.file, { force: true });
      }
    }
    throw new Error('Unable to acquire RawNode PM daemon lock.');
  }

  async release() {
    if (this.handle) {
      await this.handle.close().catch(() => {});
      this.handle = null;
    }
    await rm(this.file, { force: true }).catch(() => {});
  }
}

export default DaemonLock;
