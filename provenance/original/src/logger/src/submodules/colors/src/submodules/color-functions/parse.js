"use strict";
import { CSS } from "./tables.js";
import { ColorParseError } from "./errors.js";
import { fromHSL } from "./convert.js";
import { fromOKLab } from "./convert.js";
import { fromOKLCH } from "./convert.js";



// src/submodules/color-functions/parse.js
// moved import for { CSS }// moved import for { ColorParseError }

/**
 * Parse input into sRGB (0..1 floats) with alpha 0..1.
 * Accepts: strings (#rgb/#rgba/#rrggbb/#rrggbbaa, rgb/rgba(), hsl/hsla(), oklab(), oklch(), named),
 *          or objects {r,g,b,a} 0..1 or 0..255, {h,s,l,a}, {L,a,b,alpha}, {L,C,h,alpha}
 */
function clamp01(x) {
  if (x !== x) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function parseHex2(s, i) {
  const x = parseInt(s.slice(i, i+2), 16);
  if (x !== x) return 0;
  return x;
}
function parseHex1(s, i) {
  const ch = s[i];
  const x = parseInt(ch + ch, 16);
  if (x !== x) return 0;
  return x;
}

function srgb255(r,g,b,a) {
  return { r: r/255, g: g/255, b: b/255, a: (a !== undefined ? a : 1) };
}

function parseNumberOrPercent(tok) {
  // "12.3" or "12.3%" => return [value0..1, isPercent]
  const t = tok.trim();
  const pct = t.endsWith("%");
  const n = pct === true ? parseFloat(t.slice(0, -1)) : parseFloat(t);
  if (n !== n) return [0, pct];
  if (pct === true) return [n / 100, true];
  return [n, false];
}

function parseFuncArgs(body) {
  // split by commas or spaces (flexible)
  // Avoid heavy regex; simple state machine:
  const out = [];
  let acc = "";
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === "," || c === " " || c === "\t") {
      if (acc.length > 0) { out.push(acc); acc = ""; }
      continue;
    }
    acc += c;
  }
  if (acc.length > 0) out.push(acc);
  return out;
}

