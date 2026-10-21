import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import { MonitorRuntime, PMMonitorBridge } from '@rawnode/monitor';
import { RawNodeRuntimeAdapter, RuntimeAgent } from '@rawnode/pm';
const adapter = new RawNodeRuntimeAdapter({ callbackTimeoutMs: 100, incidentDir: new URL('./fixture-incidents',import.meta.url).pathname });
const monitor = new MonitorRuntime({ profile:'test', config:{ profile:'test', service:'pm-composition-fixture', storage:{enabled:true,driver:'memory'} } });
const listenerEvents=['message','uncaughtExceptionMonitor','SIGTERM','SIGINT'];
const listeners=listenerEvents.map(name=>process.listenerCount(name));
let agent;
await monitor.start();
try {
 const bridge = new PMMonitorBridge(adapter, monitor);
 bridge.start().start(); assert.equal(adapter.resources.size,1);
 const health=await adapter.health();assert.equal(health.resources.monitor.ok,true);
 const metrics=await adapter.metrics();assert.ok(metrics.framework.monitor.metrics);
 monitor.emitEvent('fixture',{password:'pm-composition-test-secret'});
 monitor.startSpan('fixture',{attributes:{token:'pm-composition-test-secret'}}).end();
 const diagnostics=await adapter.diagnostics();
 assert.equal(diagnostics.ok,true);
 assert.equal(JSON.stringify(diagnostics).includes('pm-composition-test-secret'),false);
 const report=await readFile(diagnostics.file,'utf8');
 assert.equal(report.includes('pm-composition-test-secret'),false);
 assert.ok(JSON.parse(report).resources.monitor);
 await bridge.close();await bridge.close();assert.equal(adapter.resources.size,0);
 for(const owner of [{runtime:adapter},{adapter}]) {
  const wrapped=new PMMonitorBridge(owner,monitor);wrapped.start();assert.equal(adapter.resources.size,1);
  await wrapped.close();assert.equal(adapter.resources.size,0);
 }
 agent=new RuntimeAgent({adapter,managed:false,captureSignals:false,autoExit:false});
 const nested=new PMMonitorBridge(agent,monitor);nested.start();assert.equal(adapter.resources.size,1);
 await nested.close();assert.equal(adapter.resources.size,0);
 await agent.close();await agent.close();
 assert.deepEqual(listenerEvents.map(name=>process.listenerCount(name)),listeners);
 console.log(JSON.stringify({ok:true,monitor:'@rawnode/monitor@1.0.0',pm:'@rawnode/pm@0.1.0',contracts:['fluent PM registerResource + boolean unregisterResource','direct/runtime/adapter/RuntimeAgent bridge owners','health and metrics snapshots','redacted returned and on-disk diagnostics','idempotent bridge and agent closure','unchanged process listener counts'],scope:'actual exact packed package composition; synthetic telemetry only; no supervisor/daemon/process launch'}));
} finally { await agent?.close();await monitor.close(); }
