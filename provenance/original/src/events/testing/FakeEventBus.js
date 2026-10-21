'use strict';

import { AdvancedEventDispatcher } from '../AdvancedEventDispatcher.js';
import { DispatchReport } from '../core/DispatchReport.js';
import { EventRecorder } from './EventRecorder.js';
import { EventAssertions } from './EventAssertions.js';
import { compileMatcherList, matchesAny } from '../support/glob.js';

export class FakeEventBus extends AdvancedEventDispatcher {
  constructor(options = {}) {
    super(options);
    this.fakeMatchers = compileMatcherList(options.fake || []);
    this.exceptMatchers = compileMatcherList(options.except || []);
    this.recorder = new EventRecorder(null, { maxItems: options.maxRecords || 100_000, autoStart: false });
    this.assertions = new EventAssertions(this.recorder);
  }

  fake(patterns = ['**']) { this.fakeMatchers = compileMatcherList(Array.isArray(patterns) ? patterns : [patterns]); return this; }
  except(patterns = []) { this.exceptMatchers = compileMatcherList(Array.isArray(patterns) ? patterns : [patterns]); return this; }
  restore() { this.fakeMatchers = []; this.exceptMatchers = []; return this; }

  _isFaked(eventOrName) {
    const name = this._peekEventName(eventOrName);
    if (this.exceptMatchers.length && matchesAny(this.exceptMatchers, name)) return false;
    return this.fakeMatchers.length > 0 && matchesAny(this.fakeMatchers, name);
  }

  _recordFake(eventOrName, args) {
    const resolved = this._resolveDispatchInput(eventOrName, args);
    this.recorder.record(resolved.name, resolved.finalArgs, this.getContext());
    return resolved;
  }

  dispatch(eventOrName, ...args) {
    if (!this._isFaked(eventOrName)) return super.dispatch(eventOrName, ...args);
    this._recordFake(eventOrName, args);
    return undefined;
  }

  dispatchAsync(eventOrName, ...args) {
    if (!this._isFaked(eventOrName)) return super.dispatchAsync(eventOrName, ...args);
    this._recordFake(eventOrName, args);
    return Promise.resolve(undefined);
  }

  dispatchWithReport(eventOrName, ...args) {
    if (!this._isFaked(eventOrName)) return super.dispatchWithReport(eventOrName, ...args);
    const resolved = this._recordFake(eventOrName, args);
    return new DispatchReport(resolved.name, { mode: 'fake', context: this.getContext() }).complete(0);
  }

  assertDispatched(...args) { return this.assertions.dispatched(...args); }
  assertNotDispatched(...args) { return this.assertions.notDispatched(...args); }
  assertDispatchedTimes(...args) { return this.assertions.dispatchedTimes(...args); }
}

export default FakeEventBus;
