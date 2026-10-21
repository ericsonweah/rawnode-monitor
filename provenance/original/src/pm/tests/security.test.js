'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { AuditTrail } from '../src/security/AuditTrail.js';

test('audit trail redacts secrets, stays private, and rotates at a bounded size', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rawnode-pm-audit-'));
  const file = path.join(root, 'audit.jsonl');
  const audit = new AuditTrail({ file, maxBytes: 64 * 1024, maxFiles: 2 });
  try {
    await audit.record('control.start', {
      token: 'must-not-appear',
      authorization: 'Bearer abc.def.ghi',
      payload: 'x'.repeat(70 * 1024),
    });
    await audit.record('control.status', { ok: true });
  } finally {
    await audit.close();
  }

  const rotated = await readFile(`${file}.1`, 'utf8');
  const current = await readFile(file, 'utf8');
  assert.doesNotMatch(rotated, /must-not-appear|abc\.def\.ghi/);
  assert.match(rotated, /\[redacted\]/);
  assert.match(current, /control\.status/);
  if (process.platform !== 'win32') {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(`${file}.1`)).mode & 0o777, 0o600);
  }
});
