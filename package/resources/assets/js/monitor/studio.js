'use strict';

export function mountMonitorStudio(app = globalThis.document?.querySelector('#rn-monitor-studio'), options = {}) {
if (!app) throw new TypeError('Monitor Studio requires its root element.');
app.__monitorStudio?.destroy();
const ownerDocument = app.ownerDocument;
const window = ownerDocument.defaultView;
const location = window.location;
const document = { querySelector: (selector) => app.querySelector(selector), querySelectorAll: (selector) => app.querySelectorAll(selector), get visibilityState() { return ownerDocument.visibilityState; } };
const events = new AbortController();
let destroyed = false;
let renderAbort = new AbortController();
let pendingActions = 0;
let toastTimer = null;
const request = options.fetch || window.fetch.bind(window);
const prompt = (...args) => window.prompt(...args);
const config = Object.freeze({
  prefix: app?.dataset?.prefix || '/__rawnode/monitor',
  pollIntervalMs: Number(app?.dataset?.pollIntervalMs) || 3_000,
  service: app?.dataset?.service || 'rawnode',
  environment: app?.dataset?.environment || 'development',
  tokenRequired: app?.dataset?.tokenRequired === 'true',
});
const prefix = String(config.prefix).replace(/\/$/, '');
const state = { view: location.hash.slice(1) || 'overview', token: '', data: new Map(), connected: false, timer: null, stream: null };
const main = document.querySelector('#rn-main');
const toastNode = document.querySelector('#rn-toast');
const authModal = document.querySelector('#rn-auth');
const tokenInput = document.querySelector('#rn-token');

function headers(extra = {}) { const output = { accept: 'application/json', ...extra }; if (state.token) output.authorization = `Bearer ${state.token}`; return output; }
async function api(path, options = {}) {
  if (destroyed) throw new DOMException('Studio unmounted', 'AbortError');
  const activeSignal = options.signal || renderAbort.signal;
  const response = await request(`${prefix}${path}`, { ...options, signal: options.signal || renderAbort.signal, headers: headers(options.headers || {}) });
  activeSignal.throwIfAborted();
  if (destroyed) throw new DOMException('Studio unmounted', 'AbortError');
  if (response.status === 401) { showAuth(); throw new Error('Operator authorization required.'); }
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('json') ? await response.json() : await response.text();
  activeSignal.throwIfAborted();
  if (destroyed) throw new DOMException('Studio unmounted', 'AbortError');
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message || `Request failed (${response.status})`);
  return payload?.data ?? payload;
}
function showAuth() { authModal.hidden = false; tokenInput.focus(); }
function toast(message, kind = 'info') { toastNode.textContent = message; toastNode.dataset.kind = kind; toastNode.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastNode.classList.remove('visible'), 3200); }
function escape(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function formatNumber(value, digits = 2) { const number = Number(value); return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(number) : '—'; }
function bytes(value) { const number = Number(value); if (!Number.isFinite(number)) return '—'; const units = ['B','KiB','MiB','GiB','TiB']; let n = number; let index = 0; while (Math.abs(n) >= 1024 && index < units.length - 1) { n /= 1024; index++; } return `${formatNumber(n, index ? 2 : 0)} ${units[index]}`; }
function duration(value) { const ms = Number(value); if (!Number.isFinite(ms)) return '—'; if (ms < 1) return `${formatNumber(ms * 1000, 1)} μs`; if (ms < 1000) return `${formatNumber(ms, 2)} ms`; return `${formatNumber(ms / 1000, 2)} s`; }
function age(timestamp) { const delta = Date.now() - Number(timestamp || 0); if (!timestamp) return '—'; if (delta < 60_000) return `${Math.max(0, Math.floor(delta / 1000))}s ago`; if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`; if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`; return new Date(timestamp).toLocaleString(); }
function badge(value, kind = value) { return `<span class="rn-badge" data-kind="${escape(String(kind).toLowerCase())}">${escape(value)}</span>`; }
function panel(title, body, actions = '') { return `<section class="rn-panel"><header><h2>${escape(title)}</h2>${actions}</header><div class="rn-panel-body">${body}</div></section>`; }
function table(columns, rows, empty = 'No data available.') { if (!rows.length) return `<div class="rn-empty">${escape(empty)}</div>`; return `<div class="rn-table-wrap"><table><thead><tr>${columns.map((column) => `<th>${escape(column.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${typeof column.render === 'function' ? column.render(row) : escape(read(row, column.key))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
function read(value, path) { return String(path).split('.').reduce((current, part) => current?.[part], value); }
function json(value) { return `<pre class="rn-json">${escape(JSON.stringify(value, null, 2))}</pre>`; }
function heading(title, subtitle = '') { return `<div class="rn-heading"><div><h1>${escape(title)}</h1>${subtitle ? `<p>${escape(subtitle)}</p>` : ''}</div><span class="rn-updated">Updated ${new Date().toLocaleTimeString()}</span></div>`; }

// Each action belongs to the view that installed it. Navigation or unmount
// cancels its request and suppresses stale feedback; it cannot undo a mutation
// the server already accepted.
function bindAction(button, task, refresh = true) {
  const active = renderAbort;
  button?.addEventListener('click', async () => {
    if (destroyed || active.signal.aborted || button.disabled) return;
    button.disabled = true; pendingActions++;
    let pending = true;
    const release = () => {
      if (!pending) return;
      pending = false; pendingActions--;
      active.signal.removeEventListener('abort', release);
    };
    active.signal.addEventListener('abort', release, { once: true });
    try {
      const message = await task(active.signal);
      active.signal.throwIfAborted();
      if (destroyed) return;
      if (message) { toast(message, 'success'); if (refresh) await render(state.view); }
    } catch (error) {
      if (!destroyed && !active.signal.aborted) toast(error.message || 'Operator action failed.', 'error');
    } finally {
      release();
      if (!destroyed && !active.signal.aborted) button.disabled = false;
    }
  }, { signal: active.signal });
}

async function loadOverview() { const data = await api('/api/overview'); state.data.set('overview', data); return data; }
async function renderOverview() {
  const d = await loadOverview();
  document.querySelector('#rn-state').textContent = d.state;
  document.querySelector('#rn-identity').textContent = `${d.identity.service} · ${d.identity.environment}`;
  const system = d.system || {};
  const alertFiring = d.alertSummary?.firing || 0;
  const incidents = (d.incidentSummary?.open || 0) + (d.incidentSummary?.acknowledged || 0) + (d.incidentSummary?.mitigated || 0);
  const cards = [
    ['Health', d.health?.status || 'unknown', d.health?.ok ? 'healthy' : 'unhealthy'],
    ['CPU', `${formatNumber(system.cpu?.percent, 1)}%`, system.cpu?.percent > 85 ? 'warning' : 'healthy'],
    ['RSS memory', bytes(system.memory?.rss), 'neutral'],
    ['Event loop p99', duration(system.eventLoop?.p99Ms), system.eventLoop?.p99Ms > 200 ? 'warning' : 'healthy'],
    ['Open alerts', alertFiring, alertFiring ? 'warning' : 'healthy'],
    ['Open incidents', incidents, incidents ? 'critical' : 'healthy'],
    ['Fleet instances', d.fleet?.totalInstances || 0, 'neutral'],
    ['Pipeline queue', `${d.pipeline?.queue?.length || 0} / ${d.pipeline?.queue?.maxItems || 0}`, (d.pipeline?.queue?.length || 0) > (d.pipeline?.queue?.maxItems || 1) * .8 ? 'warning' : 'healthy'],
  ];
  const body = `${heading('Overview', 'Live operational state across this RawNode runtime.')}
  <div class="rn-cards">${cards.map(([label,value,kind]) => `<article class="rn-card" data-kind="${kind}"><span>${escape(label)}</span><strong>${escape(value)}</strong></article>`).join('')}</div>
  <div class="rn-grid two">${panel('Process', detailList({ PID: system.pid, Uptime: `${formatNumber(system.uptimeSeconds,0)}s`, Node: system.node, Platform: `${system.platform || ''} ${system.arch || ''}`, 'Heap used': bytes(system.memory?.heapUsed), 'External memory': bytes(system.memory?.external) }))}${panel('Current deployment', d.deployment ? detailList({ Version: d.deployment.version || '—', Commit: d.deployment.commit || '—', Build: d.deployment.buildId || '—', Status: d.deployment.status, Deployed: age(d.deployment.deployedAt) }) : '<div class="rn-empty">No deployment marker recorded.</div>')}</div>
  ${panel('Service topology', renderTopology(d.fleet))}
  ${panel('Resource health', renderResourceSummary(d.resourceSummary))}`;
  main.innerHTML = body;
}
function detailList(values) { return `<dl class="rn-details">${Object.entries(values).map(([key,value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value ?? '—')}</dd></div>`).join('')}</dl>`; }
function renderTopology(topology = {}) { const services = Object.entries(topology.services || {}); if (!services.length) return '<div class="rn-empty">Standalone runtime; no fleet peers observed.</div>'; return `<div class="rn-topology">${services.map(([name,item]) => `<article><strong>${escape(name)}</strong><span>${item.instances} instance${item.instances === 1 ? '' : 's'}</span><div>${badge(`${item.healthy || 0} healthy`,'healthy')} ${item.degraded ? badge(`${item.degraded} degraded`,'warning') : ''} ${item.unhealthy ? badge(`${item.unhealthy} unhealthy`,'critical') : ''}</div></article>`).join('')}</div>`; }
function renderResourceSummary(resources = {}) { return table([{label:'Resource',render:r=>`<strong>${escape(r.name)}</strong>`},{label:'State',render:r=>badge(r.value.ok?'healthy':'unhealthy',r.value.ok?'healthy':'critical')},{label:'Duration',render:r=>duration(r.value.durationMs)},{label:'Error',render:r=>escape(r.value.error?.message || '—')}],Object.entries(resources).map(([name,value])=>({name,value})),'No RawNode resources discovered.'); }

async function renderHealth() { const d = await api('/api/health?fresh=1'); main.innerHTML = `${heading('Health', 'Readiness, liveness, and dependency checks.')}<div class="rn-cards compact"><article class="rn-card" data-kind="${d.ok?'healthy':'critical'}"><span>Overall</span><strong>${escape(d.status)}</strong></article><article class="rn-card"><span>Checks</span><strong>${d.counts?.total || 0}</strong></article><article class="rn-card" data-kind="warning"><span>Degraded</span><strong>${d.counts?.degraded || 0}</strong></article><article class="rn-card" data-kind="critical"><span>Unhealthy</span><strong>${d.counts?.unhealthy || 0}</strong></article></div>${panel('Checks',table([{label:'Check',render:r=>`<strong>${escape(r.name)}</strong><small>${escape(r.kind)}</small>`},{label:'Status',render:r=>badge(r.status,r.status==='healthy'?'healthy':r.status==='degraded'?'warning':'critical')},{label:'Critical',render:r=>r.critical?'Yes':'No'},{label:'Duration',render:r=>duration(r.durationMs)},{label:'Message',render:r=>escape(r.message||'—')}],d.checks||[]))}`; }

async function renderMetrics() {
  const d = await api('/api/metrics'); const metrics = Object.values(d.metrics || {});
  main.innerHTML = `${heading('Metrics', `${metrics.length} instruments · ${d.series || 0} active series`)}<div class="rn-toolbar"><input id="rn-metric-filter" aria-label="Filter metrics" type="search" placeholder="Filter metrics"><button id="rn-copy-prom">Copy Prometheus</button></div><div id="rn-metric-list">${metricCards(metrics)}</div>`;
  document.querySelector('#rn-metric-filter').addEventListener('input', (event) => { const term = event.target.value.toLowerCase(); document.querySelector('#rn-metric-list').innerHTML = metricCards(metrics.filter((metric) => metric.name.toLowerCase().includes(term))); });
  bindAction(document.querySelector('#rn-copy-prom'), async (signal) => { const text = await api('/api/prometheus', { signal }); await window.navigator.clipboard.writeText(text); return 'Prometheus exposition copied.'; }, false);
}
function metricCards(metrics) { if (!metrics.length) return '<div class="rn-empty">No metrics match.</div>'; return metrics.map((metric) => `<details class="rn-metric"><summary><span><strong>${escape(metric.name)}</strong><small>${escape(metric.description || metric.type)}</small></span>${badge(`${metric.cardinality || 0} series`,'neutral')}</summary>${table([{label:'Labels',render:r=>Object.entries(r.labels||{}).map(([k,v])=>`<code>${escape(k)}=${escape(v)}</code>`).join(' ')||'—'},{label:'Value',render:r=>formatNumber(r.value??r.mean??r.sum??r.count,6)},{label:'Count',render:r=>formatNumber(r.count,0)},{label:'Min / Max',render:r=>r.min==null?'—':`${formatNumber(r.min,4)} / ${formatNumber(r.max,4)}`}],metric.series||[])}</details>`).join(''); }

async function renderTraces() {
  const traces = await api('/api/traces?limit=250');
  main.innerHTML = `${heading('Traces', 'Sampled distributed operations and latency waterfalls.')}<div class="rn-toolbar"><input id="rn-trace-filter" aria-label="Filter span names" type="search" placeholder="Filter span names"><select id="rn-trace-status" aria-label="Filter trace outcomes"><option value="">All outcomes</option><option value="error">Errors</option><option value="ok">OK</option></select></div><div id="rn-traces">${traceTable(traces)}</div><div id="rn-trace-detail"></div>`;
  const apply = () => { const term=document.querySelector('#rn-trace-filter').value.toLowerCase(); const status=document.querySelector('#rn-trace-status').value; document.querySelector('#rn-traces').innerHTML=traceTable(traces.filter(s=>(!term||s.name.toLowerCase().includes(term))&&(!status||s.status?.code===status))); bindTraceRows(); };
  document.querySelector('#rn-trace-filter').addEventListener('input',apply); document.querySelector('#rn-trace-status').addEventListener('change',apply); bindTraceRows();
}
function traceTable(rows) { return table([{label:'Operation',render:r=>`<button class="rn-link rn-trace-open" data-trace="${escape(r.traceId)}"><strong>${escape(r.name)}</strong></button><small>${escape(r.traceId.slice(0,16))}…</small>`},{label:'Kind',render:r=>badge(r.kind,'neutral')},{label:'Status',render:r=>badge(r.status?.code||'unset',r.status?.code==='error'?'critical':'healthy')},{label:'Duration',render:r=>duration(r.durationMs)},{label:'Started',render:r=>age(Number(BigInt(r.startTimeUnixNano)/1000000n))}],rows,'No sampled spans found.'); }
function bindTraceRows() { document.querySelectorAll('.rn-trace-open').forEach(button => bindAction(button, (signal) => showTrace(button.dataset.trace, signal), false)); }
async function showTrace(id, signal) { const spans=await api(`/api/traces/${encodeURIComponent(id)}`, { signal }); const max=Math.max(...spans.map(s=>s.durationMs||0),1); document.querySelector('#rn-trace-detail').innerHTML=panel(`Trace ${id}`,`<div class="rn-waterfall">${spans.map((span,index)=>`<article><div><strong>${escape(span.name)}</strong><small>${escape(span.kind)} · ${duration(span.durationMs)}</small></div><progress class="rn-bar" aria-label="Relative span duration" max="${max}" value="${Math.max(0,span.durationMs||0)}"></progress>${index===0?'':`<span class="rn-parent">↳ ${escape(span.parentSpanId||'root')}</span>`}</article>`).join('')}</div>${json(spans)}`); }

async function renderResources() { const d=await api('/api/resources'); const latest=d.latest||{}; main.innerHTML=`${heading('Resources','Health and native metrics from RawNode modules.')}${Object.keys(latest).length?Object.entries(latest).map(([name,value])=>panel(name,`<div class="rn-resource-head">${badge(value.error?'unhealthy':value.health?.ok===false?'unhealthy':'healthy',value.error||value.health?.ok===false?'critical':'healthy')}<span>${duration(value.durationMs)}</span></div>${json(value)}`)).join(''):'<div class="rn-empty">No resource snapshots yet.</div>'}`; }

async function renderAlerts() { const d=await api('/api/alerts?limit=250'); main.innerHTML=`${heading('Alerts','Rule state, transitions, silences, and operator actions.')}<div class="rn-toolbar"><button id="rn-create-silence">Create silence</button></div>${panel('Current state',table([{label:'Rule',render:r=>`<strong>${escape(r.rule?.name||r.ruleId)}</strong><small>${escape(r.rule?.severity||'')}</small>`},{label:'State',render:r=>badge(r.state,r.state==='firing'?'critical':r.state==='pending'?'warning':r.state==='resolved'?'healthy':'neutral')},{label:'Value',render:r=>formatNumber(r.lastValue,4)},{label:'Last evaluation',render:r=>age(r.lastEvaluationAt)},{label:'Action',render:r=>r.state==='firing'?`<button class="rn-alert-ack" data-id="${escape(r.ruleId)}">Acknowledge</button>`:'—'}],d.current||[]))}${panel('Silences',table([{label:'Reason',render:r=>escape(r.reason||'—')},{label:'Rules',render:r=>(r.ruleIds||[]).map(x=>`<code>${escape(x)}</code>`).join(' ')||'All'},{label:'Expires',render:r=>age(r.endsAt)},{label:'Action',render:r=>`<button class="rn-silence-delete" data-id="${escape(r.id)}">Remove</button>`}],d.silences?.silences||[]))}${panel('Recent transitions',table([{label:'Rule',render:r=>escape(r.rule?.name||r.ruleId)},{label:'Transition',render:r=>`${escape(r.previous)} → ${badge(r.state,r.state==='firing'?'critical':'neutral')}`},{label:'Value',render:r=>formatNumber(r.value,4)},{label:'Time',render:r=>age(r.timestamp)}],d.history||[]))}`; bindAlertActions(); }
function bindAlertActions() {
  document.querySelectorAll('.rn-alert-ack').forEach(button => bindAction(button, async (signal) => {
    await api(`/api/alerts/${encodeURIComponent(button.dataset.id)}/acknowledge`, { method: 'POST', signal });
    return 'Alert acknowledged.';
  }));
  document.querySelectorAll('.rn-silence-delete').forEach(button => bindAction(button, async (signal) => {
    await api(`/api/silences/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE', signal });
    return 'Silence removed.';
  }));
  bindAction(document.querySelector('#rn-create-silence'), async (signal) => {
    const ruleId = prompt('Rule ID to silence (empty means all rules):', '');
    if (ruleId === null) return;
    const durationInput = prompt('Silence duration in minutes:', '60');
    if (durationInput === null) return;
    const minutes = Number(durationInput);
    if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isSafeInteger(minutes * 60_000)) throw new Error('Silence duration must be a positive number of minutes (whole milliseconds).');
    const reason = prompt('Reason:', 'Operator maintenance');
    if (reason === null) return;
    await api('/api/silences', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ruleIds: ruleId.trim() ? [ruleId.trim()] : [], durationMs: minutes * 60_000, reason: reason.trim() || 'Operator maintenance' }) });
    return 'Silence created.';
  });
}

