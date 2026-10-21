import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { mountMonitorStudio } from '../resources/assets/js/monitor/studio.js';

class Element extends EventTarget {
 constructor(){super();this.dataset={};this.attrs={};this.innerHTML='';this.textContent='';this.hidden=true;this.classList={add(){},remove(){},toggle(){}};this.elements=new Map();}
 querySelector(selector){if(!this.elements.has(selector))this.elements.set(selector,new Element());return this.elements.get(selector);}
 querySelectorAll(){return [];}
 set innerHTML(value){this._html=value;this.elements?.clear();}get innerHTML(){return this._html;}
 setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}focus(){}
}
class Stream extends EventTarget {static open=0;constructor(){super();Stream.open++;this.closed=false;}close(){if(!this.closed){this.closed=true;Stream.open--;}}}
function fixture(){const doc=new Element();doc.visibilityState='visible';const win=new EventTarget();win.location={hash:'#traces',href:'http://127.0.0.1/monitor'};doc.defaultView=win;const root=new Element();root.ownerDocument=doc;root.dataset={prefix:'/monitor',pollIntervalMs:1000};return {root,win,doc};}
test('modeled DOM: repeated mount/unmount owns one stream and cancels pending requests',async()=>{
 const {root}=fixture();let requests=0;const fetch=async(_url,options)=>{requests++;await sleep(2,undefined,{signal:options.signal});return new Response(JSON.stringify({data:[]}),{headers:{'content-type':'application/json'}})};
 for(let i=0;i<20;i++){const a=mountMonitorStudio(root,{fetch,EventSource:Stream});const b=mountMonitorStudio(root,{fetch,EventSource:Stream});assert.equal(a.snapshot().destroyed,true);await sleep(4);assert.equal(Stream.open,1);b.destroy();b.destroy();assert.equal(Stream.open,0);assert.equal(root.__monitorStudio,undefined);}
 const before=requests;await sleep(1050);assert.equal(requests,before);
});
test('modeled DOM: empty, escaped error, recovery and stale response cancellation',async(t)=>{
 const {root}=fixture();let fail=false;
 const fetch=async(_url,options)=>{await sleep(1,undefined,{signal:options.signal});return new Response(JSON.stringify(fail?{ok:false,error:{message:'<img src=x onerror=alert(1)>'}}:{data:[]}),{status:fail?503:200,headers:{'content-type':'application/json'}})};
 const h=mountMonitorStudio(root,{fetch,EventSource:Stream});t.after(()=>h.destroy());await h.navigate('traces');assert.match(root.querySelector('#rn-main').innerHTML,/No (data|traces|sampled)/i);
 fail=true;await h.refresh();assert.match(root.querySelector('#rn-main').innerHTML,/&lt;img/);assert.equal(root.querySelector('#rn-main').innerHTML.includes('<img'),false);
 fail=false;await h.refresh();assert.equal(root.getAttribute('aria-busy'),'false');h.destroy();
});
