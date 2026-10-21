"use strict";
import colors from "../colors/index.js";

const { rgb, red, yellow, green, white, orange, fg } = colors;


const infColor = rgb(0, 122, 255);
const cyanColor1 = rgb(0, 200, 200);
const cyanColor2 = rgb(0, 206, 209)
const orangeColor1 = rgb(255, 165, 0)
const orangeColor2 = rgb(255, 140, 0)
//rgb(255, 193, 7)

const errorFormattedTimestamp = rgb(233, 218, 218)
const errorTimestamp = rgb(176, 164, 161)
// const errorTimestamp = rgb(189, 179, 178)

const warningFormattedTimestamp = rgb(233, 218, 218)
const warningTimestamp = rgb(176, 164, 161)
// const warningTimestamp = rgb(189, 179, 178) 

export const info = {
    formatted: rgb(2, 121, 249),
    data: rgb(112, 162, 216),
    logEntry:  rgb(24, 48, 72),
};
export const debug = {
    formatted: rgb(0, 200, 200),
    data: rgb(112, 162, 216),
    logEntry:  rgb(24, 48, 72),
};
export const error = {
    formatted: rgb(244, 15, 8),
    data: rgb(112, 162, 216),
    logEntry:  rgb(24, 48, 72),
};
export const success = {
    formatted: rgb(10, 220, 10),
    data: rgb(112, 162, 216),
    logEntry:  rgb(24, 48, 72),
};
export const alert = {
    formatted: rgb(67, 231, 75),
    data: rgb(112, 162, 216),
    logEntry:  rgb(24, 48, 72),
};
export const warning = {
    formatted: rgb(244, 15, 8),
    data: rgb(112, 162, 216),
    logEntry:  rgb(24, 48, 72),
};
export const urgent = {
    formatted: rgb(244, 15, 8),
    data: rgb(112, 162, 216),
    logEntry:  rgb(24, 48, 72),
};
export const notice = {
    formatted: rgb(72, 65, 66),
    data: rgb(112, 162, 216),
    logEntry:  rgb(24, 48, 72),
};
export const critical = {
    formatted: rgb(244, 15, 8),
    data: rgb(112, 162, 216),
    logEntry:  rgb(24, 48, 72),
};
export const emergency = {
    formatted: rgb(244, 15, 8),
    data: rgb(112, 162, 216),
    logEntry:  rgb(24, 48, 72),
};

export const defaultData = rgb(112, 162, 216);
export const defaultLogEntry = rgb(24, 48, 72);
