'use strict';

import { performance } from 'node:perf_hooks';
import defaultConfig from '../../../config/events.js';
import { AdvancedEventDispatcher } from '../AdvancedEventDispatcher.js';
import { EventConfiguration } from '../config/EventConfiguration.js';
import { createEventEnvelope, validateEventEnvelope } from '../serialization/EventEnvelope.js';

function parse(argv) {
  const args = [];
  const options = Object.create(null);
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith('--')) { args.push(value); continue; }
    const equal = value.indexOf('=');
    if (equal !== -1) { options[value.slice(2, equal)] = value.slice(equal + 1); continue; }
    const name = value.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) { options[name] = next; index++; }
    else options[name] = true;
  }
  return { args, options };
}

function bool(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function output(value, options = {}) {
  if (options.json || typeof value !== 'string') process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${value}\n`);
}

function usage() {
  return [
    'RawNode Events enterprise CLI',
    '',
    '  rawnode-events doctor [--profile production] [--json]',
    '  rawnode-events config [--profile compat|production] [--json]',
    '  rawnode-events bench [--iterations 250000] [--patterns 0] [--json]',
    '  rawnode-events envelope:create <event> [--secret value] [--json]',
    '  rawnode-events envelope:check <json> [--secret value] [--json]',
    '  rawnode-events help',
    '',
    'The framework-integrated commands events:list, events:inspect, events:stats,',
    'events:history, events:replay and events:bridge:* are registered by EventServiceProvider.',
  ].join('\n');
}

function busOptions(profile, options = {}) {
  const source = defaultConfig.bus || {};
  const normalizedProfile = String(profile || 'compat').toLowerCase();
  const strictNames = process.env.EVENTS_STRICT_NAMES == null
    ? ['production', 'strict', 'enterprise'].includes(normalizedProfile)
    : source.security?.strictNames === true;
  return {
    ...source,
    profile: normalizedProfile,
    security: { ...(source.security || {}), strictNames },
    metrics: { ...(source.metrics || {}), enabled: true },
    diagnostics: { ...(source.diagnostics || {}), enabled: bool(options.diagnostics, false) },
  };
}

async function doctor(options) {
  const profile = String(options.profile || defaultConfig.profile || 'production');
  const bus = new AdvancedEventDispatcher(busOptions(profile, options));
  try {
    const configuration = bus.configuration.toJSON();
    const findings = [];
    if (profile === 'production') {
      if (!configuration.listeners.maxTotal) findings.push({ level: 'error', code: 'EVENTS_LISTENERS_UNBOUNDED' });
      if (!configuration.deferred.maxItems || !configuration.deferred.maxBytes) findings.push({ level: 'error', code: 'EVENTS_DEFERRED_UNBOUNDED' });
      if (configuration.history.maxEntriesPerEvent > 0 && (!configuration.history.maxEventNames || !configuration.history.maxBytes)) findings.push({ level: 'error', code: 'EVENTS_HISTORY_UNBOUNDED' });
      if (configuration.logEvents) findings.push({ level: 'warning', code: 'EVENTS_PAYLOAD_LOGGING_ENABLED' });
    }
    bus.on('doctor:probe', () => true, { owner: 'events:doctor' });
    const report = bus.dispatchWithReport('doctor:probe');
    const health = bus.health();
    return {
      ok: health.ok !== false && report.errorCount === 0 && !findings.some((item) => item.level === 'error'),
      profile,
      node: process.version,
      zeroDependencies: true,
      health,
      probe: report.toJSON?.() || report,
      findings,
      configuration,
    };
  } finally {
    await bus.close();
  }
}

async function bench(options) {
  const iterations = Math.max(1, Math.min(10_000_000, Number(options.iterations) || 250_000));
  const patternCount = Math.max(0, Math.min(100_000, Number(options.patterns) || 0));
  const bus = new AdvancedEventDispatcher({ profile: 'compat', metrics: false, historyLimit: 0 });
  let sink = 0;
  bus.on('bench:exact', (value) => { sink += value; });
  for (let index = 0; index < patternCount; index++) bus.onPattern(`bench:${index}:**`, () => {});
  for (let index = 0; index < 10_000; index++) bus.dispatch('bench:exact', 1);
  const started = performance.now();
  for (let index = 0; index < iterations; index++) bus.dispatch('bench:exact', 1);
  const elapsedMs = performance.now() - started;
  await bus.close();
  return {
    scenario: 'exact-dispatch',
    iterations,
    patternCount,
    elapsedMs,
    operationsPerSecond: elapsedMs ? Math.round(iterations / elapsedMs * 1000) : Infinity,
    nanosecondsPerDispatch: elapsedMs ? Math.round(elapsedMs * 1e6 / iterations) : 0,
    sink,
  };
}

export async function runCli(argv = process.argv.slice(2)) {
  const { args, options } = parse(argv);
  const command = args.shift() || 'help';
  if (command === 'help' || command === '--help' || bool(options.help)) {
    output(usage(), options);
    return 0;
  }
  if (command === 'doctor') {
    const result = await doctor(options);
    output(result, options);
    return result.ok ? 0 : 2;
  }
  if (command === 'config') {
    const profile = String(options.profile || defaultConfig.profile || 'compat');
    output(new EventConfiguration(busOptions(profile, options)).toJSON(), options);
    return 0;
  }
  if (command === 'bench') {
    output(await bench(options), options);
    return 0;
  }
  if (command === 'envelope:check') {
    if (!args[0]) throw new Error('envelope:check requires a JSON envelope');
    const parsed = JSON.parse(args[0]);
    const result = validateEventEnvelope(parsed, { secret: options.secret || undefined });
    output(result, options);
    return result.ok ? 0 : 2;
  }
  if (command === 'envelope:create') {
    if (!args[0]) throw new Error('envelope:create requires an event name');
    output(createEventEnvelope(args[0], [], { secret: options.secret || undefined }), options);
    return 0;
  }
  throw new Error(`Unknown RawNode Events command: ${command}`);
}

export default runCli;
