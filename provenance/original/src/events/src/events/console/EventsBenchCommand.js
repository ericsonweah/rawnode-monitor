'use strict';

import { performance } from 'node:perf_hooks';
import { AdvancedEventDispatcher } from '../AdvancedEventDispatcher.js';

export class EventsBenchCommand {
  constructor(app = null) {
    this.app = app;
    this.signature = 'events:bench {--iterations=100000}';
    this.description = 'Run the built-in zero-dependency event-dispatch microbenchmark.';
  }

  async handle(options = {}) {
    const iterations = Math.max(1, Math.min(10_000_000, Number(options.iterations) || 100_000));
    const bus = new AdvancedEventDispatcher({ profile: 'compat' });
    let sink = 0;
    bus.on('bench:exact', (value) => { sink += value; });
    for (let index = 0; index < 10_000; index++) bus.dispatch('bench:exact', 1);
    const started = performance.now();
    for (let index = 0; index < iterations; index++) bus.dispatch('bench:exact', 1);
    const durationMs = performance.now() - started;
    await bus.close();
    return {
      iterations,
      durationMs,
      opsPerSecond: durationMs ? iterations / durationMs * 1000 : Infinity,
      nsPerDispatch: durationMs ? durationMs * 1e6 / iterations : 0,
      sink,
    };
  }
}

export default EventsBenchCommand;