function parse(strOrObj) {
  // Objects
  if (typeof strOrObj === "object" && strOrObj !== null) {
    // Heuristics: interpret ranges defensively
    if (strOrObj.r !== undefined && strOrObj.g !== undefined && strOrObj.b !== undefined) {
      // detect 0..255 ints vs 0..1 floats
      const r = strOrObj.r; const g = strOrObj.g; const b = strOrObj.b;
      const a = strOrObj.a !== undefined ? strOrObj.a : (strOrObj.alpha !== undefined ? strOrObj.alpha : 1);
      if (r > 1 || g > 1 || b > 1) { return srgb255(r|0, g|0, b|0, clamp01(a)); }
      return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: clamp01(a) };
    }
    if (strOrObj.h !== undefined && strOrObj.s !== undefined && strOrObj.l !== undefined) {
     // moved import for { fromHSL }
      return fromHSL({ h: (strOrObj.h|0), s: clamp01(strOrObj.s), l: clamp01(strOrObj.l), a: clamp01(strOrObj.a !== undefined ? strOrObj.a : 1) });
    }
    if (strOrObj.L !== undefined && strOrObj.a !== undefined && strOrObj.b !== undefined) {
     // moved import for { fromOKLab }
      return fromOKLab({ L: clamp01(strOrObj.L), a: +strOrObj.a, b: +strOrObj.b, alpha: clamp01(strOrObj.alpha !== undefined ? strOrObj.alpha : 1) });
    }
    if (strOrObj.L !== undefined && strOrObj.C !== undefined && strOrObj.h !== undefined) {
     // moved import for { fromOKLCH }
      const h = ((+strOrObj.h) % 360 + 360) % 360;
      return fromOKLCH({ L: clamp01(strOrObj.L), C: Math.max(0, +strOrObj.C), h, alpha: clamp01(strOrObj.alpha !== undefined ? strOrObj.alpha : 1) });
    }
    throw new ColorParseError("Unsupported color object shape", strOrObj);
  }

  // Strings
  if (typeof strOrObj !== "string") {
    throw new ColorParseError("Expected color string or object", String(strOrObj));
  }
  const raw = strOrObj.trim().toLowerCase();

  // named
  if (CSS[raw] !== undefined) {
    return parse(CSS[raw]);
  }

  // hex forms
  if (raw[0] === "#") {
    const s = raw.slice(1);
    // #rgb / #rgba
    if (s.length === 3 || s.length === 4) {
      const r = parseHex1(s, 0);
      const g = parseHex1(s, 1);
      const b = parseHex1(s, 2);
      const a = (s.length === 4 ? parseHex1(s, 3)/255 : 1);
      return srgb255(r,g,b,a);
    }
    // #rrggbb / #rrggbbaa
    if (s.length === 6 || s.length === 8) {
      const r = parseHex2(s, 0);
      const g = parseHex2(s, 2);
      const b = parseHex2(s, 4);
      const a = (s.length === 8 ? parseHex2(s, 6)/255 : 1);
      return srgb255(r,g,b,a);
    }
    throw new ColorParseError("Invalid hex color", raw);
  }

  // functional
  // rgb/rgba
  if (raw.startsWith("rgb(") || raw.startsWith("rgba(")) {
    const body = raw.slice(raw.indexOf("(")+1, raw.lastIndexOf(")"));
    const parts = parseFuncArgs(body);
    if (parts.length < 3) throw new ColorParseError("Invalid rgb/rgba()", raw);
    let [r,pr] = parseNumberOrPercent(parts[0]);
    let [g,pg] = parseNumberOrPercent(parts[1]);
    let [b,pb] = parseNumberOrPercent(parts[2]);
    if (pr === false) r = r/255;
    if (pg === false) g = g/255;
    if (pb === false) b = b/255;
    const a = parts[3] !== undefined ? clamp01(parseFloat(parts[3])) : 1;
    return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a };
  }

  // hsl/hsla
  if (raw.startsWith("hsl(") || raw.startsWith("hsla(")) {
   // moved import for { fromHSL }
    const body = raw.slice(raw.indexOf("(")+1, raw.lastIndexOf(")"));
    const parts = parseFuncArgs(body);
    if (parts.length < 3) throw new ColorParseError("Invalid hsl/hsla()", raw);
    const h = parseFloat(parts[0]);
    const [s,_ps] = parseNumberOrPercent(parts[1]);
    const [l,_pl] = parseNumberOrPercent(parts[2]);
    const a = parts[3] !== undefined ? clamp01(parseFloat(parts[3])) : 1;
    return fromHSL({ h, s: clamp01(s), l: clamp01(l), a });
  }

  // oklab()
  if (raw.startsWith("oklab(")) {
   // moved import for { fromOKLab }
    const body = raw.slice(6, raw.lastIndexOf(")"));
    const p = parseFuncArgs(body);
    if (p.length < 3) throw new ColorParseError("Invalid oklab()", raw);
    const L = clamp01(parseFloat(p[0]));
    const a = parseFloat(p[1]);
    const b = parseFloat(p[2]);
    const alpha = p[3] !== undefined ? clamp01(parseFloat(p[3])) : 1;
    return fromOKLab({ L, a, b, alpha });
  }

  // oklch()
  if (raw.startsWith("oklch(")) {
   // moved import for { fromOKLCH }
    const body = raw.slice(6, raw.lastIndexOf(")"));
    const p = parseFuncArgs(body);
    if (p.length < 3) throw new ColorParseError("Invalid oklch()", raw);
    const L = clamp01(parseFloat(p[0]));
    const C = Math.max(0, parseFloat(p[1]));
    let h = parseFloat(p[2]);
    if (h !== h) h = 0;
    if (h < 0) h = (h % 360) + 360;
    if (h >= 360) h = h % 360;
    const alpha = p[3] !== undefined ? clamp01(parseFloat(p[3])) : 1;
    return fromOKLCH({ L, C, h, alpha });
  }

  throw new ColorParseError("Unrecognized color format", raw);
}

export default { parse };
export  { parse };
