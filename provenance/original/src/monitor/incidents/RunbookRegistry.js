'use strict';
export class RunbookRegistry {
  constructor() { this.runbooks = new Map(); this.frozen = false; }
  register(id, runbook = null, options = {}) {
    if (this.frozen) throw new Error('Runbook registry is frozen.');
    if (id && typeof id === 'object') { options = runbook || {}; runbook = id; id = runbook.id || runbook.name; }
    if (!id || !runbook) throw new TypeError('Runbook id and definition are required.');
    if (this.runbooks.has(String(id)) && options.replace !== true) throw new Error(`Runbook '${id}' is already registered.`);
    const record = Object.freeze({ id: String(id), title: runbook.title || String(id), description: runbook.description || runbook.summary || '', url: runbook.url || null, steps: Object.freeze([...(runbook.steps || [])]), owner: runbook.owner || null, tags: Object.freeze([...(runbook.tags || [])]) });
    this.runbooks.set(record.id, record); return record;
  }
  get(id) { return this.runbooks.get(String(id)) || null; }
  list() { return Object.freeze([...this.runbooks.values()]); }
  freeze() { this.frozen = true; return this; }
  snapshot() { return Object.freeze({ frozen: this.frozen, runbooks: this.list() }); }
}
export default RunbookRegistry;
