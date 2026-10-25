import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Wrap an explicitly selected package fixture without changing authorization.
// Only synthetic routing/fetch metadata and explicitly instrumented fixture prompts
// are recorded; no bearer headers or telemetry request bodies.
const controls = process.argv.includes('--controls');
const args = process.argv.slice(2).filter((arg) => arg !== '--controls');
const fixturePath = resolve(args[0] || 'package/examples/studio-fixture.mjs');
const logPath = resolve(args[1] || 'readiness-2026-10-24/browser-request-metadata.jsonl');
const { createStudioFixture } = await import(pathToFileURL(fixturePath));
const fixture = await createStudioFixture();
const fixtureHandlers = fixture.server.listeners('request');
for (const handler of fixtureHandlers) fixture.server.removeListener('request', handler);
const promptEvents = [];
const promptLogPath = `${logPath}.prompts.jsonl`;
fixture.server.on('request', async (req, res) => {
  const requestPath = new URL(req.url, fixture.url).pathname;
  if (controls && requestPath === '/fixture/client.js') {
    const end = res.end;
    res.end = function (content, ...rest) {
      return end.call(this, `${content}${browserControls}`, ...rest);
    };
  }
  const headers = {};
  for (const name of ['host', 'origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user', 'user-agent']) {
    if (req.headers[name] !== undefined) headers[name] = req.headers[name];
  }
  const record = { at: new Date().toISOString(), method: req.method, path: requestPath, headers };
  appendFileSync(logPath, `${JSON.stringify(record)}\n`);
  if (controls && requestPath === '/fixture/prompt-events') {
    try {
      const auth = await fixture.studio.authorizer.check(req, { mutate: req.method === 'POST' });
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      if (!auth.ok) { res.statusCode = auth.status; res.end(JSON.stringify({ ok: false, code: auth.code })); return; }
      if (req.method === 'POST') {
        const chunks = []; let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 4096) { res.statusCode = 413; res.end('{"ok":false}'); return; }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const known = ['Rule ID to silence (empty means all rules):', 'Silence duration in minutes:', 'Reason:', 'Resolution note:'].includes(input.message);
        const event = { receivedAt: new Date().toISOString(), sequence: Number(input.sequence) || 0, message: known ? input.message : '[Other prompt]', result: known ? (input.result === null ? null : String(input.result).slice(0, 256)) : '[omitted]' };
        promptEvents.push(event); if (promptEvents.length > 200) promptEvents.shift();
        appendFileSync(promptLogPath, `${JSON.stringify(event)}\n`);
        res.end('{"ok":true}'); return;
      }
      if (req.method === 'GET') { res.end(JSON.stringify(promptEvents)); return; }
      res.statusCode = 405; res.end('{"ok":false}'); return;
    } catch { if (!res.writableEnded) { res.statusCode = 400; res.end('{"ok":false}'); } return; }
  }
  for (const handler of fixtureHandlers) await handler.call(fixture.server, req, res);
});
console.log(JSON.stringify({ url: fixture.url, fixturePath, logPath, promptLogPath, controls }));
const ttl = setTimeout(() => close(), 15 * 60_000);
ttl.unref();
let closing;
function close() {
  return closing ||= (async () => {
    clearTimeout(ttl);
    await fixture.close();
    process.stdin.pause();
  })();
}
process.stdin.resume();
process.stdin.on('data', (data) => { if (String(data).includes('close')) void close(); });

// This remains an external same-origin script, under the fixture's existing CSP.
// The imported mount function and fixture panel are declared in its original module.
const browserControls = `
const nativePrompt=window.prompt.bind(window);
const promptHistory=[];
window.prompt=(...args)=>{
 const result=nativePrompt(...args);
 const event={sequence:promptHistory.length+1,message:String(args[0]||''),result};
 promptHistory.push(event);
 void fetch('/fixture/prompt-events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event),keepalive:true}).catch(()=>{});
 return result;
};
const promptButton=document.createElement('button');
promptButton.id='fixture-prompts';promptButton.textContent='Inspect native prompt returns';
panel.append(promptButton);
promptButton.onclick=()=>{output.textContent=JSON.stringify(promptHistory);};
const pollingButton=document.createElement('button');
pollingButton.id='fixture-polling';pollingButton.textContent='Polling fallback';
panel.append(pollingButton);
pollingButton.onclick=()=>{
 mountMonitorStudio(app,{EventSource:class{constructor(){throw new Error('Synthetic EventSource unavailable');}}});
 output.textContent='EventSource unavailable; using native fetch polling';
};
const statusButton=document.createElement('button');
statusButton.id='fixture-inspect';statusButton.textContent='Inspect fixture status';
panel.append(statusButton);
statusButton.onclick=async()=>{
 const response=await fetch('/fixture/status');
 output.textContent=JSON.stringify({server:await response.json(),client:app.__monitorStudio?.snapshot()||{destroyed:true}});
};
`;
