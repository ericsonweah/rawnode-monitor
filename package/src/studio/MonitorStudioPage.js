'use strict';

export function renderMonitorStudioPage(options = {}) {
  const prefix = String(options.prefix || '/__rawnode/monitor').replace(/\/$/, '');
  const service = options.service || 'RawNode';
  const environment = options.environment || 'development';
  const pollIntervalMs = Math.max(1_000, Number(options.pollIntervalMs) || 3_000);
  const tokenRequired = options.tokenRequired === true;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="robots" content="noindex,nofollow"><title>RawNode Monitor Studio</title><link rel="stylesheet" href="${escapeAttr(prefix)}/assets/studio.css"></head>
<body><div id="rn-monitor-studio" class="rn-app" aria-busy="true" data-prefix="${escapeAttr(prefix)}" data-poll-interval-ms="${pollIntervalMs}" data-service="${escapeAttr(service)}" data-environment="${escapeAttr(environment)}" data-token-required="${tokenRequired ? 'true' : 'false'}">
<header class="rn-topbar"><div class="rn-brand"><span class="rn-mark">RN</span><div><strong>Monitor Studio</strong><small id="rn-identity">${escapeHtml(service)}</small></div></div><div class="rn-status"><span id="rn-live-dot" class="rn-dot"></span><span id="rn-state">Connecting</span><button id="rn-refresh" type="button">Refresh</button></div></header>
<aside class="rn-sidebar" aria-label="Monitor navigation"><nav id="rn-nav"><button data-view="overview" class="active">Overview</button><button data-view="health">Health</button><button data-view="metrics">Metrics</button><button data-view="traces">Traces</button><button data-view="resources">Resources</button><button data-view="alerts">Alerts</button><button data-view="slos">SLOs</button><button data-view="incidents">Incidents</button><button data-view="fleet">Fleet</button><button data-view="deployments">Deployments</button><button data-view="diagnostics">Diagnostics</button></nav><footer><span>Primitive Node.js</span><span>Zero dependencies</span></footer></aside>
<main id="rn-main" class="rn-main"><section class="rn-loading"><div class="rn-spinner"></div><p>Loading observability control plane…</p></section></main>
<div id="rn-toast" role="status" aria-live="polite"></div>
<div id="rn-auth" class="rn-modal" role="dialog" aria-labelledby="rn-auth-title" aria-describedby="rn-auth-description" hidden><form id="rn-auth-form"><h2 id="rn-auth-title">Monitor authorization</h2><p id="rn-auth-description">Enter the operator token configured for this environment.</p><label for="rn-token">Operator token</label><input id="rn-token" type="password" autocomplete="current-password" required><div><button type="submit">Authorize</button></div></form></div>
</div><script type="module" src="${escapeAttr(prefix)}/assets/studio.js"></script></body></html>`;
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#096;'); }
export default renderMonitorStudioPage;
