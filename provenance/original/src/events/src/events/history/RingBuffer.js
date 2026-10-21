'use strict';

/** Fixed-capacity O(1) ring buffer. */
export class RingBuffer {
  constructor(capacity) {
    const value = Number(capacity);
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('RingBuffer capacity must be a positive safe integer');
    this.capacity = value;
    this.buffer = new Array(value);
    this.head = 0;
    this.length = 0;
  }

  push(value) {
    let evicted;
    if (this.length < this.capacity) {
      const index = (this.head + this.length) % this.capacity;
      this.buffer[index] = value;
      this.length++;
    } else {
      evicted = this.buffer[this.head];
      this.buffer[this.head] = value;
      this.head = (this.head + 1) % this.capacity;
    }
    return evicted;
  }

  peek() {
    return this.length ? this.buffer[this.head] : undefined;
  }

  shift() {
    if (!this.length) return undefined;
    const value = this.buffer[this.head];
    this.buffer[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.length--;
    if (this.length === 0) this.head = 0;
    return value;
  }

  clear() {
    this.buffer.fill(undefined);
    this.head = 0;
    this.length = 0;
  }

  /**
   * Remove matching entries while preserving logical order.
   * Normal append and capacity eviction remain O(1); this O(n) path is used
   * only for explicit cleanup such as TTL and global-budget enforcement.
   */
  remove(predicate) {
    if (typeof predicate !== 'function') throw new TypeError('RingBuffer.remove expects a predicate function');
    if (!this.length) return 0;

    const retained = new Array(this.length);
    let write = 0;
    let removed = 0;
    for (const value of this) {
      if (predicate(value)) removed++;
      else retained[write++] = value;
    }

    if (!removed) return 0;
    this.clear();
    for (let index = 0; index < write; index++) this.push(retained[index]);
    return removed;
  }

  toArray() {
    const output = new Array(this.length);
    for (let index = 0; index < this.length; index++) {
      output[index] = this.buffer[(this.head + index) % this.capacity];
    }
    return output;
  }

  *[Symbol.iterator]() {
    for (let index = 0; index < this.length; index++) {
      yield this.buffer[(this.head + index) % this.capacity];
    }
  }
}

export default RingBuffer;
