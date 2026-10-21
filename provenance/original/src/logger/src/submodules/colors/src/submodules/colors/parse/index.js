'use strict';
import conv from "../convert/index.js";

// moved import for conv

const NAMED = Object.freeze({
  black: [0,0,0], white: [255,255,255], red: [255,0,0], green: [0,128,0], blue: [0,0,255],
  yellow: [255,255,0], magenta: [255,0,255], cyan: [0,255,255],
  gray: [128,128,128], grey: [128,128,128], navy: [0,0,128], orange: [255,165,0], tomato: [255,99,71]
  // TODO: expand to full CSS named table if needed
});

function _hex(n) {
  if (n.length === 3) {
    const r = parseInt(n[0]+n[0], 16);
    const g = parseInt(n[1]+n[1], 16);
    const b = parseInt(n[2]+n[2], 16);
    return { space: 'rgb', r, g, b, a: 1 };
  }
  const r = parseInt(n.slice(0,2), 16);
  const g = parseInt(n.slice(2,4), 16);
  const b = parseInt(n.slice(4,6), 16);
  return { space: 'rgb', r, g, b, a: 1 };
}

function parseColor(input) {
  if (Array.isArray(input) === true && input.length >= 3) {
    return { space: 'rgb', r: input[0]|0, g: input[1]|0, b: input[2]|0, a: 1 };
  }
  const s = String(input).trim();
  if (s[0] === '#') {
    const n = s.slice(1);
    if (n.length === 3 || n.length === 6) { return _hex(n); }
  }
  if (s.startsWith('rgb')) {
    const m = s.match(/rgba?\(([^)]+)\)/i);
    if (m && m[1]) {
      const parts = m[1].split(',').map(x => x.trim());
      const r = parseFloat(parts[0]), g = parseFloat(parts[1]), b = parseFloat(parts[2]);
      const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
      return { space: 'rgb', r: r|0, g: g|0, b: b|0, a };
    }
  }
  if (s.startsWith('hsl')) {
    const m = s.match(/hsla?\(([^)]+)\)/i);
    if (m && m[1]) {
      const parts = m[1].split(',').map(x => x.trim());
      const h = parseFloat(parts[0]);
      const sP = parseFloat(parts[1]) / 100;
      const lP = parseFloat(parts[2]) / 100;
      const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
      return conv.hslToRgb({ space: 'hsl', h, s: sP, l: lP, a });
    }
  }
  const lower = s.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED, lower) === true) {
    const [r, g, b] = NAMED[lower];
    return { space: 'rgb', r, g, b, a: 1 };
  }
  // Fallback: black
  return { space: 'rgb', r: 0, g: 0, b: 0, a: 1 };
}

export default { parseColor, NAMED };
export { parseColor, NAMED };
