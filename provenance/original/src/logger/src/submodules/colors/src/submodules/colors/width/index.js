'use strict';
import esc from "../esc/index.js";

// moved import for esc

// Coarse, fast ranges
function _isCombining(cp) {
  return (cp >= 0x0300 && cp <= 0x036F) ||
         (cp >= 0x1AB0 && cp <= 0x1AFF) ||
         (cp >= 0x1DC0 && cp <= 0x1DFF) ||
         (cp >= 0x20D0 && cp <= 0x20FF) ||
         (cp >= 0xFE20 && cp <= 0xFE2F);
}

function _isWide(cp) {
  // Wide/fullwidth/East Asian approximation
  return (cp >= 0x1100 && cp <= 0x115F) ||
         (cp >= 0x2329 && cp <= 0x232A) ||
         (cp >= 0x2E80 && cp <= 0xA4CF) ||
         (cp >= 0xAC00 && cp <= 0xD7A3) ||
         (cp >= 0xF900 && cp <= 0xFAFF) ||
         (cp >= 0xFE10 && cp <= 0xFE19) ||
         (cp >= 0xFE30 && cp <= 0xFE6F) ||
         (cp >= 0xFF00 && cp <= 0xFF60) ||
         (cp >= 0xFFE0 && cp <= 0xFFE6);
}

function _isEmoji(cp) {
  return (cp >= 0x1F300 && cp <= 0x1FAFF) || (cp >= 0x1F1E6 && cp <= 0x1F1FF);
}

function _firstCodePoint(gr) {
  const c = gr.codePointAt(0);
  return (typeof c === 'number') ? c : 0;
}

function widthOfGrapheme(gr) {
  const cp = _firstCodePoint(gr);
  if (_isCombining(cp) === true) { return 0; }
  if (_isEmoji(cp) === true || _isWide(cp) === true) { return 2; }
  return 1;
}

function segmentGraphemes(s) {
  const str = String(s);
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    const iter = seg.segment(str);
    const out = [];
    for (const part of iter) { out.push(part.segment); }
    return out;
  }
  // Fallback: code point split (may split clusters with combining marks)
  return Array.from(str);
}

function visibleLength(s) {
  const clean = esc.strip(String(s));
  const gs = segmentGraphemes(clean);
  let sum = 0;
  for (let i = 0; i < gs.length; i += 1) {
    sum += widthOfGrapheme(gs[i]);
  }
  return sum;
}

function sliceVisible(s, cols) {
  const clean = esc.strip(String(s));
  const gs = segmentGraphemes(clean);
  let taken = 0;
  let out = '';
  for (let i = 0; i < gs.length; i += 1) {
    const w = widthOfGrapheme(gs[i]);
    if (taken + w > cols) { break; }
    out += gs[i];
    taken += w;
  }
  return out;
}

export default { visibleLength, sliceVisible, segmentGraphemes, widthOfGrapheme };
export { visibleLength, sliceVisible, segmentGraphemes, widthOfGrapheme };
