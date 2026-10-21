'use strict';

const _perStream = new WeakMap();

function _envNoColor() {
  return process.env.NO_COLOR !== undefined;
}

function _forceColor() {
  const fc = process.env.FORCE_COLOR;
  if (fc === undefined) { return undefined; }
  if (fc === '' || fc === 'true') { return 1; }
  const n = Number(fc);
  if (n === 0 || n === 1 || n === 2 || n === 3) { return n; }
  return 1;
}

function _ciLevel() {
  // Conservative defaults for major CI vendors. Many support at least 16; some 256/truecolor.
  if (process.env.CI === 'true' || process.env.CI === '1' || process.env.GITHUB_ACTIONS === 'true') { return 1; }
  if (process.env.GITLAB_CI === 'true' || process.env.BUILDKITE === 'true') { return 2; }
  return undefined;
}

function detectColorLevel({ stream }) {
  if (_envNoColor() === true) { return 0; }

  const forced = _forceColor();
  if (forced === 0 || forced === 1 || forced === 2 || forced === 3) { return forced; }

  // Per-stream override
  if (_perStream.has(stream) === true) {
    const v = _perStream.get(stream);
    if (v === 0 || v === 1 || v === 2 || v === 3) { return v; }
  }

  // If not a TTY, default to 0 unless forced above.
  if (stream && stream.isTTY === true) {
    // Term / Colorterm hints
    const term = process.env.TERM || '';
    const colorterm = process.env.COLORTERM || '';
    const program = process.env.TERM_PROGRAM || '';
    const wt = process.env.WT_SESSION;
    const conEmu = process.env.ConEmuANSI;

    if (colorterm.toLowerCase() === 'truecolor' || colorterm.toLowerCase() === '24bit') { return 3; }
    if (term.indexOf('256color') !== -1) { return 2; }

    // Windows Terminal / ConEmu
    if (wt !== undefined || (conEmu && conEmu.toUpperCase() === 'ON')) { return 3; }

    // Editors / modern terminals
    if (program === 'iTerm.app' || program === 'WezTerm' || program === 'Apple_Terminal' || program === 'Hyper') { return 3; }

    // fallback to 16 color if tty
    return 1;
  } else {
    // Non-tty: CI may still support
    const ci = _ciLevel();
    if (ci === 1 || ci === 2 || ci === 3) { return ci; }
    return 0;
  }
}

function level({ stream }) {
  const eff = detectColorLevel({ stream });
  return eff === 0 || eff === 1 || eff === 2 || eff === 3 ? eff : 0;
}

function setColorLevel(n, { stream }) {
  if (n !== 0 && n !== 1 && n !== 2 && n !== 3) { return level({ stream }); }
  _perStream.set(stream, n);
  return n;
}

function supportsHyperlinks(stream) {
  if (_envNoColor() === true) { return false; }
  const lvl = level({ stream: stream || process.stdout });
  if (lvl === 0) { return false; }
  const termProgram = process.env.TERM_PROGRAM || '';
  if (termProgram === 'iTerm.app' || termProgram === 'WezTerm' || termProgram === 'Hyper') { return true; }
  if (process.env.VTE_VERSION) {
    const v = parseInt(process.env.VTE_VERSION, 10);
    if (Number.isFinite(v) === true && v >= 5000) { return true; }
  }
  if (process.env.WT_SESSION) { return true; } // Windows Terminal
  if (process.env.DOMTERM) { return true; }
  if (process.env.KONSOLE_VERSION) { return true; } // KDE Konsole
  return false;
}

export default { detectColorLevel, level, setColorLevel, supportsHyperlinks };
export { detectColorLevel, level, setColorLevel, supportsHyperlinks };
