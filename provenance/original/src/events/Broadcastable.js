'use strict';

// src/events/Broadcastable.js

export const Broadcastable = (Base) => class extends Base {
  shouldBroadcast() { return true; }
  broadcastChannel() { return 'global'; }
  broadcastChannels() {
    const channel = this.broadcastChannel();
    return Array.isArray(channel) ? channel : [channel];
  }
  broadcastAs() { return this.constructor.name; }
  broadcastWith() { return this.payload; }
  broadcastWhen() { return true; }
  broadcastNow() { return false; }

  toBroadcastEnvelope() {
    return {
      event: this.broadcastAs(),
      channels: this.broadcastChannels(),
      payload: this.broadcastWith(),
      id: this.id,
      timestamp: this.timestamp,
      meta: this.meta ? { ...this.meta } : null,
    };
  }
};

export default Broadcastable;
