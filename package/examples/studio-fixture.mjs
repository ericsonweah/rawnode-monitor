import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { MonitorRuntime, MonitorStudioManager, registerMonitorStudioRoutes } from '@rawnode/monitor';

/** Isolated fixture: no application, database, exporter or production telemetry. */
export async function createStudioFixture() {
 const monitor=new MonitorRuntime({logger:{log(){},info(){},warn(){},error(){}},profile:'test',config:{profile:'test',service:'Local fixture <img src=x onerror=alert(1)>',environment:'fixture',system:{enabled:false},resources:{autoDiscover:false},storage:{enabled:true,driver:'memory'},incidents:{captureDiagnostics:false},alerts:{autoIncidentSeverities:[]},studio:{prefix:'/monitor',pollIntervalMs:1000}}});
 const studio=new MonitorStudioManager({monitor});
 const routes=[];
 const router={};for(const method of ['get','post','delete'])router[method]=(path,handler)=>{const keys=[];const pattern=path.split('/').map(part=>part.startsWith(':')?(keys.push(part.slice(1)),'([^/]+)'):part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/');routes.push({method:method.toUpperCase(),regex:new RegExp('^'+pattern+'/?$'),keys,handler});};
 registerMonitorStudioRoutes(router,{studio});
 let mode='seeded';let requests=0;let mutationRequests=0;const lifetime=new AbortController();
 await monitor.start();
 monitor.metrics.counter('fixture_requests_total').inc({route:'/fixture'});
 const fixtureSpan=monitor.startSpan('fixture <img src=x onerror=alert(1)>',{attributes:{token:'fixture-secret'}});fixtureSpan.end();
 monitor.alerts.register({id:'fixture-alert',name:'Synthetic capacity warning <img src=x onerror=alert(1)>',severity:'warning',evaluate:()=>({firing:true,value:95})});
 await monitor.alerts.evaluate();
 monitor.runbooks.register({id:'fixture-runbook',title:'Synthetic recovery',description:'Local validation only.',steps:['Inspect synthetic telemetry','Confirm intended operator action']});
 await monitor.incidents.open({id:'fixture-incident',dedupeKey:'fixture-browser-incident',title:'Synthetic incident <img src=x onerror=alert(1)>',severity:'warning',runbook:'fixture-runbook',metadata:{token:'fixture-secret'}});
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname==='/fixture/status'){res.setHeader('content-type','application/json');res.end(JSON.stringify({mode,requests,mutationRequests,clients:studio.clients.size,signalListeners:monitor.listenerCount('signal'),silences:monitor.alerts.silences.snapshot().silences.length,alertState:monitor.alerts.current().find(row=>row.ruleId==='fixture-alert')?.state,incidentState:monitor.incidents.get('fixture-incident')?.state}));return;}
   if(url.pathname==='/fixture/mode'&&req.method==='POST'){const next=url.searchParams.get('mode')||'seeded';if(!['seeded','error','empty','delayed'].includes(next)){res.writeHead(400);res.end('Unknown fixture mode');return;}mode=next;res.end('ok');return;}
   if(url.pathname==='/fixture/disconnect'&&req.method==='POST'){for(const c of [...studio.clients])studio._removeClient(c);res.end('ok');return;}
   if(url.pathname==='/fixture/client.js'){res.setHeader('content-type','application/javascript');res.end(harness);return;}
   if(url.pathname==='/'){res.writeHead(302,{location:'/monitor'});res.end();return;}
   if(url.pathname.startsWith('/monitor/api/')){requests++;if(['POST','DELETE'].includes(req.method))mutationRequests++;if(mode==='delayed'&&!url.pathname.endsWith('/stream')){await delay(500,undefined,{signal:lifetime.signal});if(res.destroyed)return;}if(mode==='error'&&!url.pathname.endsWith('/stream')){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:{message:'Fixture unavailable <script>alert(1)</script>'}}));return;}if(mode==='empty'&&url.pathname.endsWith('/traces')){res.setHeader('content-type','application/json');res.end('{"ok":true,"data":[]}');return;}}
   for(const route of routes){const match=route.regex.exec(url.pathname);if(match&&route.method===req.method){req.params=Object.fromEntries(route.keys.map((k,i)=>[k,decodeURIComponent(match[i+1])]));if(url.pathname==='/monitor'||url.pathname==='/monitor/'){const original=res.end;res.end=function(content,...args){return original.call(this,String(content).replace('</body>','<script type="module" src="/fixture/client.js"></script></body>'),...args)}}await route.handler(req,res);return;}}
   res.writeHead(404);res.end('Not found');
  }catch(error){if(!res.destroyed){res.writeHead(error.status||500,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:{message:error.message}}));}}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 let closed=false;return {url:`http://127.0.0.1:${server.address().port}/monitor`,monitor,studio,server,async close(){if(closed)return;closed=true;lifetime.abort();await studio.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await monitor.close();}};
}
const harness=`import { mountMonitorStudio } from '/monitor/assets/studio.js';
const app=document.querySelector('#rn-monitor-studio');const panel=document.createElement('section');panel.id='fixture-controls';panel.className='rn-panel';app.querySelector('.rn-sidebar').append(panel);panel.innerHTML='<h2>Local fixture controls</h2><button id="fixture-unmount">Unmount</button><button id="fixture-mount">Mount</button><button id="fixture-cycle">Cycle mount 20 times</button><button id="fixture-empty">Empty traces</button><button id="fixture-error">Simulate failure</button><button id="fixture-delayed">Delay requests 500 ms</button><button id="fixture-recover">Recover</button><button id="fixture-disconnect">Disconnect stream</button><output id="fixture-status">Mounted</output>';
const output=panel.querySelector('output');
panel.querySelector('#fixture-unmount').onclick=()=>{app.__monitorStudio?.destroy();output.textContent='Unmounted';};
panel.querySelector('#fixture-mount').onclick=()=>{mountMonitorStudio(app);output.textContent='Mounted';};
panel.querySelector('#fixture-cycle').onclick=async()=>{for(let i=0;i<20;i++){app.__monitorStudio?.destroy();mountMonitorStudio(app);}output.textContent='20 mount cycles complete';};
for(const [id,mode]of [['empty','empty'],['error','error'],['delayed','delayed'],['recover','seeded']])panel.querySelector('#fixture-'+id).onclick=async()=>{await fetch('/fixture/mode?mode='+mode,{method:'POST'});await app.__monitorStudio.navigate(mode==='empty'?'traces':'overview');output.textContent='Mode: '+mode;};
panel.querySelector('#fixture-disconnect').onclick=async()=>{await fetch('/fixture/disconnect',{method:'POST'});output.textContent='Stream interrupted; EventSource reconnects';};
`;
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const fixture=await createStudioFixture();console.log(fixture.url);
 const ttl=setTimeout(()=>fixture.close(),15*60_000);ttl.unref();
 process.stdin.resume();process.stdin.on('data',async data=>{if(String(data).includes('close')){clearTimeout(ttl);await fixture.close();process.stdin.pause();}});
}
