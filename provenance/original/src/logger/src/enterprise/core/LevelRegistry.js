'use strict';

const DEFAULT_LEVELS = Object.freeze([
  { name: 'emergency', rank: 0, severity: 80, syslog: 0, consoleMethod: 'error', category: 'operational', droppable: false },
  { name: 'alert', rank: 1, severity: 75, syslog: 1, consoleMethod: 'error', category: 'operational', droppable: false },
  { name: 'critical', rank: 2, severity: 70, syslog: 2, consoleMethod: 'error', category: 'operational', droppable: false },
  { name: 'error', rank: 3, severity: 60, syslog: 3, consoleMethod: 'error', category: 'operational', droppable: false },
  { name: 'urgent', rank: 4, severity: 55, syslog: null, consoleMethod: 'error', category: 'operational', droppable: false },
  { name: 'priority', rank: 5, severity: 50, syslog: null, consoleMethod: 'warn', category: 'operational', droppable: false },
  { name: 'warn', rank: 6, severity: 40, syslog: 4, consoleMethod: 'warn', category: 'operational', droppable: true },
  { name: 'notice', rank: 7, severity: 35, syslog: 5, consoleMethod: 'log', category: 'operational', droppable: true },
  { name: 'success', rank: 8, severity: 32, syslog: null, consoleMethod: 'log', category: 'success', droppable: true },
  { name: 'info', rank: 9, severity: 30, syslog: 6, consoleMethod: 'log', category: 'operational', droppable: true },
  { name: 'debug', rank: 10, severity: 20, syslog: 7, consoleMethod: 'debug', category: 'diagnostic', droppable: true },
  { name: 'metric', rank: 11, severity: 15, syslog: null, consoleMethod: 'log', category: 'metric', droppable: true },
  { name: 'metrics', rank: 12, severity: 15, syslog: null, consoleMethod: 'log', category: 'metric', droppable: true },
  { name: 'important', rank: 13, severity: 45, syslog: null, consoleMethod: 'warn', category: 'important', droppable: false },
]);

const DEFAULT_ALIASES = Object.freeze({
  warning: 'warn',
  fatal: 'critical',
  trace: 'debug',
});

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeDefinition(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Level definition must be an object.');
  const name = normalizeName(input.name);
  if (!name) throw new TypeError('Level definition requires a name.');
  const rank = Number(input.rank);
  if (!Number.isFinite(rank)) throw new TypeError(`Level [${name}] requires a finite rank.`);
  return Object.freeze({
    name,
    rank,
    severity: Number.isFinite(Number(input.severity)) ? Number(input.severity) : Math.max(0, 100 - rank),
    syslog: input.syslog == null ? null : Number(input.syslog),
    consoleMethod: input.consoleMethod || 'log',
    category: input.category || 'custom',
    droppable: input.droppable !== false,
    aliases: Object.freeze(Array.isArray(input.aliases) ? input.aliases.map(normalizeName).filter(Boolean) : []),
    metadata: Object.freeze({ ...(input.metadata || {}) }),
  });
}

export class LevelRegistry {
  constructor(options = {}) {
    this._levels = new Map();
    this._aliases = new Map();
    const definitions = options.levels || DEFAULT_LEVELS;
    for (const definition of definitions) this.register(definition, { replace: true });
    const aliases = { ...DEFAULT_ALIASES, ...(options.aliases || {}) };
    for (const [alias, target] of Object.entries(aliases)) this.alias(alias, target, { replace: true });
  }

  register(definition, options = {}) {
    const normalized = normalizeDefinition(definition);
    if (this._levels.has(normalized.name) && options.replace !== true) {
      throw new Error(`Log level [${normalized.name}] is already registered.`);
    }
    this._levels.set(normalized.name, normalized);
    for (const alias of normalized.aliases) this.alias(alias, normalized.name, { replace: options.replace === true });
    return this;
  }

  alias(aliasName, targetName, options = {}) {
    const alias = normalizeName(aliasName);
    const target = normalizeName(targetName);
    if (!alias || !target) throw new TypeError('Level alias and target are required.');
    if (!this._levels.has(target)) throw new Error(`Cannot alias unknown log level [${target}].`);
    if (this._aliases.has(alias) && options.replace !== true) throw new Error(`Log level alias [${alias}] already exists.`);
    this._aliases.set(alias, target);
    return this;
  }

  resolveName(name) {
    const normalized = normalizeName(name);
    return this._aliases.get(normalized) || normalized;
  }

  get(name) {
    return this._levels.get(this.resolveName(name)) || null;
  }

  has(name) {
    return this.get(name) !== null;
  }

  shouldLog(level, threshold) {
    return this.isEnabled(level, threshold);
  }

  isEnabled(level, threshold) {
    const candidate = this.get(level);
    const minimum = this.get(threshold);
    if (!candidate || !minimum) return false;
    return candidate.rank <= minimum.rank;
  }

  isHighSeverity(level) {
    return this.get(level)?.droppable === false;
  }

  isDroppable(level) {
    const definition = this.get(level);
    return definition ? definition.droppable !== false : true;
  }

  unregister(name) {
    const normalized = this.resolveName(name);
    const deleted = this._levels.delete(normalized);
    if (deleted) {
      for (const [alias, target] of [...this._aliases]) {
        if (target === normalized || alias === normalized) this._aliases.delete(alias);
      }
    }
    return deleted;
  }

  compare(left, right) {
    const a = this.get(left);
    const b = this.get(right);
    if (!a || !b) return Number.NaN;
    return a.rank - b.rank;
  }

  names() {
    return Array.from(this._levels.values()).sort((a, b) => a.rank - b.rank).map((item) => item.name);
  }

  definitions() {
    return Array.from(this._levels.values()).sort((a, b) => a.rank - b.rank);
  }

  snapshot() {
    return {
      levels: this.definitions().map((item) => ({ ...item, aliases: [...item.aliases], metadata: { ...item.metadata } })),
      aliases: Object.fromEntries(this._aliases),
    };
  }

  clone() {
    return new LevelRegistry({ levels: this.definitions(), aliases: Object.fromEntries(this._aliases) });
  }
}

export { DEFAULT_LEVELS };
export default LevelRegistry;
