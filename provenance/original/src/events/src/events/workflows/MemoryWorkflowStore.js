'use strict';

export class MemoryWorkflowStore {
  constructor(options = {}) {
    this.maxItems = Math.max(1, Number(options.maxItems) || 100_000);
    this.records = new Map();
  }

  async create(record) {
    if (this.records.size >= this.maxItems) throw new Error('Workflow store capacity exceeded');
    if (this.records.has(record.id)) throw new Error(`Workflow already exists: ${record.id}`);
    this.records.set(record.id, structuredCloneSafe(record));
    return this.get(record.id);
  }
  async get(id) { const record = this.records.get(String(id)); return record ? structuredCloneSafe(record) : null; }
  async save(record) { this.records.set(String(record.id), structuredCloneSafe(record)); return this.get(record.id); }
  async remove(id) { return this.records.delete(String(id)); }
  async list(options = {}) {
    let records = Array.from(this.records.values());
    if (options.name) records = records.filter((record) => record.name === String(options.name));
    if (options.status) records = records.filter((record) => record.status === String(options.status));
    return records.map(structuredCloneSafe);
  }
  snapshot() { return Object.freeze({ items: this.records.size, maxItems: this.maxItems }); }
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch {}
  }
  if (Array.isArray(value)) return value.map(structuredCloneSafe);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value);
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code };
  const output = {};
  for (const [key, child] of Object.entries(value)) output[key] = structuredCloneSafe(child);
  return output;
}

export default MemoryWorkflowStore;