async function renderSlos(){const d=await api('/api/slos');const latest=d.latest||{};main.innerHTML=`${heading('Service Level Objectives','Compliance, error budgets, and burn rates.')}${panel('Objectives',table([{label:'SLO',render:r=>`<strong>${escape(r.name)}</strong><small>${formatNumber(r.objective*100,3)}% target</small>`},{label:'Achieved',render:r=>badge(`${formatNumber(r.achieved*100,3)}%`,r.compliance?'healthy':'critical')},{label:'Error budget',render:r=>`${formatNumber(r.errorBudget?.remainingRatio*100,2)}% remaining`},{label:'Burn rate',render:r=>badge(`${formatNumber(r.burnRate,2)}×`,r.burnRate>6?'critical':r.burnRate>1?'warning':'healthy')},{label:'Window',render:r=>duration(r.windowMs)}],Object.values(latest),'No SLO definitions registered.'))}`;}

async function renderIncidents(){const d=await api('/api/incidents?limit=250');main.innerHTML=`${heading('Incidents','Correlated operational timelines and runbooks.')}${panel('Incidents',table([{label:'Incident',render:r=>`<strong>${escape(r.title)}</strong><small>${escape(r.id)}</small>`},{label:'Severity',render:r=>badge(r.severity,r.severity==='critical'?'critical':'warning')},{label:'State',render:r=>badge(r.state,r.state==='resolved'||r.state==='closed'?'healthy':'critical')},{label:'Updated',render:r=>age(r.updatedAt)},{label:'Actions',render:r=>incidentActions(r)}],d.incidents||[],'No incidents recorded.'))}<div id="rn-incident-detail"></div>`;bindIncidentActions(d.incidents||[]);}
function incidentActions(r){return `<button class="rn-incident-view" data-id="${escape(r.id)}">View</button> ${r.state==='open'?`<button class="rn-incident-ack" data-id="${escape(r.id)}">Acknowledge</button>`:''} ${!['resolved','closed'].includes(r.state)?`<button class="rn-incident-resolve" data-id="${escape(r.id)}">Resolve</button>`:''}`;}
function bindIncidentActions(rows) {
  const byId = new Map(rows.map(row => [row.id, row]));
  document.querySelectorAll('.rn-incident-view').forEach(button => button.addEventListener('click', () => { const row = byId.get(button.dataset.id); document.querySelector('#rn-incident-detail').innerHTML = panel(row.title, `${row.runbookDefinition ? `<div class="rn-runbook"><h3>${escape(row.runbookDefinition.title)}</h3><p>${escape(row.runbookDefinition.description)}</p><ol>${row.runbookDefinition.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol></div>` : ''}${json(row)}`); }, { signal: renderAbort.signal }));
  document.querySelectorAll('.rn-incident-ack').forEach(button => bindAction(button, async (signal) => {
    await api(`/api/incidents/${encodeURIComponent(button.dataset.id)}/acknowledge`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: '{}' });
    return 'Incident acknowledged.';
  }));
  document.querySelectorAll('.rn-incident-resolve').forEach(button => bindAction(button, async (signal) => {
    const message = prompt('Resolution note:', 'Issue mitigated');
    if (message === null) return;
    await api(`/api/incidents/${encodeURIComponent(button.dataset.id)}/resolve`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: message.trim() || 'Resolved' }) });
    return 'Incident resolved.';
  }));
}

