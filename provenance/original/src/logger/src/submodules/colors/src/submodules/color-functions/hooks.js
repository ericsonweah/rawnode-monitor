"use strict";


// src/submodules/color-functions/hooks.js

/**
 * Minimal, deterministic hook registry.
 * All hooks are optional and never affect determinism of outputs.
 */

const HOOKS = Object.freeze([
  "beforeParse","afterParse",
  "beforeConvert","afterConvert",
  "beforeEdit","afterEdit",
  "beforeMix","afterMix",
  "beforeSerialize","afterSerialize",
  "onGamutClip","onError"
]);

// Array per hook, ordered by `order` then registration sequence
const registry = {};
for (let i = 0; i < HOOKS.length; i += 1) {
  registry[HOOKS[i]] = [];
}

function hooks(h) {
  // h is a partial map of hookName -> fn
  for (let i = 0; i < HOOKS.length; i += 1) {
    const name = HOOKS[i];
    if (h[name] !== undefined && typeof h[name] === "function") {
      registry[name].push({ fn: h[name], ns: undefined, order: 0 });
    }
  }
}

function use(plugin, opts) {
  const hasName = plugin !== undefined && typeof plugin.name === "string";
  const ns = hasName === true ? plugin.name : (opts !== undefined && typeof opts.namespace === "string" ? opts.namespace : "anon");
  const order = opts !== undefined && typeof opts.order === "number" ? opts.order : 0;
  if (plugin !== undefined && plugin.hooks !== undefined) {
    const h = plugin.hooks;
    for (let i = 0; i < HOOKS.length; i += 1) {
      const name = HOOKS[i];
      if (h[name] !== undefined && typeof h[name] === "function") {
        registry[name].push({ fn: h[name], ns, order });
      }
    }
  }
  if (plugin !== undefined && typeof plugin.setup === "function") {
    plugin.setup(publicApi);
  }
  // resort by order for determinism
  for (let i = 0; i < HOOKS.length; i += 1) {
    const name = HOOKS[i];
    registry[name].sort((a, b) => (a.order === b.order ? 0 : (a.order < b.order ? -1 : 1)));
  }
}

function run(name, args) {
  const arr = registry[name];
  if (arr === undefined || arr.length === 0) return;
  for (let i = 0; i < arr.length; i += 1) {
    try { arr[i].fn.apply(null, args); } catch (e) { /* swallow hook errors */ }
  }
}

// stats visibility is provided by colorFunctions.js
let publicApi = null;
function setPublicApi(api) { publicApi = api; }

export default { hooks, use, run, setPublicApi };
export { hooks, use, run, setPublicApi };
