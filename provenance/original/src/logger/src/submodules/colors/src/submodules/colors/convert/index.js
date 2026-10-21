'use strict';

// sRGB <-> linear
function _toLinear(c) { const v = c / 255; return v <= 0.04045 ? (v / 12.92) : Math.pow((v + 0.055) / 1.055, 2.4); }
function _toGamma(v) { return v <= 0.0031308 ? (v * 12.92) : (1.055 * Math.pow(v, 1 / 2.4) - 0.055); }

function rgbToHsl({ r, g, b, a }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case R: h = (G - B) / d + (G < B ? 6 : 0); break;
      case G: h = (B - R) / d + 2; break;
      default: h = (R - G) / d + 4; break;
    }
    h *= 60;
  }
  return { space: 'hsl', h, s, l, a: a === undefined ? 1 : a };
}

function hslToRgb({ h, s, l, a }) {
  const C = (1 - Math.abs(2*l - 1)) * s;
  const Hp = (h % 360) / 60;
  const X = C * (1 - Math.abs((Hp % 2) - 1));
  let R = 0, G = 0, B = 0;
  if (Hp >= 0 && Hp < 1) { R=C; G=X; B=0; }
  else if (Hp < 2) { R=X; G=C; B=0; }
  else if (Hp < 3) { R=0; G=C; B=X; }
  else if (Hp < 4) { R=0; G=X; B=C; }
  else if (Hp < 5) { R=X; G=0; B=C; }
  else { R=C; G=0; B=X; }
  const m = l - C/2;
  const r = Math.round((R + m) * 255);
  const g = Math.round((G + m) * 255);
  const b = Math.round((B + m) * 255);
  return { space: 'rgb', r, g, b, a: a === undefined ? 1 : a };
}

// OKLab/OKLCH (D65) based on published spec constants
function rgbToOklab({ r, g, b, a }) {
  // to linear sRGB
  const rl = _toLinear(r), gl = _toLinear(g), bl = _toLinear(b);
  // linear RGB to LMS
  const l = 0.4122214708*rl + 0.5363325363*gl + 0.0514459929*bl;
  const m = 0.2119034982*rl + 0.6806995451*gl + 0.1073969566*bl;
  const s = 0.0883024619*rl + 0.2817188376*gl + 0.6299787005*bl;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  const L = 0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_;
  const a_ = 1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_;
  const b_ = 0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_;
  return { space: 'oklab', L, a: a_, b: b_, alpha: a === undefined ? 1 : a };
}

function oklabToRgb({ L, a, b, alpha }) {
  const l_ = Math.pow(L + 0.3963377774*a + 0.2158037573*b, 3);
  const m_ = Math.pow(L - 0.1055613458*a - 0.0638541728*b, 3);
  const s_ = Math.pow(L - 0.0894841775*a - 1.2914855480*b, 3);

  let rl = +4.0767416621*l_ - 3.3077115913*m_ + 0.2309699292*s_;
  let gl = -1.2684380046*l_ + 2.6097574011*m_ - 0.3413193965*s_;
  let bl = -0.0041960863*l_ - 0.7034186147*m_ + 1.7076147010*s_;

  rl = Math.max(0, Math.min(1, rl));
  gl = Math.max(0, Math.min(1, gl));
  bl = Math.max(0, Math.min(1, bl));

  return {
    space: 'rgb',
    r: Math.round(_toGamma(rl) * 255),
    g: Math.round(_toGamma(gl) * 255),
    b: Math.round(_toGamma(bl) * 255),
    a: alpha === undefined ? 1 : alpha
  };
}

function oklabToOklch({ L, a, b, alpha }) {
  const C = Math.sqrt(a*a + b*b);
  let H = Math.atan2(b, a) * 180 / Math.PI;
  if (H < 0) { H += 360; }
  return { space: 'oklch', L, C, H, alpha: alpha === undefined ? 1 : alpha };
}

function oklchToOklab({ L, C, H, alpha }) {
  const hrad = (H * Math.PI) / 180;
  return { space: 'oklab', L, a: C * Math.cos(hrad), b: C * Math.sin(hrad), alpha: alpha === undefined ? 1 : alpha };
}

function to(space, color) {
  const target = String(space).toLowerCase();
  if (color.space === target) { return color; }
  if (target === 'rgb') {
    if (color.space === 'rgb') { return color; }
    if (color.space === 'hsl') { return hslToRgb(color); }
    if (color.space === 'oklab') { return oklabToRgb(color); }
    if (color.space === 'oklch') { return oklabToRgb(oklchToOklab(color)); }
  }
  if (target === 'hsl') {
    const rgb = to('rgb', color);
    return rgbToHsl(rgb);
  }
  if (target === 'oklab') {
    const rgb = to('rgb', color);
    return rgbToOklab(rgb);
  }
  if (target === 'oklch') {
    const ol = to('oklab', color);
    return oklabToOklch(ol);
  }
  return color;
}

function _clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

function mix(a, b, t) {
  // gamma-correct mix in linear sRGB
  const A = to('rgb', a), B = to('rgb', b);
  const ar = _toLinear(A.r), ag = _toLinear(A.g), ab = _toLinear(A.b);
  const br = _toLinear(B.r), bg = _toLinear(B.g), bb = _toLinear(B.b);
  const tr = ar + (br - ar) * t;
  const tg = ag + (bg - ag) * t;
  const tb = ab + (bb - ab) * t;
  return { space: 'rgb', r: Math.round(_toGamma(_clamp01(tr)) * 255), g: Math.round(_toGamma(_clamp01(tg)) * 255), b: Math.round(_toGamma(_clamp01(tb)) * 255), a: 1 };
}

function luminance(color) {
  const c = to('rgb', color);
  const rl = _toLinear(c.r), gl = _toLinear(c.g), bl = _toLinear(c.b);
  return 0.2126*rl + 0.7152*gl + 0.0722*bl;
}

function contrast(a, b) {
  const L1 = luminance(a);
  const L2 = luminance(b);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

function chooseOn(bg, opts) {
  const min = opts && typeof opts.min === 'number' ? opts.min : 4.5;
  const black = { space: 'rgb', r: 0, g: 0, b: 0, a: 1 };
  const white = { space: 'rgb', r: 255, g: 255, b: 255, a: 1 };
  const cB = contrast(bg, black);
  const cW = contrast(bg, white);
  if (cB >= min && cB >= cW) { return black; }
  if (cW >= min && cW >= cB) { return white; }
  // pick better anyway
  return cW >= cB ? white : black;
}

export default { to, mix, contrast, chooseOn, rgbToHsl, hslToRgb };
export { to, mix, contrast, chooseOn, rgbToHsl, hslToRgb };
