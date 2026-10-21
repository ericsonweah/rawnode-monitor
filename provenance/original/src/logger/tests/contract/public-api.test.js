'use strict';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  AdvancedLogger,
  Logger,
  Config,
  colors,
  defaultLogger,
  logger,
  ConsoleTransport,
  FileTransport,
  ObservableConsoleTransport,
  ObservableConsoleTransportEnhanced,
  ObservableFileTransport,
  ObservableFileTransportEnhanced,
  MemoryTransport,
  createLogger,
  createRuntimeLogger,
  NullLogger,
} from '../../index.js';

const levels = [
  'emergency', 'alert', 'critical', 'error', 'urgent', 'priority', 'warn',
  'notice', 'success', 'info', 'debug', 'metric', 'metrics', 'important',
];

const instances = [];
function track(instance) { instances.push(instance); return instance; }

after(async () => {
  await Promise.allSettled(instances.map((instance) => instance?.close?.()));
  await Promise.allSettled([logger?.close?.(), defaultLogger?.close?.()]);
});

test('v1 public exports and level methods remain available', async () => {
  assert.ok(defaultLogger);
  assert.ok(logger);
  assert.equal(typeof Config.getLevelConfig, 'function');
  assert.equal(typeof Config.setProfile, 'function');
  assert.equal(typeof colors.rgb, 'function');
  for (const Transport of [
    ConsoleTransport,
    FileTransport,
    ObservableConsoleTransport,
    ObservableConsoleTransportEnhanced,
    ObservableFileTransport,
    ObservableFileTransportEnhanced,
  ]) assert.equal(typeof Transport, 'function');

  const instance = track(new AdvancedLogger({ level: 'important', transports: [] }));
  for (const level of levels) assert.equal(typeof instance[level], 'function', level);
  assert.equal(instance.mode, 'json');
  assert.equal(instance.runtime.profile.name, 'v1');
});

test('legacy two-argument transports continue to receive level and formatted text', async () => {
  const captured = [];
  const transport = { write(level, formatted) { captured.push({ level, formatted }); } };
  const instance = track(new AdvancedLogger({ level: 'debug', mode: 'object', transports: [transport] }));
  instance.info('legacy transport', { value: 1 });
  await instance.flush();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].level, 'info');
  assert.equal(typeof captured[0].formatted, 'string');
  assert.match(colors.strip ? colors.strip(captured[0].formatted) : captured[0].formatted, /legacy transport/);
});

test('one-argument custom transports preserve object and JSON modes', async () => {
  const objects = [];
  const json = [];
  const objectLogger = track(new AdvancedLogger({ level: 'debug', mode: 'object', transports: [{ write(value) { objects.push(value); } }] }));
  const jsonLogger = track(new AdvancedLogger({ level: 'debug', mode: 'json', transports: [{ write(value) { json.push(value); } }] }));
  objectLogger.info('object');
  jsonLogger.info('json');
  await Promise.all([objectLogger.flush(), jsonLogger.flush()]);
  assert.equal(typeof objects[0], 'object');
  assert.equal(typeof json[0], 'string');
  assert.equal(typeof JSON.parse(json[0]), 'object');
});

test('legacy middleware is ordered and log event payload remains compatibility-shaped', async () => {
  const captured = [];
  const events = [];
  const instance = track(new AdvancedLogger({ level: 'debug', mode: 'object', transports: [{ write(value) { captured.push(value); } }] }));
  instance.use(async (entry) => {
    if (String(entry.message).includes('first')) await new Promise((resolve) => setTimeout(resolve, 10));
    entry.middleware = true;
    return entry;
  });
  instance.on('log', (entry) => events.push(entry));
  instance.info('first');
  instance.info('second');
  await instance.flush();
  assert.deepEqual(captured.map((entry) => colors.strip ? colors.strip(entry.message) : entry.message), ['first', 'second']);
  assert.ok(captured.every((entry) => entry.middleware === true));
  assert.equal(events.length, 2);
  assert.equal(events[0].middleware, true);
});

test('Logger.create fluent builder remains functional and additive', async () => {
  const captured = [];
  const instance = track(Logger.create()
    .level('debug')
    .mode('object')
    .transport({ write(value) { captured.push(value); } })
    .plugin({ name: 'test-plugin', hooks: {} })
    .done());
  instance.debug('builder works');
  await instance.flush();
  assert.equal(captured.length, 1);
});

test('new enterprise factory defaults to production while constructors remain v1', async () => {
  const memory = new MemoryTransport();
  const enterprise = track(createLogger({ level: 'debug', transports: [memory] }));
  const legacy = track(new AdvancedLogger({ level: 'debug', transports: [] }));
  assert.equal(enterprise.runtime.profile.name, 'production');
  assert.equal(enterprise.mode, 'object');
  assert.equal(enterprise.colors, false);
  assert.equal(legacy.runtime.profile.name, 'v1');
});

test('bare runtime factory is available for infrastructure code', async () => {
  const memory = new MemoryTransport();
  const runtime = track(createRuntimeLogger({ profile: 'production', level: 'debug', transports: [memory] }));
  await runtime.logAsync('info', 'runtime');
  assert.equal(memory.all()[0].message, 'runtime');
});

test('fire-and-forget methods preserve historical undefined returns', () => {
  const advanced = track(new AdvancedLogger({ level: 'debug', transports: [new MemoryTransport()] }));
  const simple = track(new Logger({ level: 'debug', transports: [new MemoryTransport()] }));
  assert.equal(advanced.info('advanced-return'), undefined);
  assert.equal(simple.info('simple-return'), undefined);
});

test('closing immediately after a log drains accepted records', async () => {
  const memory = new MemoryTransport();
  const advanced = new AdvancedLogger({ level: 'debug', transports: [memory], mode: 'object' });
  advanced.info('drain-before-close');
  await advanced.close();
  assert.equal(memory.all().some((record) => record.message === 'drain-before-close'), true);
});

test('Config profile references remain live after switching and resetting', () => {
  Config.setProfile('dark');
  const dark = Config.levelConfigurations;
  assert.ok(dark.info);
  Config.setProfile('default');
  const current = Config.levelConfigurations;
  assert.ok(current.info);
  assert.notEqual(current, dark);
  Config.resetLevelConfigs();
  assert.ok(Config.levelConfigurations.error);
});

test('NullLogger exposes the complete lifecycle and fluent surface', async () => {
  const disabled = new NullLogger();
  assert.equal(disabled.info('ignored'), false);
  assert.equal(await disabled.logAsync('info', 'ignored'), null);
  assert.equal(disabled.child({ id: 1 }), disabled);
  assert.equal(disabled.time('x').stop(), null);
  await disabled.flush();
  await disabled.close();
  assert.equal(disabled.health().status, 'disabled');
});

test('embedded colors public API remains chainable after source cleanup', async () => {
  const { colors } = await import('../../index.js');
  const styled = colors.red.bold('hello');
  assert.equal(colors.strip(styled), 'hello');
  assert.equal(typeof colors.rgb, 'function');
  assert.equal(typeof colors.gradient, 'function');
  const gradient = colors.gradient(['#ff0000', '#0000ff']);
  assert.equal(typeof gradient.apply, 'function');
  assert.equal(typeof colors.format, 'function');
  assert.equal(typeof colors.stats, 'function');
});
