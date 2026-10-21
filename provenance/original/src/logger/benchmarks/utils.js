// benchmarks/utils.js
"use strict";

import { performance, PerformanceObserver } from "perf_hooks";
import process from "process";

export function now() {
    return performance.now();
}

export function measureEventLoopDelay(duration = 1000) {
    return new Promise((resolve) => {
        const start = now();
        let min = Infinity;
        let max = 0;

        function tick() {
            const h = now() - start;
            const delay = h - Math.floor(h);
            if (delay < min) min = delay;
            if (delay > max) max = delay;

            if (h >= duration) {
                resolve({ min, max });
            } else {
                setImmediate(tick);
            }
        }
        tick();
    });
}

export function cpuUsage(start) {
    const diff = process.cpuUsage(start);
    return (diff.user + diff.system) / 1000; // ms
}

export function printResults(title, results) {
    console.log(`\n===== ${title} =====`);
    console.table(results);
}
