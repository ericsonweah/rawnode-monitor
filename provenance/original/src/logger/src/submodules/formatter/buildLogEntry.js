"use strict";
import colors from "../colors/index.js";
import SafeSerializer from "../../enterprise/serialization/SafeSerializer.js";

const safeSerializer = new SafeSerializer({ maxDepth: 16, maxRecordBytes: 512 * 1024 });

const { rgb, red, yellow, green, white, orange, fg } = colors;

const infColor = rgb(0, 122, 255);
const cyanColor1 = rgb(0, 200, 200);
const cyanColor2 = rgb(0, 206, 209);
const orangeColor1 = rgb(255, 165, 0);
const orangeColor2 = rgb(255, 140, 0);
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
const errorFormattedTimestamp = rgb(233, 218, 218);
const errorTimestamp = rgb(176, 164, 161);

const defaultData = rgb(112, 162, 216);
const defaultLogEntry = rgb(24, 48, 72);

/** Normalize ANY value into a safe string for color formatting */
function normalize(value) {
    if (value === null) return "null";
    if (typeof value === "object") return safeSerializer.stringify(value);
    return String(value);
}

/**
 * Builds a log entry object with colorized properties.
 */
function buildLogEntry({ timestamp, level, message, formatted, data }) {
    // Normalize BEFORE coloring
    timestamp = normalize(timestamp);
    level = normalize(level);
    message = normalize(message);
    formatted = normalize(formatted);
    data = normalize(data);

    let logEntry = {};

    switch (level) {
        case "error":
            logEntry = {
                timestamp: red(timestamp),
                level: red(level),
                message: red(message),
                formatted: red(formatted),
                data: defaultData(data),
                color: red,
            };
            break;

        case "warn":
            logEntry = {
                timestamp: yellow(timestamp),
                level: yellow(level),
                message: yellow(message),
                formatted: yellow(formatted),
                data: defaultData(data),
                color: yellow,
            };
            break;

        case "info":
            logEntry = {
                timestamp: infColor(timestamp),
                level: infColor(level),
                message: infColor(message),
                formatted: infColor(formatted),
                data: defaultData(data),
                color: infColor,
            };
            break;

        case "debug":
            logEntry = {
                timestamp: cyanColor1(timestamp),
                level: cyanColor1(level),
                message: cyanColor1(message),
                formatted: cyanColor1(formatted),
                data: defaultData(data),
                color: cyanColor1,
            };
            break;

        case "success":
            logEntry = {
                timestamp: green(timestamp),
                level: green(level),
                message: green(message),
                formatted: green(formatted),
                data: defaultData(data),
                color: green,
            };
            break;

        case "priority":
            logEntry = {
                timestamp: green(timestamp),
                level: green(level),
                message: green(message),
                formatted: green(formatted),
                data: defaultData(data),
                color: green,
            };
            break;

        case "emergency":
            logEntry = {
                timestamp: colors.bold.red(timestamp),
                level: colors.bold.red(level),
                message: colors.bold.red(message),
                formatted: colors.bold.red(formatted),
                data: defaultData(data),
                color: colors.bold.red,
            };
            break;

        case "alert":
            logEntry = {
                timestamp: green(timestamp),
                level: green(level),
                message: green(message),
                formatted: green(formatted),
                data: defaultData(data),
                color: green,
            };
            break;

        case "notice":
            logEntry = {
                timestamp: green(timestamp),
                level: green(level),
                message: green(message),
                formatted: green(formatted),
                data: defaultData(data),
                color: green,
            };
            break;

        case "urgent":
            logEntry = {
                timestamp: fg("orange")(timestamp),
                level: fg("orange")(level),
                message: fg("orange")(message),
                formatted: fg("orange")(formatted),
                data: defaultData(data),
                color: orange,
            };
            break;

        case "important":
            logEntry = {
                timestamp: colors.bold.green(timestamp),
                level: colors.bold.green(level),
                message: colors.bold.green(message),
                formatted: colors.bold.green(formatted),
                data: defaultData(data),
                color: colors.bold.green,
            };
            break;

        case "metrics":
        case "metric":
        case "critical":
            logEntry = {
                timestamp: white(timestamp),
                level: white(level),
                message: white(message),
                formatted: white(formatted),
                data: defaultData(data),
                color: white,
            };
            break;

        default:
            logEntry = {
                timestamp,
                level,
                message,
                formatted,
                data: defaultData(data),
                color: white,
            };
    }

    return logEntry;
}

export default buildLogEntry;
