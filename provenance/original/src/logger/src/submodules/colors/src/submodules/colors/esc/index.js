'use strict';

// Fast compiled regexes: CSI and OSC (ST and BEL terminated)
const CSI_RE = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;                // ESC [ ... Fn
const OSC_RE = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;        // ESC ] ... BEL or ST

function strip(s) {
  const str = String(s);
  return str.replace(OSC_RE, '').replace(CSI_RE, '');
}

function sanitize(s) {
  // For now, same as strip (removes all CSI/OSC/OSC-8). Safe default.
  return strip(s);
}

function _escapeUrl(url) {
  // Remove control chars, ESC, and normalize spaces
  return String(url).replace(/[\x00-\x1F\x7F\x1B]/g, '').trim();
}

function osc8Link(text, url, enabled) {
  const safeText = sanitize(text);
  if (enabled !== true) { return safeText; }
  const safeUrl = _escapeUrl(url);
  // OSC 8 ; ; URL ST  TEXT  OSC 8 ; ; ST
  // Use BEL (\x07) as ST for broad compatibility
  return '\x1B]8;;' + safeUrl + '\x07' + safeText + '\x1B]8;;\x07';
}

function explainSequences(s) {
  const str = String(s);
  const seqs = [];
  let m;
  CSI_RE.lastIndex = 0;
  while ((m = CSI_RE.exec(str)) !== null) {
    seqs.push({ kind: 'CSI', seq: m[0], index: m.index });
  }
  OSC_RE.lastIndex = 0;
  while ((m = OSC_RE.exec(str)) !== null) {
    seqs.push({ kind: 'OSC', seq: m[0].slice(0, 10) + '…', index: m.index }); // truncate for readability
  }
  seqs.sort((a, b) => (a.index < b.index ? -1 : (a.index > b.index ? 1 : 0)));
  return seqs;
}

export default { strip, sanitize, osc8Link, explainSequences };
export { strip, sanitize, osc8Link, explainSequences };
