'use strict';

// Build an OKLCH-based gradient that applies to grapheme segments
function _lerp(a, b, t) { return a + (b - a) * t; }

function makeGradient(stops, opts, helpers) {
  const mode = (opts && opts.mode) ? String(opts.mode).toLowerCase() : 'oklch';
  const parsed = [];
  for (let i = 0; i < stops.length; i += 1) {
    parsed.push(helpers.to(mode, helpers.parse(stops[i])));
  }

  function _colorAt(t) {
    if (mode === 'oklch') {
      const seg = Math.max(0, Math.min(parsed.length - 2, Math.floor(t * (parsed.length - 1))));
      const localT = (t * (parsed.length - 1)) - seg;
      const a = parsed[seg], b = parsed[seg + 1];
      const L = _lerp(a.L, b.L, localT);
      const C = _lerp(a.C, b.C, localT);
      // Shortest hue interpolation
      let dH = b.H - a.H;
      if (dH > 180) { dH -= 360; }
      if (dH < -180) { dH += 360; }
      const H = (a.H + dH * localT + 360) % 360;
      const rgb = helpers.to('rgb', { space: 'oklch', L, C, H, alpha: 1 });
      return rgb;
    }
    // Fallback: linear sRGB mix
    const seg = Math.max(0, Math.min(parsed.length - 2, Math.floor(t * (parsed.length - 1))));
    const localT = (t * (parsed.length - 1)) - seg;
    const A = helpers.to('rgb', parsed[seg]);
    const B = helpers.to('rgb', parsed[seg + 1]);
    return helpers.env ? helpers.env.mixLinearRGB(A, B, localT) : helpers.mixLinearRGB(A, B, localT);
  }

  return {
    apply(text) {
      const gs = helpers.segmentGraphemes(String(text));
      const n = gs.length === 0 ? 1 : gs.length;
      let out = '';
      for (let i = 0; i < gs.length; i += 1) {
        const t = i / Math.max(1, (n - 1));
        const rgb = _colorAt(t);
        out += helpers.applyFG(rgb, gs[i]);
      }
      return out;
    }
  };
}

export default { makeGradient };
export { makeGradient };
