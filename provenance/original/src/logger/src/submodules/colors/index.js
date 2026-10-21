"use strict";

/* ─────────────────────────────────────────────────────────────
 * Imports
 * ────────────────────────────────────────────────────────────*/
import originalObject from "./src/submodules/colors/core.js";
import detect from "./src/submodules/colors/detect/index.js";
import esc from "./src/submodules/colors/esc/index.js";
import width from "./src/submodules/colors/width/index.js";
import parse from "./src/submodules/colors/parse/index.js";
import conv from "./src/submodules/colors/convert/index.js";
import degrade from "./src/submodules/colors/degrade/index.js";
import hooks from "./src/submodules/colors/hooks/index.js";
import palette from "./src/submodules/colors/palette/index.js";
import Inline from "./src/submodules/color-functions/index.js";
import { createStyleRoot } from "./src/submodules/colors/style/index.js";

/* ───────────────────────────────────────────────────────────── 
 * Utilities
 * ────────────────────────────────────────────────────────────*/
function addMissingProperties(target, source) {
    const sourceDescriptors = Object.getOwnPropertyDescriptors(source);

    for (const key in sourceDescriptors) {
        if (Object.prototype.hasOwnProperty.call(sourceDescriptors, key) &&
            !Object.prototype.hasOwnProperty.call(target, key)) {
            Object.defineProperty(target, key, sourceDescriptors[key]);
        }
    }

    const symbols = Object.getOwnPropertySymbols(source);
    for (const sym of symbols) {
        if (!Object.prototype.hasOwnProperty.call(target, sym)) {
            const descriptor = Object.getOwnPropertyDescriptor(source, sym);
            Object.defineProperty(target, sym, descriptor);
        }
    }

    return target;
}

/* ─────────────────────────────────────────────────────────────
 * Metrics
 * ────────────────────────────────────────────────────────────*/
const _metrics = {
    colors_apply_total: 0,
    colors_degrade_total: Object.create(null),
    colors_strip_bytes_total: 0,
    colors_visible_length_total: 0,
    colors_link_total: { enabled: 0, disabled: 0 },
    colors_errors_total: Object.create(null),
};

/* ─────────────────────────────────────────────────────────────
 * Color Level / Capability API
 * ────────────────────────────────────────────────────────────*/
function level(opts) {
    const stream = opts?.stream || process.stdout;
    return detect.level({ stream });
}

function detectColorLevel(opts) {
    const stream = opts?.stream || process.stdout;
    return detect.detectColorLevel({ stream });
}

function setColorLevel(n, opts) {
    const stream = opts?.stream || process.stdout;
    return detect.setColorLevel(n, { stream });
}

function supportsHyperlinks(stream) {
    return detect.supportsHyperlinks(stream);
}

/* ─────────────────────────────────────────────────────────────
 * Environment bag shared with style engine
 * ────────────────────────────────────────────────────────────*/
const _env = {
    getLevel: (forcedLevel) => {
        if (forcedLevel === 0 || forcedLevel === 1 || forcedLevel === 2 || forcedLevel === 3) {
            return forcedLevel;
        }
        return level();
    },

    sanitize: esc.sanitize,
    strip: esc.strip,

    visibleLength: (s) => {
        const len = width.visibleLength(s);
        if (len > 0) _metrics.colors_visible_length_total += len;
        return len;
    },

    parseColor: parse.parseColor,
    toOKLCH: (c) => conv.to("oklch", c),
    toRGB: (c) => conv.to("rgb", c),
    mixLinearRGB: conv.mix,

    degradeFG: degrade.sgrForFG,
    degradeBG: degrade.sgrForBG,

    hooks,
    metrics: _metrics,
};

/* ─────────────────────────────────────────────────────────────
 * Root Builder (Chainable Style Engine)
 * ────────────────────────────────────────────────────────────*/
const Colors = createStyleRoot(_env);

/* ─────────────────────────────────────────────────────────────
 * Static helpers on Colors
 * ────────────────────────────────────────────────────────────*/
