"use strict";
import { toOKLab, fromOKLab, toOKLCH, fromOKLCH, toHSL, fromHSL, clamp01 } from "./convert.js";
import { parse } from "./parse.js";



// src/submodules/color-functions/palette.js
// moved import for { toOKLab, fromOKLab, toOKLCH, fromOKLCH, toHSL, fromHSL, clamp01 }

function lerp(a, b, t) { return a + (b - a) * t; }
function wrapHueShortest(h1, h2) {
  let d = ((h2 - h1 + 540) % 360) - 180;
  return h1 + d;
}

/**
 * Build a continuous color scale. Returns (t)=>SRGB
 * @param {Array} stops - colors in any accepted input format (strings/objects)
 * @param {Object} opts - { space:'oklch'|'oklab'|'hsl', easing?:(t)=>t, correctLightness?:boolean }
 */
function scale(stops, opts) {
 // moved import for { parse }
  const options = opts !== undefined ? opts : {};
  const space = options.space !== undefined ? options.space : "oklab";
  const easing = typeof options.easing === "function" ? options.easing : (t)=>t;
  const correctLightness = options.correctLightness === true;

  if (stops.length < 2) {
    throw new Error("scale() requires at least two stops");
  }

  // Precompute stops in requested space
  const S = new Array(stops.length);
  if (space === "oklab") {
    for (let i = 0; i < stops.length; i += 1) {
      const s = parse(stops[i]);
      const lab = toOKLab(s);
      S[i] = [lab.L, lab.a, lab.b, (s.a !== undefined ? s.a : 1)];
    }
  } else if (space === "oklch") {
    for (let i = 0; i < stops.length; i += 1) {
      const s = parse(stops[i]);
      const lch = toOKLCH(s);
      S[i] = [lch.L, lch.C, lch.h, (s.a !== undefined ? s.a : 1)];
    }
  } else { // "hsl"
    for (let i = 0; i < stops.length; i += 1) {
      const s = parse(stops[i]);
      const hsl = toHSL(s);
      S[i] = [hsl.h, hsl.s, hsl.l, (s.a !== undefined ? s.a : 1)];
    }
  }

  return function(tRaw) {
    let t = tRaw;
    if (t !== t) t = 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    t = easing(t);

    const seg = (S.length - 1) * t;
    const i = seg | 0;
    if (i >= S.length - 1) {
      // last stop
      if (space === "oklab") {
        const v = S[S.length - 1];
        return fromOKLab({ L: v[0], a: v[1], b: v[2], alpha: v[3] });
      } else if (space === "oklch") {
        const v = S[S.length - 1];
        return fromOKLCH({ L: v[0], C: v[1], h: v[2], alpha: v[3] });
      } else {
        const v = S[S.length - 1];
        return fromHSL({ h: v[0], s: v[1], l: v[2], a: v[3] });
      }
    }
    const localT = seg - i;
    const a = S[i], b = S[i+1];

    if (space === "oklab") {
      let L = lerp(a[0], b[0], localT);
      let A = lerp(a[1], b[1], localT);
      let B = lerp(a[2], b[2], localT);
      if (correctLightness === true) {
        // Small correction to maintain monotonic L*
        // (simple clamp between neighbors)
        const Lmin = a[0] < b[0] ? a[0] : b[0];
        const Lmax = a[0] > b[0] ? a[0] : b[0];
        if (L < Lmin) L = Lmin;
        if (L > Lmax) L = Lmax;
      }
      const alpha = lerp(a[3], b[3], localT);
      return fromOKLab({ L, a: A, b: B, alpha });
    } else if (space === "oklch") {
      const L = lerp(a[0], b[0], localT);
      const C = lerp(a[1], b[1], localT);
      const h1 = a[2];
      const h2 = wrapHueShortest(h1, b[2]);
      const h = (h1 + (h2 - h1) * localT) % 360;
      const alpha = lerp(a[3], b[3], localT);
      return fromOKLCH({ L, C, h, alpha });
    } else {
      // HSL shortest‑arc hue
      const h1 = a[0];
      const h2 = wrapHueShortest(h1, b[0]);
      const h = (h1 + (h2 - h1) * localT) % 360;
      const s = lerp(a[1], b[1], localT);
      const l = lerp(a[2], b[2], localT);
      const alpha = lerp(a[3], b[3], localT);
      return fromHSL({ h, s, l, a: alpha });
    }
  };
}

function discrete(stops, n, opts) {
  const f = scale(stops, opts);
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = f(n === 1 ? 0 : (i / (n - 1)));
  }
  return out;
}

function diverging(a, mid, b, n) {
  // equal splits for left/mid and mid/right
  const left = scale([a, mid], { space: "oklch", correctLightness: true });
  const right = scale([mid, b], { space: "oklch", correctLightness: true });
  const out = new Array(n);
  const half = (n - 1) / 2;
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    if (i <= half) {
      const tt = half === 0 ? 0 : (i / half);
      out[i] = left(tt);
    } else {
      const j = i - half;
      const denom = (n - 1 - half);
      const tt = denom === 0 ? 0 : (j / denom);
      out[i] = right(tt);
    }
  }
  return out;
}

export default { scale, discrete, diverging };
export { scale, discrete, diverging };