async function renderFleet(){const d=await api('/api/fleet');main.innerHTML=`${heading('Fleet','Cross-process and cross-host runtime membership.')}${panel('Topology',renderTopology(d.topology))}${panel('Instances',table([{label:'Service',render:r=>`<strong>${escape(r.service||'unknown')}</strong><small>${escape(r.instanceId)}</small>`},{label:'State',render:r=>badge(r.state||'unknown',r.health?.ok===false?'critical':'healthy')},{label:'Host / PID',render:r=>`${escape(r.host||'—')} / ${escape(r.pid||'—')}`},{label:'Region',render:r=>escape(r.region||'—')},{label:'Version',render:r=>escape(r.version||'—')},{label:'Last seen',render:r=>age(r.lastSeenAt)}],d.instances||[]))}`;}
async function renderDeployments(){const d=await api('/api/deployments?limit=250');main.innerHTML=`${heading('Deployments','Release markers correlated with operational changes.')}${panel('Timeline',table([{label:'Version',render:r=>`<strong>${escape(r.version||'—')}</strong><small>${escape(r.commit||r.buildId||r.id)}</small>`},{label:'Status',render:r=>badge(r.status,r.status==='failed'?'critical':r.status==='rolled_back'?'warning':'healthy')},{label:'Strategy',render:r=>escape(r.strategy||'—')},{label:'Actor',render:r=>escape(r.actor||'—')},{label:'Time',render:r=>age(r.deployedAt)}],d||[]))}`;}
async function renderDiagnostics(){const doctor=await api('/api/doctor');main.innerHTML=`${heading('Diagnostics','Self-observability, configuration verification, and support bundles.')}<div class="rn-cards compact"><article class="rn-card" data-kind="${doctor.ok?'healthy':'critical'}"><span>Doctor</span><strong>${doctor.ok?'Passed':'Failed'}</strong></article><article class="rn-card"><span>Checks</span><strong>${doctor.summary?.total||0}</strong></article><article class="rn-card" data-kind="critical"><span>Failures</span><strong>${doctor.summary?.failed||0}</strong></article><article class="rn-card" data-kind="warning"><span>Warnings</span><strong>${doctor.summary?.warnings||0}</strong></article></div><div class="rn-toolbar"><button id="rn-bundle">Create diagnostics bundle</button><button id="rn-full-diag">Load full snapshot</button></div>${panel('Doctor checks',table([{label:'Check',render:r=>`<strong>${escape(r.name)}</strong>`},{label:'Result',render:r=>badge(r.ok?'pass':r.severity,r.ok?'healthy':r.severity==='error'?'critical':'warning')},{label:'Details',render:r=>`<details><summary>Inspect</summary>${json(r.details)}</details>`}],doctor.checks||[]))}<div id="rn-diagnostics-full"></div>`;bindAction(document.querySelector('#rn-bundle'),async(signal)=>{const result=await api('/api/diagnostics/bundle',{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({reason:'studio-manual'})});return `Bundle created: ${result.filename}`;},false);bindAction(document.querySelector('#rn-full-diag'),async(signal)=>{const d=await api('/api/diagnostics?signals=0',{signal});document.querySelector('#rn-diagnostics-full').innerHTML=panel('Runtime diagnostics',json(d));},false);}

