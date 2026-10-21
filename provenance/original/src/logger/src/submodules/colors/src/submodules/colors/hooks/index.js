'use strict';

const _hooks = {
  beforeStyle: null,
  afterStyle: null,
  onDegrade: null,
  onLink: null,
  onError: null
};

const _plugins = [];
let _pluginId = 0;

function hooks(def) {
  if (def && typeof def === 'object') {
    if (typeof def.beforeStyle === 'function') { _hooks.beforeStyle = def.beforeStyle; }
    if (typeof def.afterStyle === 'function') { _hooks.afterStyle = def.afterStyle; }
    if (typeof def.onDegrade === 'function') { _hooks.onDegrade = def.onDegrade; }
    if (typeof def.onLink === 'function') { _hooks.onLink = def.onLink; }
    if (typeof def.onError === 'function') { _hooks.onError = def.onError; }
  }
}

function emitError(err, ctx) {
  try { if (typeof _hooks.onError === 'function') { _hooks.onError(err, ctx); } } catch (_e) { /* swallow */ }
}

function usePlugin(plugin, options, Colors) {
  const ns = options && options.namespace ? String(options.namespace) : '';
  const order = options && typeof options.order === 'number' ? options.order : 0;
  if (!plugin || typeof plugin.register !== 'function') { return { ok: 0, error: 'invalid_plugin' }; }
  const id = (++_pluginId);
  _plugins.push({ id, order, ns, plugin });
  _plugins.sort((a, b) => (a.order < b.order ? -1 : (a.order > b.order ? 1 : 0)));
  try {
    plugin.register(Colors);
    return { ok: 1, id };
  } catch (err) {
    emitError(err, { where: 'plugin.register', ns });
    return { ok: 0, error: String(err && err.message ? err.message : err) };
  }
}




export default { hooks, usePlugin, emitError, _hooks };
export { hooks, usePlugin, emitError, _hooks };
