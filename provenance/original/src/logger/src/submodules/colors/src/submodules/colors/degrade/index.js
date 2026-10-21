'use strict';

// --- 256-color mapping ---
function _toAnsi256(r, g, b) {
  // Compute nearest in 6x6x6 cube
  const to6 = (v) => Math.round((v / 255) * 5);
  const ir = to6(r), ig = to6(g), ib = to6(b);
  const cubeIndex = 16 + 36*ir + 6*ig + ib;

  // Grayscale range [232..255]
  const avg = (r + g + b) / 3;
  const grayIndex = 232 + Math.round(((avg / 255) * 23));

  // pick closer by Euclidean distance
  const cr = [0,95,135,175,215,255][ir];
  const cg = [0,95,135,175,215,255][ig];
  const cb = [0,95,135,175,215,255][ib];
  const dc = (cr-r)*(cr-r) + (cg-g)*(cg-g) + (cb-b)*(cb-b);
  const gv = 8 + 10 * (grayIndex - 232);
  const dg = 3*(gv - avg)*(gv - avg);
  return (dg < dc) ? grayIndex : cubeIndex;
}

// --- 16-color mapping ---
const ANSI16 = [
  [0,0,0], [128,0,0], [0,128,0], [128,128,0], [0,0,128], [128,0,128], [0,128,128], [192,192,192],
  [128,128,128], [255,0,0], [0,255,0], [255,255,0], [0,0,255], [255,0,255], [0,255,255], [255,255,255]
];

function _nearestAnsi16(r, g, b) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < 16; i += 1) {
    const c = ANSI16[i];
    const d = (c[0]-r)*(c[0]-r) + (c[1]-g)*(c[1]-g) + (c[2]-b)*(c[2]-b);
    if (d < bestD) { bestD = d; best = i; }
  }
  // Map 0..15 -> SGR 30..37 (0..7) and 90..97 (8..15)
  if (best < 8) { return { base: 30 + best, bright: false }; }
  return { base: 90 + (best - 8), bright: true };
}

// Returns "38;2;r;g;b" | "38;5;idx" | "30..37/90..97"
function _sgrFG(level, r, g, b, metrics) {
  if (level === 3) { return '38;2;' + r + ';' + g + ';' + b; }
  if (level === 2) { return '38;5;' + _toAnsi256(r, g, b); }
  const m = _nearestAnsi16(r, g, b);
  return String(m.base);
}
function _sgrBG(level, r, g, b, metrics) {
  if (level === 3) { return '48;2;' + r + ';' + g + ';' + b; }
  if (level === 2) { return '48;5;' + _toAnsi256(r, g, b); }
  const m = _nearestAnsi16(r, g, b);
  // BG: 40..47/100..107
  const idx = parseInt(String(m.base), 10);
  if (idx >= 90) { return String(100 + (idx - 90)); }
  return String(40 + (idx - 30));
}

function sgrForFG(level, rgb, metrics) {
  const s = _sgrFG(level, rgb.r|0, rgb.g|0, rgb.b|0, metrics);
  return { open: '\x1B[' + s + 'm', close: '\x1B[39m', describe: () => ({ kind: 'fg', level, s }) };
}

function sgrForBG(level, rgb, metrics) {
  const s = _sgrBG(level, rgb.r|0, rgb.g|0, rgb.b|0, metrics);
  return { open: '\x1B[' + s + 'm', close: '\x1B[49m', describe: () => ({ kind: 'bg', level, s }) };
}

export default { sgrForFG, sgrForBG };
export { sgrForFG, sgrForBG };