const renderers={overview:renderOverview,health:renderHealth,metrics:renderMetrics,traces:renderTraces,resources:renderResources,alerts:renderAlerts,slos:renderSlos,incidents:renderIncidents,fleet:renderFleet,deployments:renderDeployments,diagnostics:renderDiagnostics};
async function render(view=state.view){
  if (destroyed) return;
  if (!Object.hasOwn(renderers, view)) view = 'overview';
  renderAbort.abort(); renderAbort = new AbortController();
  const active = renderAbort;
  state.view=view;location.hash=view;
  document.querySelectorAll('#rn-nav button').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
  app.setAttribute('aria-busy','true');
  main.innerHTML='<section class="rn-loading"><div class="rn-spinner"></div><p>Loading…</p></section>';
  try{await renderers[view]();if(!destroyed&&!active.signal.aborted)app.setAttribute('aria-busy','false');}
  catch(error){if(destroyed||active.signal.aborted)return;app.setAttribute('aria-busy','false');main.innerHTML=`${heading('Monitor Studio')}<div class="rn-error"><strong>Unable to load ${escape(view)}.</strong><p>${escape(error.message)}</p><button id="rn-retry">Retry</button></div>`;document.querySelector('#rn-retry')?.addEventListener('click',()=>render(view),{signal:events.signal});toast(error.message,'error');}
}

