'use strict';

import path from 'node:path';

function escapeRegex(char) {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

export function globToRegExp(glob) {
  const input = String(glob || '').replaceAll('\\', '/');
  let out = '^';
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '*') {
      if (input[i + 1] === '*') {
        i++;
        if (input[i + 1] === '/') { i++; out += '(?:.*/)?'; }
        else out += '.*';
      } else out += '[^/]*';
      continue;
    }
    if (char === '?') { out += '[^/]'; continue; }
    out += escapeRegex(char);
  }
  return new RegExp(`${out}$`);
}

export class IgnoreMatcher {
  constructor(patterns = []) {
    this.patterns = (Array.isArray(patterns) ? patterns : [patterns])
      .filter(Boolean)
      .map((pattern) => ({ pattern: String(pattern), re: globToRegExp(String(pattern)) }));
  }

  matches(filePath, root = process.cwd()) {
    const absolute = path.resolve(filePath);
    const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
    const base = path.basename(absolute);
    return this.patterns.some(({ re }) => re.test(relative) || re.test(base) || re.test(absolute.replaceAll(path.sep, '/')));
  }
}
