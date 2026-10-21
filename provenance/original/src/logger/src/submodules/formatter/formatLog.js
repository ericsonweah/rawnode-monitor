"use strict";

import colors from "../colors/index.js";
import SafeSerializer from "../../enterprise/serialization/SafeSerializer.js";

const safeSerializer = new SafeSerializer({ maxDepth: 16, maxRecordBytes: 512 * 1024 });

const { rgb, red, yellow, green, bold, gradient, white, orange, fg } = colors;

// Core colors
const defaultData = rgb(112, 162, 216);
const defaultLogEntry = rgb(24, 48, 72);

const infColor = rgb(0, 122, 255);
const cyanColor1 = rgb(0, 200, 200);
const cyanColor2 = rgb(0, 206, 209);
const notice = rgb(72, 65, 66);
const alert = rgb(67, 231, 75);
const error = rgb(244, 15, 8);
const urgent = rgb(244, 15, 8);
const warn = rgb(244, 15, 8);
const info = rgb(2, 121, 249);
const debug = rgb(0, 200, 200);
const success = rgb(244, 15, 8);
const priority = rgb(244, 15, 8);
const emergency = rgb(244, 15, 8);
const critical = rgb(244, 15, 8);
const errorFormattedTimestamp = rgb(205, 217, 228);

/** Normalize ANY incoming value into a string */
function normalize(v) {
    if (v === null) return "null";
    if (typeof v === "object") return safeSerializer.stringify(v);
    return String(v);
}

/**
 * Format a log entry according to the given level.
 */
function formatLog({ timestamp, level, message, data = null }) {
    // Normalize BEFORE applying colors
    timestamp = normalize(timestamp);
    message = normalize(message);
    level = normalize(level);

    let formatted = "";

    switch (level) {
        case "error":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${red(level.toUpperCase())}] ${red(message)}`;
            break;

        case "warn":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${yellow(level.toUpperCase())}] ${yellow(message)}`;
            break;

        case "info":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${info(level.toUpperCase())}] ${info(message)}`;
            break;

        case "debug":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${debug(level.toUpperCase())}] ${debug(message)}`;
            break;

        case "success":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${green(level.toUpperCase())}] ${green(message)}`;
            break;

        case "priority":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${bold.green(level.toUpperCase())}] ${bold.green(message)}`;
            break;

        case "emergency":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${bold.red(level.toUpperCase())}] ${bold.red(message)}`;
            break;

        case "alert":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${alert(level.toUpperCase())}] ${alert(message)}`;
            break;

        case "notice":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${notice(level.toUpperCase())}] ${notice(message)}`;
            break;

        case "urgent":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${urgent(level.toUpperCase())}] ${urgent(message)}`;
            break;

        case "critical":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${bold.red(level.toUpperCase())}] ${bold.red(message)}`;
            break;

        case "metrics":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${bold.red(level.toUpperCase())}] ${bold.red(message)}`;
            break;

        case "metric":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${bold.green(level.toUpperCase())}] ${bold.green(message)}`;
            break;

        case "important":
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${bold.red(level.toUpperCase())}] ${bold.red(message)}`;
            break;

        default:
            formatted = `[${errorFormattedTimestamp(timestamp)}] [${level.toUpperCase()}] ${message}`;
    }

    // RE-normalize formatted (in case color functions returned something odd)
    formatted = normalize(formatted);

    // DATA APPEND
    if (data !== null) {
        formatted += gradient(["#448a1eff", "#f6f03bff", "#93c5fd"]).apply(" => ");
        const safeData =
            data === null
                ? "null"
                : typeof data === "object"
                    ? safeSerializer.stringify(data)
                    : String(data);

        formatted += defaultData(safeData);
    }

    return formatted;
}

export default formatLog;
