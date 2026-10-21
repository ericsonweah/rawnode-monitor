

// src/submodules/formatter/config/index.js

'use strict';


import { rgb, reset, bold, underline } from "../../colors/index.js";

// moved import for { rgb, reset, bold, underline }

const defaultData = rgb(112, 162, 216);
const defaultLogEntry = rgb(24, 48, 72);

let currentProfile = "default";
const profiles = {
  default: {
    emergency: [139, 0, 0],
    alert: [255, 165, 0],
    critical: [255, 0, 0],
    error: [244, 15, 8],
    urgent: [255, 69, 0],
    priority: [255, 140, 0],
    warn: [255, 215, 0],
    notice: [128, 128, 128],
    success: [10, 220, 10],
    info: [2, 121, 249],
    debug: [0, 200, 200],
  },
  dark: {
    emergency: [200, 0, 0],
    alert: [255, 200, 0],
    critical: [255, 50, 50],
    error: [255, 100, 100],
    urgent: [255, 120, 0],
    priority: [255, 160, 0],
    warn: [255, 220, 0],
    notice: [160, 160, 160],
    success: [0, 255, 0],
    info: [0, 150, 255],
    debug: [0, 255, 255],
  }
};

function setProfile(profileName) {
  if (profiles[profileName]) {
    currentProfile = profileName;
    resetLevelConfigs();
  } else {
    throw new Error("Unknown profile: " + profileName);
  }
}

function createLevelConfig({ level, formattedRGB, bgRGB = null, isBold = false, isUnderlined = false, context = {} }) {
  if (!Array.isArray(formattedRGB) || formattedRGB.length !== 3) {
    throw new Error("formattedRGB must be an array of three numbers.");
  }
  const colorFn = rgb(...formattedRGB);
  let styleFn = (text) => text;
  if (isBold) {
    styleFn = (text) => bold(text);
  }
  if (isUnderlined) {
    const prev = styleFn;
    styleFn = (text) => underline(prev(text));
  }
  let bgFn = (text) => text;
  if (bgRGB) {
    if (!Array.isArray(bgRGB) || bgRGB.length !== 3) {
      throw new Error("bgRGB must be an array of three numbers.");
    }
    bgFn = rgb(...bgRGB);
  }

  // Template: include context if provided.
  const templateFn = (text) => {
    const ctxEntries = Object.entries(context);
    if (ctxEntries.length > 0) {
      const ctxStr = ctxEntries.map(([key, val]) => `${key}: ${val}`).join(", ");
      return `${text} | ${ctxStr}`;
    }
    return text;
  };

  const formattedFn = (text) => templateFn(bgFn(styleFn(colorFn(text))));
  
  return {
    level,
    formatted: formattedFn,
    data: defaultData,
    logEntry: defaultLogEntry,
  };
}

let levelConfigurations = {
  emergency: createLevelConfig({ level: "emergency", formattedRGB: profiles[currentProfile].emergency, isBold: true }),
  alert: createLevelConfig({ level: "alert", formattedRGB: profiles[currentProfile].alert, isBold: true }),
  critical: createLevelConfig({ level: "critical", formattedRGB: profiles[currentProfile].critical, isBold: true }),
  error: createLevelConfig({ level: "error", formattedRGB: profiles[currentProfile].error }),
  urgent: createLevelConfig({ level: "urgent", formattedRGB: profiles[currentProfile].urgent }),
  priority: createLevelConfig({ level: "priority", formattedRGB: profiles[currentProfile].priority }),
  warn: createLevelConfig({ level: "warn", formattedRGB: profiles[currentProfile].warn }),
  notice: createLevelConfig({ level: "notice", formattedRGB: profiles[currentProfile].notice }),
  success: createLevelConfig({ level: "success", formattedRGB: profiles[currentProfile].success }),
  info: createLevelConfig({ level: "info", formattedRGB: profiles[currentProfile].info }),
  debug: createLevelConfig({ level: "debug", formattedRGB: profiles[currentProfile].debug }),
};

function getLevelConfig(level) {
  return levelConfigurations[level] || null;
}

function updateLevelConfig(level, newConfig) {
  if (!levelConfigurations[level]) {
    throw new Error(`Log level ${level} does not exist.`);
  }
  levelConfigurations[level] = { ...levelConfigurations[level], ...newConfig };
}

function resetLevelConfigs() {
  levelConfigurations = {
    emergency: createLevelConfig({ level: "emergency", formattedRGB: profiles[currentProfile].emergency, isBold: true }),
    alert: createLevelConfig({ level: "alert", formattedRGB: profiles[currentProfile].alert, isBold: true }),
    critical: createLevelConfig({ level: "critical", formattedRGB: profiles[currentProfile].critical, isBold: true }),
    error: createLevelConfig({ level: "error", formattedRGB: profiles[currentProfile].error }),
    urgent: createLevelConfig({ level: "urgent", formattedRGB: profiles[currentProfile].urgent }),
    priority: createLevelConfig({ level: "priority", formattedRGB: profiles[currentProfile].priority }),
    warn: createLevelConfig({ level: "warn", formattedRGB: profiles[currentProfile].warn }),
    notice: createLevelConfig({ level: "notice", formattedRGB: profiles[currentProfile].notice }),
    success: createLevelConfig({ level: "success", formattedRGB: profiles[currentProfile].success }),
    info: createLevelConfig({ level: "info", formattedRGB: profiles[currentProfile].info }),
    debug: createLevelConfig({ level: "debug", formattedRGB: profiles[currentProfile].debug }),
  };
}

export default {
  levelConfigurations,
  getLevelConfig,
  updateLevelConfig,
  resetLevelConfigs,
  setProfile,
};
