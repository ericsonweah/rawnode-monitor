#!/usr/bin/env node
'use strict';

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} ${args.join(' ')} failed (${code})\n${stdout}\n${stderr}`)));
  });
}

const temporary = await mkdtemp(path.join(tmpdir(), 'rawnode-events-consumer-'));
try {
  const packed = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary]);
  const metadata = JSON.parse(packed.stdout);
  const tarball = path.join(temporary, metadata[0].filename);
  const consumer = path.join(temporary, 'consumer');
  await mkdir(consumer, { recursive: true });
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], consumer);
  await writeFile(path.join(consumer, 'consumer.mjs'), `
    import Events, { AdvancedEventDispatcher, Event, MemoryEventStore } from 'rawnode-events';
    import { EventJobQueue } from 'rawnode-events/queue';
    import { AggregateRoot } from 'rawnode-events/sourcing';
    import { FakeEventBus } from 'rawnode-events/testing';
    import config from 'rawnode-events/config';
    if (!Events || typeof AdvancedEventDispatcher !== 'function') throw new Error('root export unavailable');
    const bus = new AdvancedEventDispatcher();
    let received = 0;
    bus.on('consumer:ready', (value) => { received += value; });
    bus.dispatch('consumer:ready', 1);
    if (received !== 1) throw new Error('dispatch failed');
    class A extends AggregateRoot {}
    if (!(new A('a')) || !(new MemoryEventStore()) || !(new EventJobQueue()) || !(new FakeEventBus()) || !(new Event())) throw new Error('subpath surface failed');
    if (!config.profile) throw new Error('config export failed');
    await bus.close();
    process.stdout.write('consumer-ok');
  `);
  const result = await run(process.execPath, ['consumer.mjs'], consumer);
  if (result.stdout !== 'consumer-ok') throw new Error(`Unexpected consumer output: ${result.stdout}`);
  process.stdout.write(`Installed package consumer: OK (${path.basename(tarball)})\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
