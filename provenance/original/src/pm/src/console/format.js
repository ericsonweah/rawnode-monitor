'use strict';

import { formatDuration } from '../support/duration.js';

const colorEnabled = () => !!(process.stdout.isTTY && !process.env.NO_COLOR);
const wrap = (code, value) => colorEnabled() ? `\x1b[${code}m${value}\x1b[0m` : String(value);

export const style = Object.freeze({
  green: (value) => wrap('32', value),
  yellow: (value) => wrap('33', value),
  red: (value) => wrap('31', value),
  cyan: (value) => wrap('36', value),
  gray: (value) => wrap('90', value),
  bold: (value) => wrap('1', value),
});

export function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function stateText(state) {
  if (['running', 'ready', 'online'].includes(state)) return style.green(state);
  if (['starting', 'draining', 'stopping', 'backoff'].includes(state)) return style.yellow(state);
  if (['crashed', 'unhealthy', 'quarantined', 'boot_failed'].includes(state)) return style.red(state);
  return style.gray(state || 'unknown');
}

export function renderTable(rows) {
  if (!rows.length) return '';
  const widths = [];
  for (const row of rows) row.forEach((cell, index) => { widths[index] = Math.max(widths[index] || 0, String(cell.raw ?? cell).length); });
  return rows.map((row, rowIndex) => {
    const line = row.map((cell, index) => {
      const raw = String(cell.raw ?? cell);
      const shown = String(cell.shown ?? cell);
      return shown + ' '.repeat(Math.max(0, widths[index] - raw.length));
    }).join('  ').trimEnd();
    if (rowIndex === 0) return `${style.bold(line)}\n${widths.map((width) => '─'.repeat(width)).join('  ')}`;
    return line;
  }).join('\n');
}

export function renderStatus(groups = []) {
  const rows = [['APP', 'SLOT', 'PID', 'MODE', 'STATE', 'UPTIME', 'CPU', 'MEMORY', 'RESTARTS']];
  for (const group of groups) {
    if (!group.processes.length) {
      rows.push([group.name, '-', '-', group.mode, { raw: group.quarantined ? 'quarantined' : 'stopped', shown: stateText(group.quarantined ? 'quarantined' : 'stopped') }, '-', '-', '-', group.restart?.restartTimes?.length || 0]);
      continue;
    }
    const active = new Set();
    for (const process of group.processes) {
      const key = process.slot;
      if (active.has(key) && ['stopped', 'crashed'].includes(process.state)) continue;
      active.add(key);
      rows.push([
        group.name,
        process.slot,
        process.pid || '-',
        group.mode,
        { raw: process.state, shown: stateText(process.state) },
        process.uptimeMs ? formatDuration(process.uptimeMs) : '-',
        process.metrics?.cpu?.percent != null ? `${process.metrics.cpu.percent.toFixed(1)}%` : '-',
        process.metrics?.memory?.rss != null ? formatBytes(process.metrics.memory.rss) : '-',
        group.restart?.restartTimes?.length || 0,
      ]);
    }
  }
  return renderTable(rows);
}

export function print(value, options = {}) {
  if (options.json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else if (typeof value === 'string') process.stdout.write(value.endsWith('\n') ? value : `${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
