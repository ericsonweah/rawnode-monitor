import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioFixture } from '../examples/studio-fixture.mjs';
test('actual loopback HTTP serves packaged Studio and all read views safely',async(t)=>{
 const fixture=await createStudioFixture();t.after(()=>fixture.close());
 const page=await fetch(fixture.url);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await page.text(),/Local fixture &lt;img/);
 for(const endpoint of ['overview','metrics','traces','signals','health','resources','alerts','slos','incidents','fleet','deployments','anomalies','synthetics','diagnostics','doctor']){
  const res=await fetch(`${fixture.url}/api/${endpoint}`);assert.equal(res.status,200,endpoint);const text=await res.text();assert.equal(text.includes('fixture-secret'),false,endpoint);
 }
 const script=await fetch(fixture.url+'/assets/studio.js');assert.equal(script.status,200);assert.match(await script.text(),/mountMonitorStudio/);
 const css=await fetch(fixture.url+'/assets/studio.css');assert.equal(css.status,200);
 const denied=await fetch(fixture.url+'/api/overview',{headers:{origin:'https://evil.invalid'}});assert.equal(denied.status,403);
 const disabled=await fetch(fixture.url+'/api/ingest',{method:'POST',body:'{}'});assert.equal(disabled.status,404);
});
