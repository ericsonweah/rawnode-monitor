'use strict';

export class PublishQueue {
  constructor(options = {}) {
    this.maxItems = Math.max(1, Number(options.maxItems) || 10_000);
    this.maxBytes = Math.max(1, Number(options.maxBytes) || 16 * 1024 * 1024);
    this.overflow = options.overflow || 'drop-oldest';
    this.items = [];
    this.head = 0;
    this.bytes = 0;
    this.stats = { accepted: 0, rejected: 0, dropped: 0, highWaterItems: 0, highWaterBytes: 0 };
  }

  get length() { return this.items.length - this.head; }

  push(item) {
    if (item.bytes > this.maxBytes) { this.stats.rejected++; return { accepted: false, reason: 'item-too-large' }; }
    while (this.length >= this.maxItems || this.bytes + item.bytes > this.maxBytes) {
      if (this.overflow === 'drop-oldest') {
        const dropped = this.shift();
        if (!dropped) break;
        this.stats.dropped++;
        dropped.onDrop?.('overflow');
      } else {
        if (this.overflow === 'drop-newest') this.stats.dropped++;
        else this.stats.rejected++;
        return { accepted: false, reason: this.overflow === 'drop-newest' ? 'drop-newest' : 'capacity' };
      }
    }
    this.items.push(item);
    this.bytes += item.bytes;
    this.stats.accepted++;
    this.stats.highWaterItems = Math.max(this.stats.highWaterItems, this.length);
    this.stats.highWaterBytes = Math.max(this.stats.highWaterBytes, this.bytes);
    return { accepted: true };
  }

  unshift(item) {
    if (item.bytes > this.maxBytes) {
      this.stats.rejected++;
      item.onDrop?.('item-too-large');
      return { accepted: false, reason: 'item-too-large' };
    }
    while (this.length >= this.maxItems || this.bytes + item.bytes > this.maxBytes) {
      const dropped = this.shift();
      if (!dropped) break;
      this.stats.dropped++;
      dropped.onDrop?.('overflow');
    }
    if (this.length >= this.maxItems || this.bytes + item.bytes > this.maxBytes) {
      this.stats.rejected++;
      item.onDrop?.('capacity');
      return { accepted: false, reason: 'capacity' };
    }
    const remaining = this.items.slice(this.head);
    this.items = [item, ...remaining];
    this.head = 0;
    this.bytes += item.bytes;
    this.stats.accepted++;
    this.stats.highWaterItems = Math.max(this.stats.highWaterItems, this.length);
    this.stats.highWaterBytes = Math.max(this.stats.highWaterBytes, this.bytes);
    return { accepted: true };
  }

  shift() {
    while (this.head < this.items.length) {
      const item = this.items[this.head++];
      if (!item) continue;
      this.bytes = Math.max(0, this.bytes - item.bytes);
      if (this.head > 4096 && this.head > this.items.length / 2) {
        this.items = this.items.slice(this.head);
        this.head = 0;
      }
      return item;
    }
    this.items.length = 0;
    this.head = 0;
    return null;
  }

  clear(reason = 'cleared') {
    let count = 0;
    while (this.length) {
      const item = this.shift();
      if (!item) break;
      count++;
      item.onDrop?.(reason);
    }
    return count;
  }

  snapshot() {
    return Object.freeze({
      items: this.length,
      bytes: this.bytes,
      maxItems: this.maxItems,
      maxBytes: this.maxBytes,
      overflow: this.overflow,
      stats: Object.freeze({ ...this.stats }),
    });
  }
}

export default PublishQueue;
