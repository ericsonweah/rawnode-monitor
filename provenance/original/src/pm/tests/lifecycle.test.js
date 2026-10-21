'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProcessStateMachine } from '../src/lifecycle/ProcessStateMachine.js';
import { RestartPolicy } from '../src/lifecycle/RestartPolicy.js';

 test('state machine enforces lifecycle transitions', () => {
  const state = new ProcessStateMachine();
  state.transition('starting');
  state.transition('online');
  state.transition('ready');
  state.transition('running');
  state.transition('draining');
  state.transition('stopping');
  state.transition('stopped');
  assert.equal(state.state, 'stopped');
  assert.throws(() => state.transition('ready'), /Invalid process transition/);
});

test('restart policy quarantines after bounded failures', () => {
  const policy = new RestartPolicy({ maxRestarts: 2, windowMs: 60_000, minDelayMs: 1, maxDelayMs: 10, jitter: 0 });
  assert.equal(policy.decide({ exitCode: 1 }).restart, true);
  assert.equal(policy.decide({ exitCode: 1 }).restart, true);
  const third = policy.decide({ exitCode: 1 });
  assert.equal(third.quarantine, true);
});
