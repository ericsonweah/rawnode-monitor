'use strict';

import { EventEmitter } from 'node:events';
import { watch as fsWatch } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { IgnoreMatcher } from '../support/glob.js';
import { ChangeCoalescer } from './ChangeCoalescer.js';

async function walk(root, matcher, output, maxFiles, base = root) {
  const stack = [root];
  while (stack.length && output.size < maxFiles) {
    const current = stack.pop();
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (matcher.matches(absolute, base)) continue;
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile()) {
        try {
          const info = await stat(absolute);
          output.set(absolute, `${info.mtimeMs}:${info.size}`);
        } catch {}
      }
      if (output.size >= maxFiles) break;
    }
  }
}

export class WatchManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxFiles = Math.max(1_000, Number(options.maxFiles) || 200_000);
    this.sessions = new Map();
  }

  async watch(definition, callback) {
    await this.unwatch(definition.name);
    if (!definition.watch.enabled || definition.watch.mode === 'none') return null;
    const roots = definition.watch.paths.map((value) => path.resolve(definition.cwd, value));
    const matcher = new IgnoreMatcher(definition.watch.ignore);
    const session = {
      name: definition.name,
      definition,
      roots,
      matcher,
      callback,
      watchers: new Map(),
      snapshot: new Map(),
      closed: false,
      coalescer: null,
      pollTimer: null,
      reconcileTimer: null,
    };
    session.coalescer = new ChangeCoalescer(async (changes) => {
      this.emit('changes', definition.name, changes);
      await callback(changes);
    }, { debounceMs: definition.watch.debounceMs });
    this.sessions.set(definition.name, session);

    await this._rebuildSnapshot(session);
    await this._installNativeWatchers(session);
    session.pollTimer = setInterval(() => this._poll(session).catch((error) => this.emit('error', error, definition.name)), definition.watch.pollingIntervalMs);
    session.reconcileTimer = setInterval(() => this._installNativeWatchers(session).catch((error) => this.emit('error', error, definition.name)), definition.watch.reconcileIntervalMs);
    this.emit('watching', definition.name, roots);
    return session;
  }

  async _installNativeWatchers(session) {
    if (session.closed) return;
    const dirs = new Set();
    const stack = [...session.roots];
    while (stack.length && dirs.size < this.maxFiles) {
      const current = stack.pop();
      if (session.matcher.matches(current, session.definition.cwd)) continue;
      let entries;
      try { entries = await readdir(current, { withFileTypes: true }); }
      catch { continue; }
      dirs.add(current);
      for (const entry of entries) if (entry.isDirectory()) stack.push(path.join(current, entry.name));
    }

    for (const dir of dirs) {
      if (session.watchers.has(dir)) continue;
      try {
        const watcher = fsWatch(dir, { persistent: true }, (event, filename) => {
          const absolute = filename ? path.join(dir, String(filename)) : dir;
          if (!session.matcher.matches(absolute, session.definition.cwd)) session.coalescer.add(absolute, event);
          if (event === 'rename') queueMicrotask(() => this._installNativeWatchers(session).catch(() => {}));
        });
        watcher.on('error', (error) => this.emit('nativeError', error, session.name, dir));
        session.watchers.set(dir, watcher);
      } catch (error) {
        this.emit('nativeError', error, session.name, dir);
      }
    }

    for (const [dir, watcher] of session.watchers) {
      if (!dirs.has(dir)) {
        watcher.close();
        session.watchers.delete(dir);
      }
    }
  }

  async _buildSnapshot(session) {
    const next = new Map();
    for (const root of session.roots) await walk(root, session.matcher, next, this.maxFiles, session.definition.cwd);
    return next;
  }

  async _rebuildSnapshot(session) {
    session.snapshot = await this._buildSnapshot(session);
  }

  async _poll(session) {
    if (session.closed) return;
    const next = await this._buildSnapshot(session);
    for (const [file, signature] of next) {
      const previous = session.snapshot.get(file);
      if (previous == null) session.coalescer.add(file, 'created');
      else if (previous !== signature) session.coalescer.add(file, 'changed');
    }
    for (const file of session.snapshot.keys()) if (!next.has(file)) session.coalescer.add(file, 'deleted');
    session.snapshot = next;
  }

  async unwatch(name) {
    const session = this.sessions.get(name);
    if (!session) return false;
    session.closed = true;
    session.coalescer.close();
    if (session.pollTimer) clearInterval(session.pollTimer);
    if (session.reconcileTimer) clearInterval(session.reconcileTimer);
    for (const watcher of session.watchers.values()) watcher.close();
    session.watchers.clear();
    this.sessions.delete(name);
    this.emit('unwatched', name);
    return true;
  }

  status(name) {
    const session = this.sessions.get(name);
    if (!session) return null;
    return {
      enabled: true,
      mode: session.definition.watch.mode,
      roots: session.roots.slice(),
      nativeWatchers: session.watchers.size,
      trackedFiles: session.snapshot.size,
    };
  }

  async close() {
    await Promise.all(Array.from(this.sessions.keys(), (name) => this.unwatch(name)));
  }
}

export default WatchManager;
