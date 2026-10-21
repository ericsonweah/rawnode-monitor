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

test('actual loopback HTTP fixture exposes synthetic operator state and preserves mutation authorization', async t => {
 const fixture = await createStudioFixture(); t.after(() => fixture.close());
 const origin = new URL(fixture.url).origin;
 const state = async () => (await fetch(`${origin}/fixture/status`)).json();
 const initial = await state(); assert.equal(initial.silences, 0); assert.equal(initial.mutationRequests, 0); assert.equal(initial.alertState, 'firing'); assert.equal(initial.incidentState, 'open');
 const denied = await fetch(`${fixture.url}/api/incidents/fixture-incident/resolve`, { method: 'POST', headers: { origin: 'https://evil.invalid', 'content-type': 'application/json' }, body: '{"message":"Must be rejected"}' });
 assert.equal(denied.status, 403); assert.equal((await state()).incidentState, 'open');
 const silence = await fetch(`${fixture.url}/api/silences`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{"ruleIds":[],"durationMs":60000,"reason":"Synthetic all-rules maintenance"}' });
 assert.equal(silence.status, 200); assert.deepEqual((await silence.json()).data.ruleIds, []); assert.equal((await state()).silences, 1);
 await fetch(`${origin}/fixture/mode?mode=error`, { method: 'POST' });
 const rejected = await fetch(`${fixture.url}/api/incidents/fixture-incident/resolve`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
 assert.equal(rejected.status, 503); assert.equal((await state()).incidentState, 'open');
 await fetch(`${origin}/fixture/mode?mode=seeded`, { method: 'POST' });
 const resolved = await fetch(`${fixture.url}/api/incidents/fixture-incident/resolve`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{"message":"Intentional synthetic resolution"}' });
 assert.equal(resolved.status, 200); assert.equal((await state()).incidentState, 'resolved');
 const invalid = await fetch(`${origin}/fixture/mode?mode=unknown`, { method: 'POST' }); assert.equal(invalid.status, 400);
});
