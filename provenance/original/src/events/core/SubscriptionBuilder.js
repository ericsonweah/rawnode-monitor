'use strict';

export class SubscriptionBuilder {
  constructor(dispatcher, kind, expression) {
    this.dispatcher = dispatcher;
    this.kind = kind;
    this.expression = expression;
    this.options = Object.create(null);
  }

  priority(value) { this.options.priority = Number(value) || 0; return this; }
  prepend(value = true) { this.options.prepend = value !== false; return this; }
  once(value = true) { this.options.once = value !== false; return this; }
  replay(value = true) { this.options.replay = value; return this; }
  replayConsumesOnce(value = true) { this.options.replayConsumesOnce = value !== false; return this; }
  owner(value) { this.options.owner = value == null ? null : String(value); return this; }
  tag(...values) {
    const tags = values.flat().filter((value) => value != null).map(String);
    this.options.tags = [...(this.options.tags || []), ...tags];
    return this;
  }
  timeout(value) { this.options.timeoutMs = Math.max(0, Number(value) || 0); return this; }
  errorPolicy(value) { this.options.errorPolicy = value; return this; }
  meta(value) { this.options.meta = value; return this; }
  paused(value = true) { this.options.paused = value !== false; return this; }
  when(condition) { this.options.condition = condition; return this; }

  listen(listener) {
    if (this.options.condition === false) return null;
    if (typeof this.options.condition === 'function' && this.options.condition() === false) return null;
    if (this.kind === 'pattern') return this.dispatcher.subscribePattern(this.expression, listener, this.options);
    if (this.kind === 'any') return this.dispatcher.subscribeAny(listener, this.options);
    return this.dispatcher.subscribe(this.expression, listener, this.options);
  }

  handle(listener) { return this.listen(listener); }
  using(listener) { return this.listen(listener); }
}

export default SubscriptionBuilder;
