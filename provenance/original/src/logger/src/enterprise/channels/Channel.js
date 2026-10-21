'use strict';

const LEVELS = ['emergency','alert','critical','error','urgent','priority','warn','notice','success','info','debug','metric','metrics','important'];

export class Channel {
  constructor(name, logger) {
    if (!logger || typeof logger.log !== 'function') throw new TypeError('Channel requires a logger-like instance.');
    this.name = String(name);
    this.logger = logger.channel ? logger.channel(this.name) : logger;
  }
  log(level, message, data, options) { return this.logger.log(level, message, data, options); }
  logAsync(level, message, data, options) { return this.logger.logAsync(level, message, data, options); }
  isLevelEnabled(level) { return this.logger.isLevelEnabled?.(level) ?? true; }
  child(context, options) { return this.logger.child?.(context, options) || this; }
  with(context) { return this.logger.with?.(context) || this; }
  withTags(...tags) { return this.logger.withTags?.(...tags) || this; }
  withError(error, context) { return this.logger.withError?.(error, context) || this; }
  at(level) { return this.logger.at?.(level) || this; }
  forRequest(req, extra) { return this.logger.forRequest?.(req, extra) || this; }
  forJob(job, extra) { return this.logger.forJob?.(job, extra) || this; }
  ready(options) { return this.logger.ready?.(options) ?? Promise.resolve(this); }
  flush(options) { return this.logger.flush?.(options) ?? Promise.resolve(); }
  reopen(options) { return this.logger.reopen?.(options) ?? Promise.resolve(false); }
  close(options) { return this.logger.close?.(options) ?? Promise.resolve(); }
  health() { return this.logger.health?.() || { status: 'unknown' }; }
  stats() { return this.logger.stats?.() || {}; }
  prometheus(labels) { return this.logger.prometheus?.(labels) || ''; }
}
for (const level of LEVELS) Channel.prototype[level] = function levelMethod(message, data, options) { return this.log(level, message, data, options); };
export default Channel;
