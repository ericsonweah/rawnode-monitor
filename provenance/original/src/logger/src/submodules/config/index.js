'use strict';

import colors from '../colors/index.js';

const { rgb, bold, underline } = colors;
const defaultData = rgb(112, 162, 216);
const defaultLogEntry = rgb(24, 48, 72);

let currentProfile = 'default';
const profiles = Object.create(null);

profiles.default = {
  emergency: [139, 0, 0], alert: [255, 165, 0], critical: [255, 0, 0], error: [244, 15, 8],
  urgent: [255, 69, 0], priority: [255, 140, 0], warn: [255, 215, 0], notice: [128, 128, 128],
  success: [10, 220, 10], important: [10, 220, 10], info: [2, 121, 249], debug: [0, 200, 200],
  metrics: [0, 200, 200], metric: [0, 200, 200],
};
profiles.dark = {
  emergency: [200, 0, 0], alert: [255, 200, 0], critical: [255, 50, 50], error: [255, 100, 100],
  urgent: [255, 120, 0], priority: [255, 160, 0], warn: [255, 220, 0], notice: [160, 160, 160],
  success: [0, 255, 0], important: [0, 255, 0], info: [0, 150, 255], debug: [0, 255, 255],
  metrics: [0, 255, 255], metric: [0, 255, 255],
};

function ensureRGB(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => !Number.isFinite(Number(entry)))) {
    throw new Error(`${name} must be an array of three numbers.`);
  }
}

function normalize(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); }
    catch { return '[Unserializable]'; }
  }
  return String(value);
}

function compose(first, second) {
  if (!first) return second;
  if (!second) return first;
  return (text) => second(first(text));
}

export function createLevelConfig({ level, formattedRGB, bgRGB = null, isBold = false, isUnderlined = false, context = {} }) {
  ensureRGB(formattedRGB, 'formattedRGB');
  let formatted = rgb(...formattedRGB);
  if (isBold) formatted = compose(formatted, bold);
  if (isUnderlined) formatted = compose(formatted, underline);
  if (bgRGB) { ensureRGB(bgRGB, 'bgRGB'); formatted = compose(formatted, rgb(...bgRGB)); }
  const contextEntries = Object.entries(context || {});
  const safeFormatted = (value) => {
    let output = formatted(normalize(value));
    if (contextEntries.length) output += ` | ${contextEntries.map(([key, val]) => `${key}: ${val}`).join(', ')}`;
    return output;
  };
  return { level, formatted: safeFormatted, data: (value) => defaultData(normalize(value)), logEntry: (value) => defaultLogEntry(normalize(value)) };
}

function buildLevelConfigs() {
  const p = profiles[currentProfile];
  const out = Object.create(null);
  for (const level of Object.keys(p)) {
    out[level] = createLevelConfig({ level, formattedRGB: p[level], isBold: ['emergency','alert','critical','important'].includes(level) });
  }
  return out;
}

let levelConfigurations = buildLevelConfigs();

function setProfile(name) {
  if (!profiles[name]) throw new Error(`Unknown profile: ${name}`);
  currentProfile = name;
  levelConfigurations = buildLevelConfigs();
  return api;
}
function getProfile() { return currentProfile; }
function registerProfile(name, definition, options = {}) {
  const key = String(name || '').trim();
  if (!key) throw new TypeError('Profile name is required.');
  if (profiles[key] && options.replace !== true) throw new Error(`Profile already exists: ${key}`);
  const base = options.extend ? profiles[options.extend] : profiles.default;
  profiles[key] = { ...base, ...(definition || {}) };
  for (const [level, value] of Object.entries(profiles[key])) ensureRGB(value, `${key}.${level}`);
  return api;
}
function getLevelConfig(level) { return levelConfigurations[level] || null; }
function updateLevelConfig(level, newConfig) {
  if (!levelConfigurations[level]) throw new Error(`Log level ${level} does not exist.`);
  levelConfigurations[level] = { ...levelConfigurations[level], ...(newConfig || {}) };
  return api;
}
function resetLevelConfigs() { levelConfigurations = buildLevelConfigs(); return api; }
function listAvailableLevels() { return Object.keys(levelConfigurations); }
function listProfiles() { return Object.keys(profiles); }
function snapshot() { return { profile: currentProfile, levels: listAvailableLevels(), profiles: listProfiles() }; }

const api = {
  get levelConfigurations() { return levelConfigurations; },
  get profiles() { return { ...profiles }; },
  getLevelConfig,
  updateLevelConfig,
  resetLevelConfigs,
  setProfile,
  getProfile,
  registerProfile,
  listAvailableLevels,
  listProfiles,
  snapshot,
  createLevelConfig,
};

export default api;
