// src/submodules/formatter/createLevelConfig.js

"use strict";

import colors from "../colors/index.js";

const { rgb } = colors;

// Default colors for data and overall log entry styling.
const defaultData = rgb(112, 162, 216);
const defaultLogEntry = rgb(24, 48, 72);

/**
 * Factory function to create a configuration object for a log level.
 *
 * @param {string} level - The log level name.
 * @param {number[]} formattedRGB - An array of three numbers [r, g, b] for the formatted text color.
 * @returns {Object} The configuration for the log level.
 */
function createLevelConfig(level, formattedRGB) {
    return {
        level,
        formatted: rgb(...formattedRGB),
        data: defaultData,
        logEntry: defaultLogEntry,
    };
}
/**
 * Define the color configuration for each log level.
 *
 * - emergency: Dark red (system unusable)
 * - alert: Vivid orange (immediate action required)
 * - critical: Bright red (critical conditions)
 * - error: Strong red (error conditions)
 * - urgent: Orangered (urgent messages)
 * - priority: Bold orange (high-priority issues)
 * - warn: Gold/yellow (warning conditions)
 * - notice: Neutral gray (normal but significant condition)
 * - success: Bright green (successful operation)
 * - info: Bright blue (informational messages)
 * - debug: Clear cyan (debugging output)
 */
const levelConfigurations = {
    emergency: createLevelConfig("emergency", [139, 0, 0]),
    alert: createLevelConfig("alert", [255, 165, 0]),
    critical: createLevelConfig("critical", [255, 0, 0]),
    error: createLevelConfig("error", [244, 15, 8]),
    urgent: createLevelConfig("urgent", [255, 69, 0]),
    priority: createLevelConfig("priority", [255, 140, 0]),
    warn: createLevelConfig("warn", [255, 215, 0]),
    notice: createLevelConfig("notice", [128, 128, 128]),
    success: createLevelConfig("success", [10, 220, 10]),
    info: createLevelConfig("info", [2, 121, 249]),
    debug: createLevelConfig("debug", [0, 200, 200]),
};
export default { levelConfigurations, createLevelConfig };
