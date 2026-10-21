"use strict";
import { parse } from "./parse.js";
import { CSS, ANSI16, ANSI256 } from "./tables.js";
import { clamp01, toLinearSRGB, fromLinearSRGB, toOKLab, fromOKLab, toOKLCH, fromOKLCH, toHSL, fromHSL } from "./convert.js";
import { scale, discrete, diverging } from "./palette.js";
import { hooks, use, run, setPublicApi } from "./hooks.js";
import { ColorRangeError } from "./errors.js";


// src/submodules/color-functions/fns.js

// ------------------------------ Public API ----------------------------------

/**
 * colorFunctions: pure color math & utilities
 * Exports the public API described in the spec. No external deps.
 */
// moved import for { parse }// moved import for { CSS, ANSI16, ANSI256 }// moved import for { clamp01, toLinearSRGB, fromLinearSRGB, toOKLab, fromOKLab, toOKLCH, fromOKLCH, toHSL, fromHSL }// moved import for { scale, discrete, diverging }// moved import for { hooks, use, run, setPublicApi }// moved import for { ColorRangeError }

// ------------------------- Observability (cheap) -----------------------------

const __stats = {
    parseCalls: 0,
    convertCalls: 0,
    mixCalls: 0,
    paletteBytes: 0,
    ansiMapHits: 0,
    ansiMapMisses: 0,
};

// --------------------------- Helpers (internal) ------------------------------

function clampSRGB01(c) {
    // clamp and normalize alpha
    const r = clamp01(c.r);
    const g = clamp01(c.g);
    const b = clamp01(c.b);
    const a = c.a !== undefined ? clamp01(c.a) : 1;
    return { r, g, b, a };
}

function toSRGB(color) {
    run("beforeParse", [color]);
    const c = typeof color === "string" || (typeof color === "object" && color !== null) ? parse(color) : parse(String(color));
    run("afterParse", [c]);
    __stats.parseCalls += 1;
    return clampSRGB01(c);
}

function stringify(color, fmt) {
    run("beforeSerialize", [fmt, color]);
    const c = toSRGB(color);
    let out = "";
    if (fmt === "hex") {
        const r = (Math.round(c.r * 255) & 255).toString(16).padStart(2, "0");
        const g = (Math.round(c.g * 255) & 255).toString(16).padStart(2, "0");
        const b = (Math.round(c.b * 255) & 255).toString(16).padStart(2, "0");
        out = `#${r}${g}${b}`;
    } else if (fmt === "rgb") {
        const r = Math.round(c.r * 255);
        const g = Math.round(c.g * 255);
        const b = Math.round(c.b * 255);
        out = `rgb(${r} ${g} ${b})`;
    } else if (fmt === "rgba") {
        const r = Math.round(c.r * 255);
        const g = Math.round(c.g * 255);
        const b = Math.round(c.b * 255);
        out = `rgba(${r} ${g} ${b} / ${c.a.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")})`;
    } else if (fmt === "hsl") {
        const hsl = toHSL(c);
        __stats.convertCalls += 1;
        out = `hsl(${hsl.h | 0} ${Math.round(hsl.s * 100)}% ${Math.round(hsl.l * 100)}%)`;
    } else if (fmt === "oklab") {
        const lab = toOKLab(c);
        __stats.convertCalls += 1;
        out = `oklab(${num(lab.L, 3)} ${num(lab.a, 4)} ${num(lab.b, 4)}${alphaStr(lab.alpha)})`;
    } else if (fmt === "oklch") {
        const lch = toOKLCH(c);
        __stats.convertCalls += 1;
        out = `oklch(${num(lch.L, 3)} ${num(lch.C, 4)} ${num(((lch.h % 360) + 360) % 360, 2)}${alphaStr(lch.alpha)})`;
    } else {
        out = "[object Object]";
    }
    run("afterSerialize", [fmt, out]);
    return out;
}
function num(x, p) {
    // avoid "-0" and keep compact
    const s = x.toFixed(p);
    return s === "-0.000" || s === "-0.00" || s === "-0.0" || s === "-0" ? "0" : s;
}
function alphaStr(a) {
    const aa = a !== undefined ? clamp01(a) : 1;
    return aa < 1 ? ` / ${num(aa, 3)}` : "";
}

// ------------------------------- Edits --------------------------------------

function toOKLCHSafe(color) {
    const s = toSRGB(color);
    const lch = toOKLCH(s);
    __stats.convertCalls += 1;
    return lch;
}
function fromOKLCHClamped(lch) {
    if (lch.C !== lch.C || lch.C < 0) lch.C = 0;
    lch.h = ((lch.h % 360) + 360) % 360;
    const srgb = fromOKLCH(lch);
    __stats.convertCalls += 1;
    return clampSRGB01(srgb);
}

function lighten(color, by) {
    const lch = toOKLCHSafe(color);
    const amt = by !== by ? 0 : by; // NaN -> 0
    lch.L = clamp01(lch.L + amt);
    return fromOKLCHClamped(lch);
}
function darken(color, by) {
    return lighten(color, -by);
}

