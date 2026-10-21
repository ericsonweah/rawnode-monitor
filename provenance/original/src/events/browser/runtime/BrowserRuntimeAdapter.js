'use strict';

import { UniversalRuntimeAdapter } from '../../universal/runtime/UniversalRuntimeAdapter.js';

export class BrowserRuntimeAdapter extends UniversalRuntimeAdapter {
  constructor(options = {}) { super({ ...options, name: options.name || (typeof ServiceWorkerGlobalScope !== 'undefined' && globalThis instanceof ServiceWorkerGlobalScope ? 'service-worker' : typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope ? 'worker' : 'browser') }); this.window = options.window || globalThis.window || null; this.document = options.document || globalThis.document || null; }
  capabilities() { return Object.freeze({ ...super.capabilities(), visibility: !!this.document?.visibilityState, history: !!this.window?.history, navigation: !!this.window?.location, indexedDb: !!globalThis.indexedDB, locks: !!globalThis.navigator?.locks, online: typeof globalThis.navigator?.onLine === 'boolean' }); }
}
export default BrowserRuntimeAdapter;