function connectStream(){
  if (destroyed) return;
  state.stream?.close?.();
  state.stream=null;
  // Native EventSource cannot attach the bearer token used by production Monitor Studio.
  // Authenticated sessions therefore use bounded polling rather than leaking tokens in URLs.
  if(config.tokenRequired){setConnected(false);return;}
  try{
    const url=new URL(`${prefix}/api/stream`,location.href);
    state.stream=new (options.EventSource || window.EventSource)(url);
    state.stream.addEventListener('ready',()=>setConnected(true));
    state.stream.addEventListener('signal',(event)=>{setConnected(true);let signal;try{signal=JSON.parse(event.data);}catch{return;}if(['alert','incident','deployment','health'].includes(signal.kind)&&state.view==='overview')scheduleRefresh();});
    state.stream.onerror=()=>setConnected(false);
  }catch{setConnected(false);}
}
function setConnected(value){state.connected=value;document.querySelector('#rn-live-dot').classList.toggle('connected',value);if(!value)document.querySelector('#rn-state').textContent='Polling';}
function scheduleRefresh(){clearTimeout(state._refresh);state._refresh=setTimeout(()=>render(state.view),500);}
function startPolling(){clearInterval(state.timer);state.timer=setInterval(()=>{if(document.visibilityState==='visible'&&app.getAttribute('aria-busy')!=='true'&&pendingActions===0)render(state.view);},Math.max(1000,Number(config.pollIntervalMs)||3000));}

