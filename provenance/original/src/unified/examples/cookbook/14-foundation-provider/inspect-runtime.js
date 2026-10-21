'use strict';

// Run this from code that already has the booted RawNode Application instance.
export function inspectUnified(app) {
  const unified = app.resolve('unified.app');
  const manager = app.resolve('unified.manager');

  return {
    sameHttpObject: unified.http === unified,
    ws: app.resolve('unified.ws'),
    tcp: app.resolve('unified.tcp'),
    udp: app.resolve('unified.udp'),
    addresses: app.resolve('unified.addresses')(),
    health: app.resolve('unified.health')(),
    readiness: app.resolve('unified.readiness')(),
    liveness: app.resolve('unified.liveness')(),
    metrics: app.resolve('unified.metrics')(),
    prometheus: app.resolve('unified.prometheus')(),
    diagnostics: app.resolve('unified.diagnostics')(),
    snapshot: manager.snapshot(),
  };
}
