import { appendFileSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

// External qualification instrumentation. Installed Monitor JS/CSS stay unchanged.
// Every native prompt is delegated unchanged; no generated answer or dialog stub.
const [packageArg, evidenceArg, session, mode = 'local'] = process.argv.slice(2);
if (!packageArg || !evidenceArg || !/^[a-zA-Z0-9-]+$/.test(session || '') || !['local', 'token'].includes(mode)) throw Error('Usage: node native-browser-fixture.mjs ABS_INSTALLED_PACKAGE ABS_EVIDENCE_DIR UNIQUE_SESSION local|token');
const root = resolve(packageArg), evidence = resolve(evidenceArg);
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const log = (event) => appendFileSync(resolve(evidence, `${session}.jsonl`), JSON.stringify({ at: new Date().toISOString(), session, ...event }) + '\n', { mode: 0o600 });
const { createStudioFixture } = await import(pathToFileURL(resolve(root, 'examples/studio-fixture.mjs')));
const { MonitorStudioAuthorizer } = await import(pathToFileURL(resolve(root, 'src/studio/MonitorStudioAuthorizer.js')));
const fixture = await createStudioFixture();
const handlers = fixture.server.listeners('request');
for (const handler of handlers) fixture.server.removeListener('request', handler);
const boundary = new MonitorStudioAuthorizer({ localOnly: true });
const syntheticToken = 'qualification-only-token';
const tokenAuth = new MonitorStudioAuthorizer({ localOnly: true, token: syntheticToken });
const cookie = randomBytes(24).toString('hex');
const hasSession = (req) => String(req.headers.cookie || '').split(';').map(v => v.trim()).includes(`qualificationSession=${cookie}`);
if (mode === 'token') {
  // Supported custom authorizer: authenticated host session protects shell/assets;
  // API also requires a synthetic bearer token supplied by Studio's memory-only UI.
  fixture.studio.authorizer.token = syntheticToken;
  fixture.studio.authorizer.check = async (req, options = {}) => {
    const check = await boundary.check(req, options); if (!check.ok) return check;
    if (!hasSession(req)) return { ok: false, status: 401, code: 'FIXTURE_SESSION', message: 'Synthetic host session required.' };
    if (req.url.startsWith('/monitor/api/')) return tokenAuth.check(req, options);
    return { ok: true, actor: { id: 'synthetic-operator' }, method: 'fixture-session' };
  };
}
let activeCase = 'not-selected', mutations = 0, failNext = false, closing;
const state = () => ({ mutations, clients: fixture.studio.clients.size, signalListeners: fixture.monitor.listenerCount('signal'), silences: fixture.monitor.alerts.silences.snapshot().silences.length, alertState: fixture.monitor.alerts.current().find(row => row.ruleId === 'fixture-alert')?.state, incidentState: fixture.monitor.incidents.get('fixture-incident')?.state });
async function body(req, limit = 65536) { let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; if (size > limit) throw Error('Bounded body exceeded'); chunks.push(chunk); } return Buffer.concat(chunks).toString('utf8'); }
const send = (res, status, text, type = 'text/plain') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'" }); res.end(text); };
fixture.server.on('request', async (req, res) => {
  try {
    const path = new URL(req.url, fixture.url).pathname;
    const check = await boundary.check(req, { mutate: !['GET', 'HEAD'].includes(req.method) });
    if (!check.ok) { send(res, check.status, check.code); return; }
    res.setHeader('cache-control', 'no-store');
    log({ kind: 'request', case: activeCase, method: req.method, path, hasBearer: !!req.headers.authorization, hasSession: hasSession(req) });
    if (path === '/qualification/session' && req.method === 'POST') {
      if (new URLSearchParams(await body(req, 256)).get('code') !== 'local-operator') { send(res, 403, 'Use the synthetic code local-operator'); return; }
      res.setHeader('set-cookie', `qualificationSession=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
      res.writeHead(303, { location: '/monitor' }); res.end(); return;
    }
    if (path === '/qualification/control') { send(res, 200, `<!doctype html><html><head><meta charset="utf-8"><title>${session} native control</title></head><body><h1>${session} native control</h1><p>Known-simple controller diagnosis, separate from Studio.</p><label>Case ID <input id="case" value="diagnostic-cancel"></label><button id="arm">Record intent</button><button id="prompt">Open native prompt</button><button id="plain">Ordinary button</button><output id="out">Ready</output><p><a href="/monitor">Open Studio</a></p><form method="post" action="/qualification/session"><label>Synthetic host session code <input name="code" value="local-operator"></label><button>Establish synthetic host session</button></form><script src="/qualification/control.js"></script></body></html>`, 'text/html'); return; }
    if (path === '/qualification/control.js') { send(res, 200, `const out=document.querySelector('#out');async function record(e){const r=await fetch('/qualification/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(e)});out.textContent=await r.text();}document.querySelector('#arm').onclick=()=>record({kind:'intent',case:document.querySelector('#case').value});document.querySelector('#plain').onclick=()=>record({kind:'ordinary-click'});document.querySelector('#prompt').onclick=()=>{const result=window.prompt('Native qualification control: cancel, empty, or synthetic text','');void record({kind:'control-prompt',result});};`, 'application/javascript'); return; }
    if (path === '/qualification/event' && req.method === 'POST') {
      const input = JSON.parse(await body(req));
      if (input.kind === 'intent') activeCase = String(input.case).slice(0, 120);
      // Fixture-only content is bounded; tokens/headers/storage contents are never recorded.
      log({ kind: 'browser-event', case: activeCase, input, server: state() });
      send(res, 200, JSON.stringify({ session, case: activeCase, server: state() }), 'application/json'); return;
    }
    if (path === '/qualification/status') { send(res, 200, JSON.stringify({ session, mode, case: activeCase, server: state() }), 'application/json'); return; }
    if (path === '/qualification/fail-next' && req.method === 'POST') { failNext = true; send(res, 200, 'Armed'); return; }
    if (mode === 'token' && path.startsWith('/fixture/') && !hasSession(req)) { send(res, 401, 'Synthetic host session required'); return; }
    if (path.startsWith('/monitor/api/') && ['POST', 'DELETE'].includes(req.method)) {
      mutations++;
      const before = state();
      res.once('finish', () => log({ kind: 'mutation', case: activeCase, path, status: res.statusCode, before, after: state() }));
      if (failNext) { failNext = false; send(res, 503, JSON.stringify({ ok: false, error: { message: 'Synthetic failure <script>unsafe</script>' } }), 'application/json'); return; }
    }
    if (path === '/fixture/client.js' || path === '/monitor' || path === '/monitor/') {
      const end = res.end;
      res.end = function(content, ...rest) {
        const amended = path === '/fixture/client.js' ? String(content) + controls : String(content).replace(/<title>[^<]*<\/title>/, `<title>${session} Monitor Studio</title>`);
        return end.call(this, amended, ...rest);
      };
    }
    for (const handler of handlers) await handler.call(fixture.server, req, res);
  } catch (error) { log({ kind: 'fixture-error', message: error.message }); if (!res.headersSent) send(res, 500, 'Qualification fixture failure'); else res.destroy(); }
});
const files = ['examples/studio-fixture.mjs','resources/assets/js/monitor/studio.js','resources/assets/css/monitor/studio.css','src/studio/MonitorStudioPage.js'];
const receipt = { session, mode, url: fixture.url, controlUrl: new URL('/qualification/control', fixture.url).href, root, pid: process.pid, node: process.version, execPath: process.execPath, files: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')])), baseline: state(), ttlMs: 15 * 60_000 };
writeFileSync(resolve(evidence, `${session}-input.json`), JSON.stringify(receipt, null, 2), { mode: 0o600 });
log({ kind: 'ready', ...receipt }); console.log(JSON.stringify(receipt));
const ttl = setTimeout(() => void close('ttl'), 15 * 60_000); ttl.unref();
function close(reason) { return closing ||= (async () => { clearTimeout(ttl); log({ kind: 'closing', reason, server: state() }); await fixture.close(); process.stdin.pause(); log({ kind: 'closed', reason, server: state(), listening: fixture.server.listening }); })(); }
process.stdin.resume(); process.stdin.on('data', data => { if (String(data).includes('close')) void close('stdin'); });

const controls = `
const qualificationErrors=[];
window.addEventListener('error',event=>qualificationErrors.push({kind:'error',message:event.message}));
window.addEventListener('unhandledrejection',event=>qualificationErrors.push({kind:'rejection',message:String(event.reason)}));
document.addEventListener('securitypolicyviolation',event=>qualificationErrors.push({kind:'CSP',directive:event.violatedDirective}));
async function receipt(event){const r=await fetch('/qualification/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event),keepalive:true});return r.json();}
const nativePrompt=window.prompt.bind(window);let promptSequence=0;
window.prompt=(...args)=>{const result=nativePrompt(...args);void receipt({kind:'native-prompt',sequence:++promptSequence,message:String(args[0]),result});return result;};
const caseLabel=document.createElement('label');caseLabel.textContent='Qualification case ID';
const caseInput=document.createElement('input');caseInput.value='cancel-rule';caseInput.id='qualification-case';caseLabel.append(caseInput);panel.append(caseLabel);
const arm=document.createElement('button');arm.textContent='Record case intent';panel.append(arm);arm.onclick=async()=>{output.textContent=JSON.stringify(await receipt({kind:'intent',case:caseInput.value}));};
const inspect=document.createElement('button');inspect.textContent='Record browser observation';panel.append(inspect);inspect.onclick=async()=>{output.textContent=JSON.stringify(await receipt({kind:'observation',userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,client:app.__monitorStudio?.snapshot()||{destroyed:true},mainText:app.querySelector('main')?.innerText?.slice(0,16000),errors:qualificationErrors,images:app.querySelectorAll('img').length,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage)}));};
const fail=document.createElement('button');fail.textContent='Fail next synthetic mutation';panel.append(fail);fail.onclick=async()=>{await fetch('/qualification/fail-next',{method:'POST'});output.textContent='Next mutation fails';};
`;
