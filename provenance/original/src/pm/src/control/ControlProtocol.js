'use strict';

import { randomUUID } from 'node:crypto';
import { CONTROL_PROTOCOL_VERSION } from '../constants.js';

export function controlRequest(command, params = {}, token = null) {
  return {
    protocol: CONTROL_PROTOCOL_VERSION,
    id: randomUUID(),
    token,
    command: String(command || ''),
    params: params && typeof params === 'object' ? params : {},
    at: Date.now(),
  };
}

export function controlResponse(request, result = null, error = null) {
  return {
    protocol: CONTROL_PROTOCOL_VERSION,
    id: request?.id || null,
    ok: !error,
    result: error ? null : result,
    error: error || null,
    at: Date.now(),
  };
}

export function controlEvent(event, payload = {}) {
  return {
    protocol: CONTROL_PROTOCOL_VERSION,
    stream: 'events',
    event: String(event || 'message'),
    payload,
    at: Date.now(),
  };
}
