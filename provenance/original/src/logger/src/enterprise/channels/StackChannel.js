'use strict';

const LEVELS = ['emergency','alert','critical','error','urgent','priority','warn','notice','success','info','debug','metric','metrics','important'];

export class StackChannel {
  constructor(name, channels = [], options = {}) {
    this.name = String(name || 'stack');
    this.channels = [...channels];
    this.ignoreExceptions = options.ignoreExceptions === true;
  }
  log(level, message, data, options) {
    const results = [];
    for (const channel of this.channels) {
      try { results.push(channel.log(level, message, data, options)); }
      catch (error) { if (!this.ignoreExceptions) throw error; }
    }
    return results.some((value) => value !== false && value !== null);
  }
  async logAsync(level, message, data, options) {
    const results = await Promise.allSettled(this.channels.map((channel) => channel.logAsync(level, message, data, options)));
    const failed = results.filter((entry) => entry.status === 'rejected');
    if (failed.length && !this.ignoreExceptions) throw new AggregateError(failed.map((entry) => entry.reason), `Stack channel [${this.name}] failed.`);
    return results;
  }
  isLevelEnabled(level) { return this.channels.some((channel) => channel.isLevelEnabled?.(level) ?? true); }
  child(context, options) { return new StackChannel(this.name, this.channels.map((channel) => channel.child?.(context, options) || channel), { ignoreExceptions: this.ignoreExceptions }); }
  with(context) { return this.child(context); }
  withTags(...tags) { return new StackChannel(this.name, this.channels.map((channel) => channel.withTags?.(...tags) || channel), { ignoreExceptions: this.ignoreExceptions }); }
  withError(error, context) { return new StackChannel(this.name, this.channels.map((channel) => channel.withError?.(error, context) || channel), { ignoreExceptions: this.ignoreExceptions }); }
  at(level) { return new StackChannel(this.name, this.channels.map((channel) => channel.at?.(level) || channel), { ignoreExceptions: this.ignoreExceptions }); }
  ready(options) { return Promise.allSettled(this.channels.map((channel) => channel.ready?.(options))); }
  flush(options) { return Promise.allSettled(this.channels.map((channel) => channel.flush?.(options))); }
  reopen(options) { return Promise.allSettled(this.channels.map((channel) => channel.reopen?.(options))); }
  // The manager owns member-channel lifecycle; direct stacks intentionally do not close members by default.
  close(options = {}) { return options.closeMembers === true ? Promise.allSettled(this.channels.map((channel) => channel.close?.(options))) : Promise.resolve(); }
  health() {
    const channels = this.channels.map((channel) => channel.health?.() || { status: 'unknown' });
    return { status: channels.some((item) => item.status === 'degraded') ? 'degraded' : 'healthy', name: this.name, channels };
  }
  stats() { return { name: this.name, channels: this.channels.map((channel) => channel.stats?.() || {}) }; }
}
for (const level of LEVELS) StackChannel.prototype[level] = function levelMethod(message, data, options) { return this.log(level, message, data, options); };
export default StackChannel;
