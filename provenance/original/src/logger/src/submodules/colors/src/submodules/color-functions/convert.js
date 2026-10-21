"use strict";


// src/submodules/color-functions/convert.js

/**
 * Color space conversions, numerically stable and allocation‑light.
 * - sRGB <-> linear sRGB (IEC 61966-2-1)
 * - linear sRGB <-> OKLab / OKLCH (D65)
 * - sRGB <-> HSL
 */

function clamp01(x) {
  if (x !== x) return 0; // NaN -> 0
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function srgbCompToLinear(c) {
  return c <= 0.04045 ? (c / 12.92) : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearCompToSrgb(c) {
  return c <= 0.0031308 ? (12.92 * c) : (1.055 * Math.pow(c, 1/2.4) - 0.055);
}

function toLinearSRGB(c) {
  const r = srgbCompToLinear(clamp01(c.r));
  const g = srgbCompToLinear(clamp01(c.g));
  const b = srgbCompToLinear(clamp01(c.b));
  const a = c.a !== undefined ? clamp01(c.a) : 1;
  return { r, g, b, a };
}
function fromLinearSRGB(c) {
  const r = clamp01(linearCompToSrgb(c.r));
  const g = clamp01(linearCompToSrgb(c.g));
  const b = clamp01(linearCompToSrgb(c.b));
  const a = c.a !== undefined ? clamp01(c.a) : 1;
  return { r, g, b, a };
}

// OKLab matrices (Björn Ottosson, D65)
function cbrt(x) { return Math.cbrt !== undefined ? Math.cbrt(x) : Math.pow(x, 1/3); }

function linearToOKLab(c) {
  const lr = c.r, lg = c.g, lb = c.b;

  const l = 0.4122214708*lr + 0.5363325363*lg + 0.0514459929*lb;
  const m = 0.2119034982*lr + 0.6806995451*lg + 0.1073969566*lb;
  const s = 0.0883024619*lr + 0.2817188376*lg + 0.6299787005*lb;

  const l_ = cbrt(l);
  const m_ = cbrt(m);
  const s_ = cbrt(s);

  const L = 0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_;
  const a = 1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_;
  const b = 0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_;

  return { L, a, b, alpha: (c.a !== undefined ? c.a : 1) };
}

function okLabToLinear(lab) {
  const L = lab.L, a = lab.a, b = lab.b;

  const l_ = L + 0.3963377774*a + 0.2158037573*b;
  const m_ = L - 0.1055613458*a - 0.0638541728*b;
  const s_ = L - 0.0894841775*a - 1.2914855480*b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = +4.0767416621*l - 3.3077115913*m + 0.2309699292*s;
  const g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s;
  const b2 = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s;

  return { r, g, b: b2, a: (lab.alpha !== undefined ? clamp01(lab.alpha) : 1) };
}

function toOKLab(srgb) {
  const lin = toLinearSRGB(srgb);
  return linearToOKLab(lin);
}
function fromOKLab(lab) {
  const lin = okLabToLinear(lab);
  return fromLinearSRGB(lin);
}

function toOKLCH(srgb) {
  const lab = toOKLab(srgb);
  const a = lab.a, b = lab.b;
  let C = Math.sqrt(a*a + b*b);
  if (C < 1e-9) { return { L: lab.L, C: 0, h: 0, alpha: lab.alpha }; }
  let h = Math.atan2(b, a) * 180 / Math.PI;
  if (h < 0) h += 360;
  return { L: lab.L, C, h, alpha: lab.alpha };
}
function fromOKLCH(lch) {
  const L = lch.L;
  const C = (lch.C !== lch.C || lch.C < 0) ? 0 : lch.C; // guard NaN/neg
  const hRad = (lch.h % 360) * Math.PI / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  return fromOKLab({ L, a, b, alpha: (lch.alpha !== undefined ? lch.alpha : 1) });
}

// sRGB <-> HSL (compat)
function toHSL(c) {
  const r = clamp01(c.r), g = clamp01(c.g), b = clamp01(c.b);
  const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
  const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
  const d = max - min;
  let h = 0, s = 0, l = (max + min) * 0.5;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h >= 360) h -= 360;
  }
  return { h, s, l, a: (c.a !== undefined ? clamp01(c.a) : 1) };
}

function fromHSL(hsl) {
  const h = ((hsl.h % 360) + 360) % 360;
  const s = hsl.s < 0 ? 0 : (hsl.s > 1 ? 1 : hsl.s);
  const l = hsl.l < 0 ? 0 : (hsl.l > 1 ? 1 : hsl.l);
  const a = hsl.a !== undefined ? (hsl.a < 0 ? 0 : (hsl.a > 1 ? 1 : hsl.a)) : 1;

  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  }

  if (s === 0) {
    return { r: l, g: l, b: l, a };
  } else {
    const q = l < 0.5 ? l * (1 + s) : (l + s - l*s);
    const p = 2*l - q;
    const r = hue2rgb(p, q, (h / 360) + 1/3);
    const g = hue2rgb(p, q, (h / 360));
    const b = hue2rgb(p, q, (h / 360) - 1/3);
    return { r, g, b, a };
  }
}

export default {
  clamp01,
  toLinearSRGB, fromLinearSRGB,
  toOKLab, fromOKLab,
  toOKLCH, fromOKLCH,
  toHSL, fromHSL
};
export {
  clamp01,
  toLinearSRGB, fromLinearSRGB,
  toOKLab, fromOKLab,
  toOKLCH, fromOKLCH,
  toHSL, fromHSL
};
