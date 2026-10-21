import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { MonitorRuntime, HealthRegistry, ResourceRegistry, SafeTelemetrySerializer, TelemetryRedactor, withTimeout, PMMonitorBridge, MonitorStudioManager, MonitorStudioAuthorizer, MonitorStudioAssets, MonitorStudioController, SyntheticMonitor, MemoryTelemetryStore } from '../src/index.js';

const runtime = (options = {}) => new MonitorRuntime({ profile: 'test', logger: { warn(){}, error(){} }, ...options });
test('concurrent starts and closes settle once and terminal restart is explicit', async () => {
 const r = runtime(); await Promise.all([r.start(),r.start(),r.start()]); assert.equal(r.stats.starts,1); assert.equal((await r.health()).ok,true);
 await Promise.all([r.close(),r.close()]); assert.equal(r.state,'stopped'); assert.equal(r.timers.size,0); assert.equal(r.pipeline.timer,null);
 await assert.rejects(r.start({restart:true}),{code:'MONITOR_CLOSED'});
});
test('closing idle runtime releases an already used pipeline',async()=>{
 const r=runtime();r.emitEvent('queued');await r.close();assert.equal(r.pipeline.closed,true);assert.equal(r.emitEvent('late').accepted,false);
});
test('close wins race with blocked startup without later resurrection',async()=>{
 let resolve; const blocked=new Promise(r=>resolve=r); const store={initialize:()=>blocked,writeMany:async()=>{},query:async()=>[],close:async()=>{}};
 const r=runtime({store});const started=r.start();await sleep(2);const closed=r.close({timeoutMs:100});await assert.rejects(started,{code:'MONITOR_CLOSED'});await closed;
 resolve();await sleep(10);assert.equal(r.state,'stopped');assert.equal(r.pipeline.running,false);assert.equal(r.timers.size,0);
});
test('pre-abort avoids callback and active abort settles ignoring callbacks',async()=>{
 const pre=new AbortController();pre.abort(new Error('pre'));let called=false;
 await assert.rejects(withTimeout(()=>{called=true},100,{signal:pre.signal}),/pre/);assert.equal(called,false);
 const c=new AbortController();const task=withTimeout(()=>new Promise(()=>{}),1000,{signal:c.signal});c.abort(new Error('cancel'));
 await assert.rejects(task,/cancel/);assert.equal(getEventListeners(c.signal,'abort').length,0);
});
test('slow collection is coalesced and close cancels it',async()=>{
 const r=runtime(); await r.start();let count=0;r.metrics.observableGauge('hung',()=>{count++;return new Promise(()=>{})});
 const a=r.collectMetrics();const b=r.collectMetrics();assert.equal(a,b);await sleep(5);await r.close({timeoutMs:100});await assert.rejects(a,{code:'MONITOR_CLOSED'});assert.equal(count,1);
});
test('health distinguishes readiness, liveness, degraded and timeout',async()=>{
 const h=new HealthRegistry({timeoutMs:10,historyLimit:2});h.register('alive',()=>true,{kind:'liveness'});h.register('db',()=>false,{kind:'dependency',critical:false});
 assert.equal((await h.live()).ok,true);assert.equal((await h.ready()).status,'degraded');h.register('hung',()=>new Promise(()=>{}),{kind:'readiness'});
 assert.equal((await h.ready()).ok,false);assert.equal(h.history.length,2);assert.equal(h.stats.timeouts,1);
});
test('resource replace/unregister cleans health checks',async()=>{
 const h=new HealthRegistry();const r=new ResourceRegistry({healthRegistry:h});r.register('db',{health:()=>true});r.register('db',{health:()=>false},{replace:true});assert.equal(h.list().length,1);
 r.unregister('db');assert.equal(h.list().length,0);assert.equal((await h.ready()).ok,true);r.register('db',{health:()=>true});
});
test('public telemetry redacts payload context metadata span and diagnostics',async()=>{
 const r=runtime();const seen=[];r.on('signal',s=>seen.push(s));r.emitEvent('test',{password:'fixture-secret'},{context:{token:'fixture-secret'},attributes:{secret:'fixture-secret'},resource:{token:'fixture-secret'}});
 r.startSpan('span',{attributes:{password:'fixture-secret'}}).end();r.registerHealth('private',()=>({ok:true,details:{token:'fixture-secret'}}));
 assert.equal(JSON.stringify([seen,r.tracer.query(),await r.health(),await r.diagnostics()]).includes('fixture-secret'),false);await r.close();
});
test('untrusted signal kind and fake byte sizes cannot bypass bounds',async()=>{
 const r=runtime({config:{profile:'test',pipeline:{maxSignalBytes:1024,maxBytes:2048},security:{maxPayloadBytes:8192}}});
 for(let i=0;i<200;i++)assert.equal(r.emitSignal('invented'+i,{}).accepted,false);
 assert.equal(Object.keys(r.stats.emitted).length,0);assert.equal(r.emitEvent('large',{data:'x'.repeat(4000)},{bytes:1}).accepted,false);await r.close();
});
test('serializer bounds serialized bytes, cycles, hostile getters, prototype input',()=>{
 const s=new SafeTelemetrySerializer({maxPayloadBytes:1024});const x={a:'x'.repeat(10000)};x.self=x;
 assert.ok(Buffer.byteLength(JSON.stringify(s.sanitize(x)))<=1024);
 const y=JSON.parse('{"__proto__":{"polluted":true},"password":"x"}');Object.defineProperty(y,'bad',{enumerable:true,get(){throw Error('bad')}});
 assert.equal({}.polluted,undefined);assert.equal(Object.hasOwn(s.sanitize(y),'__proto__'),false);assert.doesNotThrow(()=>s.stringify(undefined));
 assert.equal(JSON.stringify(new TelemetryRedactor({maxDepth:1}).redact({a:{password:'hidden'}})).includes('hidden'),false);
});
test('PM bridge disposes direct, runtime and adapter owners idempotently',async()=>{
 for(const path of ['direct','runtime','adapter']){
  let registrations=0,removals=0;const owner={registerResource(name,value){registrations++;assert.equal(name,'monitor');assert.equal(typeof value.health,'function');return()=>{removals++}}};
  const bridge=new PMMonitorBridge(path==='direct'?owner:{[path]:owner},{health(){},metricsSnapshot(){},diagnostics(){}});bridge.start().start();await bridge.close();await bridge.close();assert.equal(registrations,1);assert.equal(removals,1);
 }
});
test('Studio authorizer uses socket, denies cross origin even with custom auth',async()=>{
 const a=new MonitorStudioAuthorizer({authorize:()=>true});assert.equal((await a.check({ip:'127.0.0.1',socket:{remoteAddress:'203.0.113.1'},headers:{}})).ok,false);
 assert.equal((await a.check({socket:{remoteAddress:'127.0.0.1'},headers:{origin:'https://evil.invalid',host:'localhost'}},{mutate:true})).ok,false);
 const token=new MonitorStudioAuthorizer({token:'fixture-token'});assert.equal((await token.check({socket:{remoteAddress:'127.0.0.1'},headers:{authorization:'Bearer fixture-token'}})).ok,true);
});
test('Studio closes listeners and slow clients and rejects streams after close',async()=>{
 const r=runtime();const before=r.listenerCount('signal');const s=new MonitorStudioManager({monitor:r,config:{streamMaxBytes:128}});
 const res=new EventEmitter();res.write=()=>false;res.end=()=>{};res.writeHead=()=>{};
 s.stream({},res);s.broadcast('test',{data:'x'.repeat(500)});assert.equal(s.clients.size,0);assert.equal(res.listenerCount('drain'),0);
 await s.close();assert.equal(r.listenerCount('signal'),before);assert.throws(()=>s.stream({},res),{code:'MONITOR_STREAM_UNAVAILABLE'});await r.close();
});
test('Studio assets are packaged and reject unknown/prototype paths',async()=>{
 const a=new MonitorStudioAssets();assert.match((await a.read('studio.js')).body,/mountMonitorStudio/);assert.equal(await a.read('../package.json'),null);assert.equal(await a.read('constructor'),null);
});
test('preparsed and raw bodies obey request limits',async()=>{
 const r=runtime();const s=new MonitorStudioManager({monitor:r});const c=new MonitorStudioController({studio:s,maxBodyBytes:1024});
 for (const input of [{body:{x:'x'.repeat(2000)}},{rawBody:Buffer.from(JSON.stringify({x:'x'.repeat(2000)}))}]){
  let body;const res={setHeader(){},end(v){body=JSON.parse(v)}};await c.silence({socket:{remoteAddress:'127.0.0.1'},headers:{},...input},res);assert.equal(res.statusCode,413);assert.equal(body.error.code,'MONITOR_BODY_TOO_LARGE');
 }await s.close();await r.close();
});
test('synthetic custom callbacks support timeout and reject after close',async()=>{
 const s=new SyntheticMonitor({timeoutMs:100});s.register({id:'hung',type:'custom',run:()=>new Promise(()=>{})});const result=await s.run('hung');assert.equal(result.ok,false);await s.close();await assert.rejects(s.run('hung'),{code:'MONITOR_CLOSED'});
});
test('memory store retention stays bounded',async()=>{
 const store=new MemoryTelemetryStore({maxItems:3,maxMemoryItems:3});for(let i=0;i<10;i++)await store.writeMany([{id:String(i),kind:'event',timestamp:Date.now(),payload:{i}}]);assert.ok((await store.query({limit:100})).items.length<=3);await store.close();
});
