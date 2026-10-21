'use strict';

export function createLogger(logger) {
  const target = logger && typeof logger === 'object' ? logger : console;
  const bind = (name, fallback = null) => {
    if (typeof target[name] === 'function') return target[name].bind(target);
    if (fallback && typeof target[fallback] === 'function') return target[fallback].bind(target);
    return () => {};
  };
  return Object.freeze({
    debug: bind('debug'),
    info: bind('info', 'log'),
    warn: bind('warn', 'log'),
    error: bind('error', 'log'),
  });
}
