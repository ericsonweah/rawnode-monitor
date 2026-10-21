'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdvancedEventDispatcher,
  EventDispatcher,
  Event,
} from '../../src/events/index.js';

test('legacy EventDispatcher keeps undefined return values and EventEmitter semantics', () => {
  const events = new EventDispatcher();
  let received = null;
  assert.equal(events.on('user:created', (value) => { received = value; }), undefined);
  assert.equal(events.dispatch('user:created', 42), undefined);
  assert.equal(received, 42);
});

test('dispatch ordering remains exact, hierarchical wildcard, pattern, then any', () => {
  const events = new AdvancedEventDispatcher();
  const order = [];
  events.on('http:request:received', () => order.push('exact'));
  events.on('http:request:*', () => order.push('request:*'));
  events.on('http:*', () => order.push('http:*'));
  events.onPattern('http:**', (name) => order.push(`pattern:${name}`));
  events.onAny((name) => order.push(`any:${name}`));
  assert.equal(events.dispatch('http:request:received', { ok: true }), undefined);
  assert.deepEqual(order, [
    'exact',
    'request:*',
    'http:*',
    'pattern:http:request:received',
    'any:http:request:received',
  ]);
});

test('priority, prepend and stable registration order remain compatible', () => {
  const events = new AdvancedEventDispatcher();
  const order = [];
  events.on('task:run', () => order.push('normal-1'), { priority: 10 });
  events.on('task:run', () => order.push('normal-2'), { priority: 10 });
  events.on('task:run', () => order.push('prepend-1'), { priority: 10, prepend: true });
  events.on('task:run', () => order.push('prepend-2'), { priority: 10, prepend: true });
  events.on('task:run', () => order.push('higher'), { priority: 20 });
  events.dispatch('task:run');
  assert.deepEqual(order, ['higher', 'prepend-2', 'prepend-1', 'normal-1', 'normal-2']);
});

test('dot normalization remains disabled by default and opt-in when requested', () => {
  const compat = new AdvancedEventDispatcher();
  let colon = 0;
  compat.on('udp:peerValidated', () => colon++);
  compat.dispatch('udp.peerValidated');
  assert.equal(colon, 0);

  const normalized = new AdvancedEventDispatcher({ normalizeDot: true });
  normalized.on('udp:peerValidated', () => colon++);
  normalized.dispatch('udp.peerValidated');
  assert.equal(colon, 1);
});

test('event-object dispatch preserves object as first argument and attaches context', () => {
  class UserRegistered extends Event { static eventName = 'user:registered'; }
  const events = new AdvancedEventDispatcher();
  let received;
  events.on('user:registered', (event) => { received = event; });
  const context = events.createContext({ transport: 'http', requestId: 'req-1' });
  const event = new UserRegistered({ id: 7 });
  events.run(context, () => events.dispatch(event));
  assert.equal(received, event);
  assert.equal(event.ctx.id, context.id);
  assert.equal(event.payload.id, 7);
});

test('history shape and conservative hasListeners behavior remain compatible', () => {
  const events = new AdvancedEventDispatcher({ historyLimit: 2, historyAllow: ['user:**'] });
  events.dispatch('user:created', 1);
  events.dispatch('user:created', 2);
  events.dispatch('user:created', 3);
  const history = events.getHistory('user:created');
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((entry) => entry.args[0]), [2, 3]);

  events.onPattern('billing:paid:**', () => {});
  assert.equal(events.hasListeners('unrelated:event'), true, 'legacy conservative method stays conservative');
  assert.equal(events.willDispatchTo('unrelated:event'), false, 'new precise method is accurate');
});

test('dispatchAsync remains sequential and resolves undefined', async () => {
  const events = new AdvancedEventDispatcher();
  const order = [];
  events.on('job:run', async () => { await Promise.resolve(); order.push(1); });
  events.on('job:run', async () => { order.push(2); });
  assert.equal(await events.dispatchAsync('job:run'), undefined);
  assert.deepEqual(order, [1, 2]);
});
