'use strict';
import parse from "../parse/index.js";

// moved import for parse

// FIX: Added 'inverse' and 'hidden' to the EFFECTS constant
const EFFECTS = Object.freeze({
  bold:       { open: '1',  close: '22', key: 'bold' },
  dim:        { open: '2',  close: '22', key: 'dim' },
  italic:     { open: '3',  close: '23', key: 'italic' },
  underline:  { open: '4',  close: '24', key: 'underline' },
  strikethrough: { open: '9', close: '29', key: 'strikethrough' },
  inverse:    { open: '7',  close: '27', key: 'inverse' }, // ADDED
  hidden:     { open: '8',  close: '28', key: 'hidden' },   // ADDED
});

function _effectOp(name) {
  const e = EFFECTS[name];
  return {
    kind: 'effect',
    open: () => '\x1B[' + e.open + 'm',
    close: () => '\x1B[' + e.close + 'm',
    key: e.key,
    describe: () => ({ kind: 'effect', key: e.key, open: e.open, close: e.close })
  };
}

function _fgOp(colorSpec) {
  const col = colorSpec;
  return {
    kind: 'fg',
    data: col,
    open: (level, env) => env.degradeFG(level, col, env.metrics).open,
    close: (level, env) => env.degradeFG(level, col, env.metrics).close,
    describe: () => ({ kind: 'fg', rgb: { r: col.r|0, g: col.g|0, b: col.b|0 } })
  };
}

function _bgOp(colorSpec) {
  const col = colorSpec;
  return {
    kind: 'bg',
    data: col,
    open: (level, env) => env.degradeBG(level, col, env.metrics).open,
    close: (level, env) => env.degradeBG(level, col, env.metrics).close,
    describe: () => ({ kind: 'bg', rgb: { r: col.r|0, g: col.g|0, b: col.b|0 } })
  };
}

function _dedupReverse(closes) {
  const seen = new Set();
  const out = [];
  for (let i = closes.length - 1; i >= 0; i -= 1) {
    const c = closes[i];
    if (seen.has(c) === false) {
      out.push(c);
      seen.add(c);
    }
  }
  return out.join('');
}

function _attachGetters(fn, env, pipeline) {
  // effect getters
  Object.defineProperties(fn, {
    bold: { get() { return _extend(env, pipeline, _effectOp('bold')); }, enumerable: true },
    dim: { get() { return _extend(env, pipeline, _effectOp('dim')); }, enumerable: true },
    italic: { get() { return _extend(env, pipeline, _effectOp('italic')); }, enumerable: true },
    underline: { get() { return _extend(env, pipeline, _effectOp('underline')); }, enumerable: true },
    strikethrough: { get() { return _extend(env, pipeline, _effectOp('strikethrough')); }, enumerable: true },
    inverse: { get() { return _extend(env, pipeline, _effectOp('inverse')); }, enumerable: true }, // ADDED
    hidden: { get() { return _extend(env, pipeline, _effectOp('hidden')); }, enumerable: true },     // ADDED

    red: { get() { return _extend(env, pipeline, _fgOp(parse.parseColor('red'))); }, enumerable: true },
    green: { get() { return _extend(env, pipeline, _fgOp(parse.parseColor('green'))); }, enumerable: true },
    yellow: { get() { return _extend(env, pipeline, _fgOp(parse.parseColor('yellow'))); }, enumerable: true },
    blue: { get() { return _extend(env, pipeline, _fgOp(parse.parseColor('blue'))); }, enumerable: true },
    magenta: { get() { return _extend(env, pipeline, _fgOp(parse.parseColor('magenta'))); }, enumerable: true },
    cyan: { get() { return _extend(env, pipeline, _fgOp(parse.parseColor('cyan'))); }, enumerable: true },
    white: { get() { return _extend(env, pipeline, _fgOp(parse.parseColor('white'))); }, enumerable: true },
    black: { get() { return _extend(env, pipeline, _fgOp(parse.parseColor('black'))); }, enumerable: true },

    fg: { value: (c) => _extend(env, pipeline, _fgOp(env.parseColor(c))), enumerable: true },
    bg: { value: (c) => _extend(env, pipeline, _bgOp(env.parseColor(c))), enumerable: true },

    apply: { value: (s, options) => fn(s, options), enumerable: true },

    __rnc: { value: { pipeline }, enumerable: false }
  });
}

function _extend(env, pipeline, op) {
  const next = pipeline.slice(0);
  next.push(op);
  return _make(env, next);
}

function _make(env, pipeline) {
  const applier = function(str, options) {
    const input = env.sanitize(String(str));
    const lvl = env.getLevel(options && Object.prototype.hasOwnProperty.call(options, 'forceLevel') ? options.forceLevel : undefined);
    if (lvl === 0) { return input; }

    const opens = [];
    const closes = [];
    for (let i = 0; i < pipeline.length; i += 1) {
      const op = pipeline[i];
      if (op.kind === 'effect') {
        opens.push(op.open());
        closes.push(op.close());
      } else if (op.kind === 'fg') {
        opens.push(op.open(lvl, env));
        closes.push(op.close(lvl, env));
      } else if (op.kind === 'bg') {
        opens.push(op.open(lvl, env));
        closes.push(op.close(lvl, env));
      }
    }

    if (typeof env.hooks._hooks.beforeStyle === 'function') {
      try { env.hooks._hooks.beforeStyle(input, { level: lvl, pipeline }); } catch (_e) { /* noop */ }
    }

    const out = opens.join('') + input + _dedupReverse(closes);
    env.metrics.colors_apply_total += 1;

    if (typeof env.hooks._hooks.afterStyle === 'function') {
      try { env.hooks._hooks.afterStyle(out, { level: lvl, pipeline }); } catch (_e) { /* noop */ }
    }
    return out;
  };
  _attachGetters(applier, env, pipeline);
  return applier;
}

function createStyleRoot(env) {
  return _make(env, []);
}

export default { createStyleRoot };
export { createStyleRoot };
