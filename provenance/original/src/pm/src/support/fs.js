'use strict';

import { mkdir, open, rename, rm, chmod, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export async function ensureDir(dir, mode = 0o700) {
  await mkdir(dir, { recursive: true, mode });
  try { await chmod(dir, mode); } catch {}
  return dir;
}

export async function atomicWriteFile(filePath, data, options = {}) {
  const dir = path.dirname(filePath);
  const mode = options.mode ?? 0o600;
  await ensureDir(dir, options.dirMode ?? 0o700);
  const suffix = randomBytes(6).toString('hex');
  const temp = `${filePath}.${process.pid}.${suffix}.tmp`;
  const handle = await open(temp, 'wx', mode);
  try {
    await handle.writeFile(data, options.encoding ? { encoding: options.encoding } : undefined);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, filePath);
  try { await chmod(filePath, mode); } catch {}
}

export async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(filePath, value, options = {}) {
  const json = JSON.stringify(value, null, options.pretty === false ? 0 : 2) + '\n';
  await atomicWriteFile(filePath, json, { ...options, encoding: 'utf8' });
}

export async function removeIfExists(filePath) {
  try { await rm(filePath, { force: true, recursive: false }); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function exists(filePath) {
  try { await stat(filePath); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function writePrivateFile(filePath, data) {
  await ensureDir(path.dirname(filePath), 0o700);
  await writeFile(filePath, data, { mode: 0o600 });
  try { await chmod(filePath, 0o600); } catch {}
}
