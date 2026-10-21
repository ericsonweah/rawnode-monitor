'use strict';

export function normalizeEventName(name, normalizeDot = false) {
  if (typeof name !== 'string') return name;
  let value = name;
  const first = value.charCodeAt(0);
  const last = value.charCodeAt(value.length - 1);
  if (first <= 32 || last <= 32) value = value.trim();
  if (!value) return value;
  if (normalizeDot && value.includes('.')) value = value.replaceAll('.', ':');
  return value.includes('::') ? value.replace(/:{2,}/g, ':') : value;
}

export function computeWildcardEvents(eventName) {
  const value = String(eventName);
  let index = value.lastIndexOf(':');
  if (index <= 0) return [];
  const output = [];
  while (index > 0) {
    output.push(`${value.slice(0, index)}:*`);
    index = value.lastIndexOf(':', index - 1);
  }
  return output;
}

export function globPrefix(glob) {
  const value = String(glob);
  let index = 0;
  for (; index < value.length; index++) {
    const character = value[index];
    if (character === '*' || character === '?') break;
  }
  return value.slice(0, index);
}


export function firstStaticSegment(glob) {
  const first = String(glob ?? '').split(':', 1)[0] || '';
  return first.includes('*') || first.includes('?') || !first ? '*' : first;
}

export function globStaticRoot(glob) {
  const value = String(glob);
  const first = value.split(':', 1)[0] || '';
  return first.includes('*') || first.includes('?') ? null : first;
}

export function globToRegExp(glob) {
  const value = String(glob);
  let source = '^';

  for (let index = 0; index < value.length; index++) {
    const character = value[index];

    if (character === '*') {
      if (value[index + 1] === '*') {
        source += '.*';
        index++;
      } else {
        source += '[^:]*';
      }
      continue;
    }

    if (character === '?') {
      source += '[^:]';
      continue;
    }

    if ('\\.^$|()[]{}+'.includes(character)) source += `\\${character}`;
    else source += character;
  }

  source += '$';
  return new RegExp(source);
}

export function compileMatcherList(patterns) {
  if (!Array.isArray(patterns)) return [];
  return patterns
    .filter((pattern) => typeof pattern === 'string' && pattern.length > 0)
    .map((pattern) => Object.freeze({
      raw: pattern,
      prefix: globPrefix(pattern),
      root: globStaticRoot(pattern),
      regex: globToRegExp(pattern),
    }));
}

export function matchesAny(matchers, eventName) {
  if (!Array.isArray(matchers) || matchers.length === 0) return false;
  for (const matcher of matchers) {
    if (matcher.prefix && !eventName.startsWith(matcher.prefix)) continue;
    if (matcher.regex.test(eventName)) return true;
  }
  return false;
}

export function isPattern(value) {
  const string = String(value ?? '');
  return string.includes('*') || string.includes('?');
}
