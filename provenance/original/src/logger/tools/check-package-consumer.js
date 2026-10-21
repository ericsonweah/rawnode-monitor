#!/usr/bin/env node
'use strict';

import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const temporary = await mkdtemp(path.join(tmpdir(), 'rawnode-logger-consumer-'));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd || root, env: { ...process.env, ...(options.env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(' ')} failed (${code})\n${stdout}\n${stderr}`));
    });
  });
}

try {
  const packed = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary]);
  const metadata = JSON.parse(packed.stdout);
  const tarball = path.join(temporary, metadata[0].filename);
  const consumer = path.join(temporary, 'consumer');
  await writeFile(path.join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: temporary });
  await writeFile(path.join(temporary, 'consumer.mjs'), `
    import defaultLogger, { createLogger, MemoryTransport, LevelRegistry } from 'rawnode-logger';
    import { SafeSerializer } from 'rawnode-logger/serialization';
    import { Redactor } from 'rawnode-logger/security';
    import { ChannelManager } from 'rawnode-logger/channels';
    import { LoggerRecorder } from 'rawnode-logger/testing';
    import { runDoctor } from 'rawnode-logger/console';
    import legacy from 'rawnode-logger/legacy';
    if (!defaultLogger || !legacy) throw new Error('default exports missing');
    if (new LevelRegistry().definitions().length !== 14) throw new Error('level contract missing');
    if (!(new SafeSerializer()) || !(new Redactor())) throw new Error('subpath constructors missing');
    const memory = new MemoryTransport();
    const logger = createLogger({ transports: [memory] });
    logger.info('installed-consumer');
    await logger.close();
    if (memory.all()[0].message !== 'installed-consumer') throw new Error('delivery failed');
    const channels = new ChannelManager({ default: 'memory', channels: { memory: { driver: 'memory' } } });
    channels.channel().info('channel');
    await channels.close();
    const recorder = new LoggerRecorder();
    recorder.logger.info('recorded');
    await recorder.close();
    const doctor = await runDoctor();
    if (!doctor.ok) throw new Error('doctor failed');
    process.stdout.write('consumer-ok');
  `);
  const result = await run(process.execPath, [path.join(temporary, 'consumer.mjs')], { cwd: temporary });
  if (result.stdout !== 'consumer-ok') throw new Error(`Unexpected consumer output: ${result.stdout}`);
  process.stdout.write(`Installed package consumer: OK (${path.basename(tarball)})\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
