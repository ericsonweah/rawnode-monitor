'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { AdvancedEventDispatcher } from '../../src/events/index.js';

test('recursive once listener is claimed before invocation', () => {
  const events = new AdvancedEventDispatcher();
  let count = 0;
  events.once('recursive:event', () => {
    count++;
    events.dispatch('recursive:event');
  });
  events.dispatch('recursive:event');
  assert.equal(count, 1);
});

test('concurrent dispatchAsync calls invoke one once listener exactly once', async () => {
  const events = new AdvancedEventDispatcher();
  let count = 0;
  events.once('concurrent:event', async () => {
    count++;
    await immediate();
  });
  await Promise.all([
    events.dispatchAsync('concurrent:event'),
    events.dispatchAsync('concurrent:event'),
  ]);
  assert.equal(count, 1);
});

test('replay listener failures are isolated and reported rather than escaping registration', () => {
  const events = new AdvancedEventDispatcher({ historyLimit: 10 });
  const diagnostics = [];
  events.onDiagnostic('listener:error', (entry) => diagnostics.push(entry));
  events.dispatch('audit:entry', { id: 1 });
  assert.doesNotThrow(() => {
    events.on('audit:entry', () => { throw new Error('replay failure'); }, { replay: true });
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].phase, 'replay');
});

test('async rejection from synchronous dispatch emits one listener:error diagnostic', async () => {
  const events = new AdvancedEventDispatcher({ metrics: true });
  let diagnostics = 0;
  events.onDiagnostic('listener:error', () => diagnostics++);
  events.on('async:reject', async () => { throw new Error('nope'); });
  events.dispatch('async:reject');
  await events.flush();
  assert.equal(diagnostics, 1);
  assert.equal(events.metrics().counters.async_listener_rejections_total, 1);
});

test('once plus replay retains compatibility unless replayConsumesOnce is selected', () => {
  const events = new AdvancedEventDispatcher({ historyLimit: 10 });
  events.dispatch('cache:warmed', 1);

  let compatible = 0;
  events.once('cache:warmed', () => compatible++, { replay: true });
  assert.equal(compatible, 1);
  events.dispatch('cache:warmed', 2);
  assert.equal(compatible, 2);

  let consumed = 0;
  events.once('cache:warmed', () => consumed++, { replay: 1, replayConsumesOnce: true });
  assert.equal(consumed, 1);
  events.dispatch('cache:warmed', 3);
  assert.equal(consumed, 1);
});
