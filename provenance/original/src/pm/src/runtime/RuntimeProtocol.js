'use strict';

import { RUNTIME_PROTOCOL_VERSION } from '../constants.js';

export function runtimePacket(type, payload = {}, meta = {}) {
  return {
    __rawnodePm: 1,
    protocol: RUNTIME_PROTOCOL_VERSION,
    type,
    at: Date.now(),
    pid: process.pid,
    app: process.env.RAWNODE_PM_APP || meta.app || null,
    slot: Number(process.env.RAWNODE_PM_SLOT ?? meta.slot ?? 0),
    generation: Number(process.env.RAWNODE_PM_GENERATION ?? meta.generation ?? 0),
    requestId: meta.requestId || null,
    replyTo: meta.replyTo || null,
    payload,
  };
}

export function isRuntimePacket(value) {
  return !!(value && typeof value === 'object' && value.__rawnodePm === 1 && typeof value.type === 'string');
}
