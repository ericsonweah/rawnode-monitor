import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {MonitorRuntime} from '@rawnode/monitor';
import {PMMonitorBridge} from '@rawnode/monitor/integrations';
import {RawNodeRuntimeAdapter,RuntimeAgent,Supervisor} from '@rawnode/pm';
const deadline=setTimeout(()=>process.exit(124),20000);deadline.unref();
const config={profile:'test',service:'pm-monitor-composition',system:{enabled:false},resources:{autoDiscover:false},storage:{enabled:true,driver:'memory'}};
test('exact local package pins',async()=>{
 for(const [file,hash] of [['../artifacts/rawnode-pm-0.1.0.tgz','0fa82b2c1b7d27ddd9d185781003c1547002f7c9263d8754d2e48e2bd546aa8f'],['rawnode-monitor-1.0.0.tgz','b246ee9eff0b3579f05c886f05ec485719bb1b4847c97c4eefa99dead480baad']])assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),hash);
});
for(const shape of ['direct','runtime','adapter'])test(`actual Monitor bridge resource attach/query/diagnostics/detach: ${shape}`,async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'rnpm-composition-'));const monitor=new MonitorRuntime({profile:'test',config});const adapter=new RawNodeRuntimeAdapter({incidentDir:dir,callbackTimeoutMs:1000});const runtime=new RuntimeAgent({adapter,autoExit:false,captureSignals:false});const owner=shape==='direct'?runtime:{[shape]:shape==='runtime'?runtime:adapter};const bridge=new PMMonitorBridge(owner,monitor,{name:'monitor'});
 try{await monitor.start();monitor.metrics.counter('composition_metric_total').inc();bridge.start();bridge.start();assert.equal(bridge.snapshot().started,true);assert.ok((await adapter.health()).resources.monitor);assert.match(JSON.stringify(await adapter.metrics()),/composition_metric_total/);assert.ok((await adapter.diagnostics()).resources.monitor);
 await bridge.close();await bridge.close();assert.equal(adapter.resources.has('monitor'),false);assert.equal(monitor.closed,false);bridge.start();assert.ok(adapter.resources.has('monitor'));await bridge.close();
 }finally{await runtime.close();await monitor.close();await rm(dir,{recursive:true,force:true});}
});
test('actual packed Monitor health metrics diagnostics traverse PM child IPC and shutdown',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'rnpm-child-composition-'));const s=new Supervisor();
 try{await s.start({name:'composed',script:path.resolve('worker.mjs'),inheritEnv:false,env:{INCIDENT_DIR:dir},readiness:{mode:'ipc',timeoutMs:3000},shutdown:{graceMs:300,killMs:300},telemetry:{intervalMs:250},logs:{enabled:false},health:{enabled:true,timeoutMs:1500}});
 const record=s.registry.active('composed',0);const health=await s._requestRuntime(record,'supervisor:health',{},2000);assert.ok(health.resources.monitor);
 const metrics=await s._requestRuntime(record,'supervisor:metrics',{},2000);assert.match(JSON.stringify(metrics),/pm_monitor_composition_total/);
 const diag=await s.diagnostics('composed',{timeoutMs:3000});assert.equal(diag.diagnostics[0].result.ok,true);assert.ok(diag.diagnostics[0].result.resources.monitor);
 await s.stop('composed');assert.equal(s.registry.active('composed').length,0);
 }finally{await s.close();await rm(dir,{recursive:true,force:true});}
});
