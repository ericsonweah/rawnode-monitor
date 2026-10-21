'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { LoggerRecorder, FakeClock } from '../../index.js';

test('LoggerRecorder and FakeClock provide deterministic first-party testing support', async () => {
  const clock = new FakeClock(Date.parse('2026-01-01T00:00:00.000Z'));
  const recorder = new LoggerRecorder({ clock: clock.callback(), idFactory: () => 'record-id', level: 'important' });
  try {
    recorder.logger.info('hello');
    clock.tick(1000);
    recorder.logger.warn('careful');
    await recorder.flush();
    recorder.assertCount(2).assertLogged('info', 'hello').assertLogged('warn', /careful/).assertNotLogged('error');
    assert.equal(recorder.records()[0].id, 'record-id');
    assert.equal(recorder.records()[0].timeUnixMs, Date.parse('2026-01-01T00:00:00.000Z'));
  } finally { await recorder.close(); }
});
