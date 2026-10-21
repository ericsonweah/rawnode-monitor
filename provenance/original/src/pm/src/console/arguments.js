'use strict';

export function parseArgs(argv = []) {
  const positionals = [];
  const options = Object.create(null);
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (value.startsWith('--no-')) {
      options[value.slice(5)] = false;
      continue;
    }
    if (value.startsWith('--')) {
      const raw = value.slice(2);
      const equal = raw.indexOf('=');
      if (equal !== -1) {
        options[raw.slice(0, equal)] = raw.slice(equal + 1);
        continue;
      }
      const next = argv[index + 1];
      if (next != null && !next.startsWith('-')) {
        options[raw] = next;
        index++;
      } else options[raw] = true;
      continue;
    }
    if (value.startsWith('-') && value.length > 1) {
      for (const flag of value.slice(1)) options[flag] = true;
      continue;
    }
    positionals.push(value);
  }
  return { command: positionals.shift() || 'status', positionals, options };
}

export function numberOption(value, fallback = undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
