'use strict';

import { createBrowserEventFabric } from './BrowserEventFabric.js';

const existing = globalThis.RawNode?.eventFabric;
export const fabric = existing?.start && existing?.publish
  ? existing
  : createBrowserEventFabric(globalThis.RawNodeEventFabricConfig || globalThis.RawNode?.eventsConfig || {});

async function boot() {
  try { await fabric.start(); }
  catch (error) {
    globalThis.console?.error?.('[RawNode Events] browser fabric boot failed', error);
    try { fabric.dispatcher?.dispatch?.('events:fabric:browser:error', error); } catch {}
  }
}

if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else queueMicrotask(boot);

export default fabric;