Object.defineProperties(Colors, {
    strip: {
        enumerable: true,
        value: (s) => {
            const inStr = String(s);
            const out = esc.strip(inStr);
            _metrics.colors_strip_bytes_total += inStr.length;
            return out;
        },
    },

    sanitize: { enumerable: true, value: esc.sanitize },
    visibleLength: { enumerable: true, value: _env.visibleLength },

    link: {
        enumerable: true,
        value: (text, url, opts) => {
            const when = opts?.when || "tty";
            const enable =
                when === "always"
                    ? true
                    : when === "never"
                    ? false
                    : supportsHyperlinks();

            if (enable) _metrics.colors_link_total.enabled++;
            else _metrics.colors_link_total.disabled++;

            return esc.osc8Link(String(text), String(url), enable);
        },
    },

    tag: {
        enumerable: true,
        value: (strings, ...values) => {
            let out = "";
            for (let i = 0; i < strings.length; i++) {
                out += strings[i];
                if (i < values.length) {
                    const v = values[i];
                    out += _env.sanitize(typeof v === "string" ? v : String(v));
                }
            }
            return out;
        },
    },

    format: {
        enumerable: true,
        value: (fmt, ...args) => Inline.format(fmt, ...args),
    },

    gradient: {
        enumerable: true,
        value: (stops, opts) =>
            palette.makeGradient(stops, opts, {
                parse: _env.parseColor,
                to: conv.to,
                segmentGraphemes: width.segmentGraphemes,
                applyFG: (rgb, s) => Colors.fg(rgb)(s),
                env: _env,
            }),
    },

    theme: {
        enumerable: true,
        value: (defs) => {
            const out = Object.create(null);
            for (const k of Object.keys(defs)) {
                const v = defs[k];
                if (typeof v === "function") out[k] = v;
            }
            return Object.freeze(out);
        },
    },

    parse: { enumerable: true, value: parse.parseColor },
    to: { enumerable: true, value: conv.to },
    mix: { enumerable: true, value: conv.mix },
    contrast: { enumerable: true, value: conv.contrast },
    chooseOn: { enumerable: true, value: conv.chooseOn },

    use: {
        enumerable: true,
        value: (plugin, options) => hooks.usePlugin(plugin, options, Colors),
    },

    hooks: { enumerable: true, value: hooks.hooks },

    stats: {
        enumerable: true,
        value: () => ({
            colors_apply_total: _metrics.colors_apply_total,
            colors_degrade_total: { ..._metrics.colors_degrade_total },
            colors_strip_bytes_total: _metrics.colors_strip_bytes_total,
            colors_visible_length_total: _metrics.colors_visible_length_total,
            colors_link_total: {
                enabled: _metrics.colors_link_total.enabled,
                disabled: _metrics.colors_link_total.disabled,
            },
            colors_errors_total: { ..._metrics.colors_errors_total },
        }),
    },

    explain: {
        enumerable: true,
        value: (input) => {
            if (typeof input === "function" && input.__rnc?.pipeline) {
                return {
                    type: "style",
                    level: level(),
                    ops: input.__rnc.pipeline.map((op) => op.describe()),
                };
            }
            return {
                type: "string",
                level: level(),
                sequences: esc.explainSequences(String(input)),
            };
        },
    },

    inline: { enumerable: true, value: Inline },
    colorFunctions: { enumerable: true, value: Inline.fns },
    fns: { enumerable: true, value: Inline.fns },
});

/* ─────────────────────────────────────────────────────────────
 * format() adapter on chained builders
 * ────────────────────────────────────────────────────────────*/
const __RESET = "\x1b[0m";

function __stripTrailingReset(s) {
    return typeof s === "string" && s.endsWith(__RESET)
        ? s.slice(0, -__RESET.length)
        : s;
}

function __wrapBuilderForFormat(builder) {
    if (typeof builder !== "function" || !builder.__rnc) return builder;

    return new Proxy(builder, {
        apply(target, thisArg, args) {
            return Reflect.apply(target, thisArg, args);
        },

        get(target, prop, receiver) {
            if (prop === "format") {
                return (fmt, ...args) => {
                    let rendered = Inline.format(fmt, ...args);
                    rendered = __stripTrailingReset(rendered);
                    return target(rendered);
                };
            }

            const v = Reflect.get(target, prop, receiver);
            return typeof v === "function" && v.__rnc
                ? __wrapBuilderForFormat(v)
                : v;
        },
    });
}

/* Root proxy: ensures .format is available everywhere */
const ColorsProxy = new Proxy(Colors, {
    get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" && v.__rnc
            ? __wrapBuilderForFormat(v)
            : v;
    },

    apply(target, thisArg, args) {
        return Reflect.apply(target, thisArg, args);
    },
});

/* Additional exposed helpers */
Colors.inlineFormat = Inline.format;

/* Merge missing properties from originalObject */
addMissingProperties(ColorsProxy, originalObject);

/* ─────────────────────────────────────────────────────────────
 * Exports
 * ────────────────────────────────────────────────────────────*/
export default ColorsProxy;

export {
    level,
    detectColorLevel,
    setColorLevel,
    supportsHyperlinks,
};
