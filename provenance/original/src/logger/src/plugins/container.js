// src/submodules/plugins/container.js
"use strict";

/**
 * PluginContainer manages logger plugins and their lifecycle hooks.
 *
 * Hook points:
 *  - beforeBuild(entry)
 *  - afterBuild(entry)
 *  - beforeWrite(entry, transport)
 *  - afterWrite(entry, transport)
 */
class PluginContainer {
    constructor() {
        this.plugins = [];
    }

    use(plugin = {}) {
        if (plugin && typeof plugin === "object") {
            this.plugins.push(plugin);
        }
        return this;
    }

    runHook(hookName, ...args) {
        for (const plugin of this.plugins) {
            if (plugin.hooks && typeof plugin.hooks[hookName] === "function") {
                try {
                    plugin.hooks[hookName](...args);
                } catch (err) {
                    // plugin errors should NOT break the logger
                    console.error(`Plugin hook error (${hookName}):`, err);
                }
            }
        }
    }
}

export default PluginContainer;
