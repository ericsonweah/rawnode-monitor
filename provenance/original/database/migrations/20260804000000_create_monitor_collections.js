'use strict';

const KINDS = Object.freeze([
  'metrics', 'span', 'event', 'log', 'health', 'alert',
  'incident', 'slo', 'resource', 'deployment', 'anomaly', 'synthetic', 'internal', 'signals',
]);

/** Durable RawNode Monitor signal collections and query indexes. */
export default class CreateMonitorCollections {
  constructor(Schema = null) { this.Schema = Schema; }

  async up(context = {}) {
    const Schema = resolveSchema(context, this);
    for (const kind of KINDS) {
      const name = `monitor_${kind}`;
      await ensureCollection(Schema, name);
      await Schema.table(name, (collection) => {
        collection.index({ id: 1 }, { unique: true, name: `${name}_identity` });
        collection.index({ service: 1, environment: 1, timestamp: -1 }, { name: `${name}_service_timeline` });
        collection.index({ instanceId: 1, timestamp: -1 }, { name: `${name}_instance_timeline`, sparse: true });
        collection.index({ tenantId: 1, timestamp: -1 }, { name: `${name}_tenant_timeline`, sparse: true });
        collection.index({ traceId: 1, timestamp: 1 }, { name: `${name}_trace_timeline`, sparse: true });
        collection.index({ priority: -1, timestamp: -1 }, { name: `${name}_priority_timeline` });
        collection.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: `${name}_retention` });
      }, { failFast: true });
    }

    await Schema.table('monitor_span', (collection) => {
      collection.index({ traceId: 1, startTimeUnixNano: 1 }, { name: 'monitor_span_waterfall' });
      collection.index({ name: 1, status: 1, timestamp: -1 }, { name: 'monitor_span_operation_status' });
      collection.index({ 'payload.name': 1, 'payload.status.code': 1, timestamp: -1 }, { name: 'monitor_span_payload_operation_status', sparse: true });
      collection.index({ 'payload.attributes.http.route': 1, timestamp: -1 }, { name: 'monitor_span_http_route', sparse: true });
    }, { failFast: true });

    await Schema.table('monitor_metrics', (collection) => {
      collection.index({ 'payload.timestamp': -1 }, { name: 'monitor_metrics_snapshot_time', sparse: true });
      collection.index({ service: 1, environment: 1, 'payload.metrics.name': 1, timestamp: -1 }, { name: 'monitor_metrics_lookup', sparse: true });
    }, { failFast: true });

    await Schema.table('monitor_log', (collection) => {
      collection.index({ 'payload.level': 1, timestamp: -1 }, { name: 'monitor_log_level_timeline', sparse: true });
      collection.index({ 'payload.context.requestId': 1, timestamp: 1 }, { name: 'monitor_log_request', sparse: true });
    }, { failFast: true });

    await Schema.table('monitor_event', (collection) => {
      collection.index({ 'payload.name': 1, timestamp: -1 }, { name: 'monitor_event_name_timeline', sparse: true });
    }, { failFast: true });

    await Schema.table('monitor_health', (collection) => {
      collection.index({ 'payload.status': 1, timestamp: -1 }, { name: 'monitor_health_status_timeline', sparse: true });
      collection.index({ 'payload.ok': 1, timestamp: -1 }, { name: 'monitor_health_result_timeline', sparse: true });
    }, { failFast: true });

    await Schema.table('monitor_alert', (collection) => {
      collection.index({ 'payload.ruleId': 1, 'payload.state': 1, timestamp: -1 }, { name: 'monitor_alert_rule_state', sparse: true });
      collection.index({ 'payload.severity': 1, timestamp: -1 }, { name: 'monitor_alert_severity_timeline', sparse: true });
    }, { failFast: true });

    await Schema.table('monitor_incident', (collection) => {
      collection.index({ 'payload.id': 1, timestamp: -1 }, { name: 'monitor_incident_identity_timeline', sparse: true });
      collection.index({ 'payload.state': 1, 'payload.severity': 1, timestamp: -1 }, { name: 'monitor_incident_state_severity', sparse: true });
    }, { failFast: true });

    await Schema.table('monitor_slo', (collection) => {
      collection.index({ 'payload.id': 1, timestamp: -1 }, { name: 'monitor_slo_identity_timeline', sparse: true });
      collection.index({ 'payload.compliance': 1, timestamp: -1 }, { name: 'monitor_slo_compliance_timeline', sparse: true });
    }, { failFast: true });

    await Schema.table('monitor_resource', (collection) => {
      collection.index({ 'payload.name': 1, timestamp: -1 }, { name: 'monitor_resource_name_timeline', sparse: true });
      collection.index({ 'payload.health.ok': 1, timestamp: -1 }, { name: 'monitor_resource_health_timeline', sparse: true });
    }, { failFast: true });

    await Schema.table('monitor_deployment', (collection) => {
      collection.index({ 'payload.commit': 1 }, { name: 'monitor_deployment_commit', sparse: true });
      collection.index({ 'payload.version': 1, timestamp: -1 }, { name: 'monitor_deployment_version_timeline', sparse: true });
      collection.index({ 'payload.buildId': 1 }, { name: 'monitor_deployment_build', sparse: true });
    }, { failFast: true });

    await Schema.table('monitor_anomaly', (collection) => {
      collection.index({ 'payload.ruleId': 1, 'payload.state': 1, timestamp: -1 }, { name: 'monitor_anomaly_rule_state', sparse: true });
      collection.index({ 'payload.metric': 1, timestamp: -1 }, { name: 'monitor_anomaly_metric_timeline', sparse: true });
      collection.index({ 'payload.severity': 1, timestamp: -1 }, { name: 'monitor_anomaly_severity_timeline', sparse: true });
    }, { failFast: true });

    await Schema.table('monitor_synthetic', (collection) => {
      collection.index({ 'payload.checkId': 1, timestamp: -1 }, { name: 'monitor_synthetic_check_timeline', sparse: true });
      collection.index({ 'payload.ok': 1, timestamp: -1 }, { name: 'monitor_synthetic_result_timeline', sparse: true });
      collection.index({ 'payload.type': 1, timestamp: -1 }, { name: 'monitor_synthetic_type_timeline', sparse: true });
    }, { failFast: true });
  }

  async down(context = {}) {
    const Schema = resolveSchema(context, this);
    for (const kind of [...KINDS].reverse()) {
      const name = `monitor_${kind}`;
      if (typeof Schema.dropIfExists === 'function') await Schema.dropIfExists(name);
      else { try { await Schema.drop(name); } catch (error) { if (!/not found|does not exist|namespace/i.test(error?.message || '')) throw error; } }
    }
  }
}

async function ensureCollection(Schema, name) {
  if (typeof Schema.ensureCollection === 'function') return await Schema.ensureCollection(name);
  try { return await Schema.create(name, () => {}); }
  catch (error) { if (/already exists|namespace exists|duplicate/i.test(error?.message || '')) return null; throw error; }
}
function resolveSchema(context = {}, instance = null) {
  const app = context?.app || context?.application || globalThis.app || null;
  const schema = instance?.Schema || context?.Schema || context?.schema
    || safeResolve(app, 'schema') || safeResolve(app, 'database.schema') || globalThis.Schema || null;
  if (!schema || typeof schema.table !== 'function' || (typeof schema.create !== 'function' && typeof schema.ensureCollection !== 'function')) {
    throw new TypeError('RawNode Monitor migration requires the RawNode Schema service.');
  }
  return schema;
}
function safeResolve(app, key) { try { return app?.resolve?.(key) ?? app?.container?.resolve?.(key) ?? null; } catch { return null; } }