function saturate(color, by) {
    const lch = toOKLCHSafe(color);
    const amt = by !== by ? 0 : by;
    lch.C = Math.max(0, lch.C + amt);
    return fromOKLCHClamped(lch);
}
function desaturate(color, by) {
    return saturate(color, -by);
}

function rotateHue(color, deg) {
    const lch = toOKLCHSafe(color);
    const d = deg !== deg ? 0 : deg;
    let h = lch.h + d;
    h = ((h % 360) + 360) % 360;
    lch.h = h;
    return fromOKLCHClamped(lch);
}
function alpha(color, a) {
    const c = toSRGB(color);
    const aa = a !== a ? 1 : a < 0 ? 0 : a > 1 ? 1 : a;
    return { r: c.r, g: c.g, b: c.b, a: aa };
}
function clamp(c) {
    return clampSRGB01(toSRGB(c));
}

// ------------------------- Mixing & compositing -----------------------------

function mix(aColor, bColor, t, mode) {
    run("beforeMix", [mode, aColor, bColor, t]);
    let tt = t !== t ? 0 : t;
    if (tt < 0) tt = 0;
    if (tt > 1) tt = 1;

    const A = toSRGB(aColor);
    const B = toSRGB(bColor);

    const m = mode !== undefined ? mode : "oklab";
    let out;
    if (m === "linear") {
        // gamma‑correct mixing in linear sRGB
        const la = toLinearSRGB(A);
        const lb = toLinearSRGB(B);
        __stats.convertCalls += 2;
        const r = la.r + (lb.r - la.r) * tt;
        const g = la.g + (lb.g - la.g) * tt;
        const b = la.b + (lb.b - la.b) * tt;
        const a = A.a + (B.a - A.a) * tt;
        out = fromLinearSRGB({ r, g, b, a });
        __stats.convertCalls += 1;
    } else if (m === "lch") {
        const la = toOKLCH(A),
            lb = toOKLCH(B);
        __stats.convertCalls += 2;
        const L = la.L + (lb.L - la.L) * tt;
        const C = la.C + (lb.C - la.C) * tt;
        // shortest‑arc hue
        const h2 = (function (h1, hB) {
            let d = ((hB - h1 + 540) % 360) - 180;
            return h1 + d;
        })(la.h, lb.h);
        const h = (la.h + (h2 - la.h) * tt) % 360;
        const a = A.a + (B.a - A.a) * tt;
        out = fromOKLCH({ L, C: Math.max(0, C), h, alpha: a });
        __stats.convertCalls += 1;
    } else {
        // default "oklab": lerp L,a,b
        const la = toOKLab(A),
            lb = toOKLab(B);
        __stats.convertCalls += 2;
        const L = la.L + (lb.L - la.L) * tt;
        const aa = la.a + (lb.a - la.a) * tt;
        const bb = la.b + (lb.b - la.b) * tt;
        const a = A.a + (B.a - A.a) * tt;
        out = fromOKLab({ L, a: aa, b: bb, alpha: a });
        __stats.convertCalls += 1;
    }

    __stats.mixCalls += 1;
    run("afterMix", [mode, out]);
    return clampSRGB01(out);
}

function premultiply(cIn) {
    const c = toSRGB(cIn);
    const a = c.a;
    return { r: c.r * a, g: c.g * a, b: c.b * a, a };
}
function unpremultiply(cIn) {
    const c = toSRGB(cIn);
    const a = c.a;
    if (a <= 1e-6) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: c.r / a, g: c.g / a, b: c.b / a, a };
}
function composite(srcIn, dstIn) {
    const s = toSRGB(srcIn);
    const d = toSRGB(dstIn);
    const as = s.a,
        ad = d.a;
    const outA = as + ad * (1 - as);
    if (outA <= 1e-8) return { r: 0, g: 0, b: 0, a: 0 };
    const outR = (s.r * as + d.r * ad * (1 - as)) / outA;
    const outG = (s.g * as + d.g * ad * (1 - as)) / outA;
    const outB = (s.b * as + d.b * ad * (1 - as)) / outA;
    return { r: clamp01(outR), g: clamp01(outG), b: clamp01(outB), a: clamp01(outA) };
}

// ------------------------- Contrast & accessibility -------------------------

function luminance(cIn) {
    const c = toSRGB(cIn);
    const lin = toLinearSRGB(c);
    __stats.convertCalls += 1;
    // Relative luminance per WCAG (Y)
    const Y = 0.2126 * lin.r + 0.7152 * lin.g + 0.0722 * lin.b;
    return Y < 0 ? 0 : Y > 1 ? 1 : Y;
}

function contrastWcag(a, b) {
    const L1 = luminance(a);
    const L2 = luminance(b);
    const hi = L1 > L2 ? L1 : L2;
    const lo = L1 > L2 ? L2 : L1;
    return (hi + 0.05) / (lo + 0.05);
}

