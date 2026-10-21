'use strict';

import { deepFreeze } from '../support/safe.js';

export class EventStudioAnalyzer {
  analyze(input = {}) {
    const findings = [];
    const fabric = input.fabric || {};
    const transports = fabric.transports?.transports || fabric.transports || {};
    const definitions = fabric.definitions || {};

    if (fabric.profile === 'production' || fabric.profile === 'strict') {
      if (!fabric.gateway) findings.push(finding('error', 'EVENT_STUDIO_GATEWAY_MISSING', 'The hardened fabric has no inbound admission gateway snapshot.'));
      if ((definitions.size || 0) === 0) findings.push(finding('warning', 'EVENT_STUDIO_DEFINITIONS_EMPTY', 'The hardened fabric has no registered event definitions.'));
      for (const [id, transport] of Object.entries(transports || {})) {
        if (transport?.capabilities?.remote && transport?.ready && input.crypto === false) {
          findings.push(finding('error', 'EVENT_STUDIO_UNSIGNED_REMOTE', `Remote transport '${id}' is ready without envelope signing.`));
        }
      }
    }

    const resources = fabric.resources || {};
    if (resources.maxBytes > 0 && resources.bytes / resources.maxBytes >= 0.9) {
      findings.push(finding(
        'warning',
        'EVENT_STUDIO_RESOURCE_PRESSURE',
        'The global Event Fabric byte budget is above 90%.',
        { usedBytes: resources.bytes, limitBytes: resources.maxBytes },
      ));
    }
    for (const [category, value] of Object.entries(resources.categories || {})) {
      const limitBytes = Number(value?.limits?.maxBytes || value?.maxBytes || value?.limitBytes || 0);
      const usedBytes = Number(value?.bytes || value?.usedBytes || 0);
      if (limitBytes > 0 && usedBytes / limitBytes >= 0.9) {
        findings.push(finding(
          'warning',
          'EVENT_STUDIO_RESOURCE_PRESSURE',
          `Event resource category '${category}' is above 90% of its byte budget.`,
          { category, usedBytes, limitBytes },
        ));
      }
    }

    const outbox = input.outbox || {};
    const dead = Number(outbox.status?.dead || outbox.stats?.deadLettered || 0);
    if (dead > 0) findings.push(finding('warning', 'EVENT_STUDIO_DEAD_LETTERS', `${dead} event delivery records are dead-lettered.`, { count: dead }));

    const projection = input.projections || {};
    if (Number(projection.stats?.failures || 0) > 0) findings.push(finding('warning', 'EVENT_STUDIO_PROJECTION_FAILURES', 'One or more projection executions failed.', { failures: projection.stats.failures }));

    return deepFreeze({
      ok: !findings.some((entry) => entry.level === 'error'),
      findings,
      summary: {
        errors: findings.filter((entry) => entry.level === 'error').length,
        warnings: findings.filter((entry) => entry.level === 'warning').length,
        transports: Object.keys(transports || {}).length,
        definitions: Number(definitions.size || 0),
      },
    });
  }

  correlationGraph(records = []) {
    const nodes = new Map();
    const edges = [];
    for (const record of records || []) {
      const id = record.eventId || record.id || `record:${nodes.size + 1}`;
      nodes.set(id, {
        id,
        name: record.eventName || record.name || record.type || 'event',
        at: record.at || record.occurredAt || null,
        correlationId: record.correlationId || record.context?.correlationId || null,
      });
      const parent = record.causationId || record.context?.causationId || record.parentId || null;
      if (parent) edges.push({ from: parent, to: id, kind: 'causation' });
    }
    return deepFreeze({ nodes: [...nodes.values()], edges });
  }
}

function finding(level, code, message, details = null) {
  return Object.freeze({ level, code, message, details });
}
export default EventStudioAnalyzer;
