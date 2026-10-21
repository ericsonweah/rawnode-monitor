import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { MonitorRuntime, MonitorManager, EventMonitorBridge, ProtocolMonitorBridge, AlertRule, SloDefinition, TelemetryAuthenticator, HealthRegistry, ResourceRegistry, BoundedSignalQueue, JsonlTelemetryStore, LeaderLease } from '../src/index.js';
test('injected event/protocol bridges detach explicit subscriptions',async()=>{
 const r=new MonitorRuntime({profile:'test'});const e=new EventEmitter();const b=new EventMonitorBridge(e,r,{names:['fixture']});b.start();e.emit('fixture',{password:'secret'});assert.equal(b.stats.observed,1);await b.close();assert.equal(e.listenerCount('fixture'),0);
 const p=new ProtocolMonitorBridge(e,r,{name:'fixture',events:['message']});p.start();e.emit('message','test');await p.close();assert.equal(e.listenerCount('message'),0);await r.close();
});
test('readiness lifecycle and manager replacement ownership',async()=>{
 const m=new MonitorManager({profile:'test'});const r=m.default();assert.equal((await r.readiness()).ready,false);await r.start();assert.equal((await r.readiness()).ready,true);assert.throws(()=>m.create('default',{replace:true}),{code:'MONITOR_RUNTIME_IN_USE'});await r.close();assert.equal((await r.readiness()).ready,false);const replacement=m.create('default',{replace:true});assert.notEqual(r,replacement);await m.close();
});
test('alerts and SLO definition calculations preserve capability',async()=>{
 const rule=new AlertRule({name:'high',evaluate:()=>({firing:true,value:42})});assert.equal((await rule.test()).firing,true);
 const slo=new SloDefinition({name:'availability',objective:.99,indicator:{measure:()=>({good:99,total:100})}});assert.equal((await slo.measure()).ratio,.99);
});
test('HMAC accepts exact bytes and rejects changed/expired signatures',()=>{
 const a=new TelemetryAuthenticator({secret:'test-only',maxSkewMs:1000});const body=Buffer.from('{}');const sig=a.sign(body,10000);const headers={'x-rawnode-monitor-timestamp':sig.timestamp,'x-rawnode-monitor-signature':sig.signature};assert.equal(a.verify(body,headers,10000),true);assert.equal(a.verify(Buffer.from('[]'),headers,10000),false);assert.equal(a.verify(body,headers,12000),false);
});
test('late injected Redis lease acquisition cannot restart timers after close',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);const lease=new LeaderLease({redis:{sendCommand:()=>gate},timeoutMs:50});
 const acquire=lease.acquire();await lease.close();release(1);assert.equal(await acquire,false);assert.equal(lease.timer,null);assert.equal(lease.isLeader(),false);
});
test('stuck health and resource callbacks are not relaunched',async()=>{
 let healthCalls=0,resourceCalls=0;const h=new HealthRegistry({timeoutMs:5});h.register('stuck',()=>{healthCalls++;return new Promise(()=>{})});await h.all();await h.all();assert.equal(healthCalls,1);
 const r=new ResourceRegistry({timeoutMs:5});r.register('stuck',{metrics(){resourceCalls++;return new Promise(()=>{})}});await r.collect();await r.collect();assert.equal(resourceCalls,1);
});
test('queue overflow, cancellation and close release memory',async()=>{
 const q=new BoundedSignalQueue({maxItems:1,maxBytes:1024,maxSignalBytes:512,overflow:'block'});q.tryPush({value:1});const c=new AbortController();const pending=q.push({value:2},{signal:c.signal});c.abort();await assert.rejects(pending);q.close();q.clear();assert.equal(q.length,0);assert.equal(q.waiters.length,0);
});
test('task-local file storage persists/query and diagnostics reject traversal',async(t)=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'monitor-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new JsonlTelemetryStore({path:dir,maxFileBytes:2048});await store.initialize();await store.writeMany([{id:'fixture',kind:'event',timestamp:Date.now(),payload:{test:true}}]);await store.flush();assert.equal((await store.query()).items.length,1);await store.close();
 const r=new MonitorRuntime({profile:'test',config:{profile:'test',incidents:{path:dir}}});await assert.rejects(r.diagnosticBundle({id:'../../outside'}),{code:'MONITOR_INVALID_BUNDLE_ID'});
 const bundle=await r.diagnosticBundle({id:'fixture',reason:'test'});const data=JSON.parse(gunzipSync(await readFile(bundle.path)));assert.deepEqual(data.process.argv,[]);await r.close();
});