function chooseOn(bg, opts) {
    const options = opts !== undefined ? opts : {};
    const min = options.min !== undefined ? options.min : 4.5;
    const light = options.light !== undefined ? options.light : "#ffffff";
    const dark = options.dark !== undefined ? options.dark : "#000000";
    const rLight = contrastWcag(bg, light);
    const rDark = contrastWcag(bg, dark);
    if (rLight >= min && rLight >= rDark) return { fg: toSRGB(light), ratio: rLight };
    if (rDark >= min) return { fg: toSRGB(dark), ratio: rDark };
    // If both fail, pick the better one
    return rLight >= rDark ? { fg: toSRGB(light), ratio: rLight } : { fg: toSRGB(dark), ratio: rDark };
}

// ------------------------------ Palettes ------------------------------------

function scalePublic(stops, opts) {
    return scale(stops, opts);
}
function discretePublic(stops, n, opts) {
    const out = discrete(stops, n, opts);
    // Approx memory: n * (4 comps * 8 bytes) ~ informally tracked
    __stats.paletteBytes += n * 4 * 8;
    return out;
}
function divergingPublic(a, mid, b, n) {
    return diverging(a, mid, b, n);
}

// ------------------------------ ANSI mapping --------------------------------

const _ansi256Lab = (function precompute() {
    // Precompute OKLab for all ANSI256 entries
    const arr = new Array(256);
    for (let i = 0; i < 256; i += 1) {
        const rgb255 = ANSI256[i];
        const srgb = { r: rgb255[0] / 255, g: rgb255[1] / 255, b: rgb255[2] / 255, a: 1 };
        arr[i] = toOKLab(srgb);
    }
    return arr;
})();

// tiny LUT: 3 bits per channel -> 512 buckets
const _lut256 = Object.create(null);

function nearestAnsi256(cIn) {
    const c = toSRGB(cIn);
    // LUT key
    const kr = (c.r * 7 + 0.5) | 0;
    const kg = (c.g * 7 + 0.5) | 0;
    const kb = (c.b * 7 + 0.5) | 0;
    const key = ((kr << 6) | (kg << 3) | kb) >>> 0;
    const cached = _lut256[key];
    if (cached !== undefined) {
        __stats.ansiMapHits += 1;
        return cached;
    }
    __stats.ansiMapMisses += 1;

    const lab = toOKLab(c);
    let bestI = 0;
    let bestD = 1e9;

    for (let i = 0; i < 256; i += 1) {
        const L = _ansi256Lab[i];
        const dL = lab.L - L.L;
        const da = lab.a - L.a;
        const db = lab.b - L.b;
        const dist = dL * dL + da * da + db * db;
        if (dist < bestD) {
            bestD = dist;
            bestI = i;
        }
    }

    const rgbArr = ANSI256[bestI];
    const result = { index: bestI, rgb: { r: rgbArr[0], g: rgbArr[1], b: rgbArr[2] }, dist: bestD };
    _lut256[key] = result;
    return result;
}

function nearestAnsi16(cIn) {
    // reuse the 256 mapping but constrain to first 16
    const c = toSRGB(cIn);
    const lab = toOKLab(c);
    let bestI = 0,
        bestD = 1e9;
    for (let i = 0; i < 16; i += 1) {
        const L = _ansi256Lab[i];
        const dL = lab.L - L.L;
        const da = lab.a - L.a;
        const db = lab.b - L.b;
        const dist = dL * dL + da * da + db * db;
        if (dist < bestD) {
            bestD = dist;
            bestI = i;
        }
    }
    const rgbArr = ANSI16[bestI];
    return { index: bestI, rgb: { r: rgbArr[0], g: rgbArr[1], b: rgbArr[2] }, dist: bestD };
}

// ------------------------------ Public API ----------------------------------

const api = {
    // types: parse + stringify
    parse: function (color, opts) {
        if (opts !== undefined && opts.named === false) {
            // if named:false and string equals a CSS name, reject
            if (typeof color === "string") {
                const lower = color.trim().toLowerCase();
                if (CSS[lower] !== undefined) {
                    throw new ColorRangeError("Named colors disabled via opts.named=false");
                }
            }
        }
        return toSRGB(color);
    },
    stringify,

    // conversions
    toLinearSRGB,
    fromLinearSRGB,
    toOKLab,
    fromOKLab,
    toOKLCH,
    fromOKLCH,
    toHSL,
    fromHSL,

    // edits
    lighten,
    darken,
    saturate,
    desaturate,
    rotateHue,
    alpha,
    clamp,

    // mixing & compositing
    mix,
    composite,
    premultiply,
    unpremultiply,

    // contrast
    luminance,
    contrastWcag,
    chooseOn,

    // palettes
    scale: scalePublic,
    discrete: discretePublic,
    diverging: divergingPublic,

    // terminal mapping
    nearestAnsi256,
    nearestAnsi16,

    // hooks / plugins / stats
    hooks,
    use,
    stats: function () {
        return {
            parseCalls: __stats.parseCalls,
            convertCalls: __stats.convertCalls,
            mixCalls: __stats.mixCalls,
            paletteBytes: __stats.paletteBytes,
            ansiMapHits: __stats.ansiMapHits,
            ansiMapMisses: __stats.ansiMapMisses,
        };
    },
};

// allow plugins to see API (without circular import issues)
setPublicApi(api);

export default api;
export { api };

// ------------------------------ parse.js (moved) -----------------------------