document.querySelector('#rn-nav').addEventListener('click',(event)=>{const button=event.target.closest('button[data-view]');if(button)render(button.dataset.view);},{signal:events.signal});
document.querySelector('#rn-refresh').addEventListener('click',()=>render(state.view),{signal:events.signal});
document.querySelector('#rn-auth-form').addEventListener('submit',(event)=>{event.preventDefault();state.token=tokenInput.value;authModal.hidden=true;connectStream();render(state.view);},{signal:events.signal});
window.addEventListener('hashchange',()=>{const view=location.hash.slice(1)||'overview';if(view!==state.view)render(view);},{signal:events.signal});
ownerDocument.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')render(state.view);},{signal:events.signal});
const handle = Object.freeze({
  refresh: () => render(state.view),
  navigate: (view) => render(view),
  snapshot: () => ({ destroyed, view: state.view, connected: state.connected, streaming: !!state.stream, polling: state.timer !== null }),
  destroy() {
    if (destroyed) return;
    destroyed = true; events.abort(); renderAbort.abort();
    clearInterval(state.timer); state.timer = null;
    clearTimeout(state._refresh); clearTimeout(toastTimer);
    state.stream?.close(); state.stream = null; state.token = '';
    app.setAttribute('aria-busy', 'false');
    if (app.__monitorStudio === handle) delete app.__monitorStudio;
  }
});
app.__monitorStudio = handle;
window.addEventListener('pagehide', () => handle.destroy(), { signal: events.signal });
connectStream();startPolling();render(state.view);
return handle;
}

if (globalThis.document?.querySelector('#rn-monitor-studio')) mountMonitorStudio();
