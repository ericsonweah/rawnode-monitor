// benchmarks/laravel.js
"use strict";

import fs from "fs";
import { now, cpuUsage } from "./utils.js";

export default async function benchLaravel(iterations = 200_000) {
    const stream = fs.createWriteStream("/tmp/laravel.log", { flags: "w" });

    const startCPU = process.cpuUsage();
    const start = now();
    for (let i = 0; i < iterations; i++) {
        stream.write(`[${new Date().toISOString()}] local.INFO: Benchmark test message\n`);
    }
    stream.end();

    const end = now();
    const cpu = cpuUsage(startCPU);

    return {
        name: "Laravel Logger (simulated)",
        iterations,
        duration_ms: end - start,
        logs_per_sec: (iterations / (end - start)) * 1000,
        cpu_ms: cpu,
    };
}
