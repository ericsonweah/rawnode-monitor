// benchmarks/winston.js
"use strict";

import fs from "fs";
import { now, cpuUsage } from "./utils.js";

export default async function benchWinston(iterations = 200_000) {
    const stream = fs.createWriteStream("/tmp/winston.log", { flags: "w" });

    const startCPU = process.cpuUsage();
    const start = now();
    for (let i = 0; i < iterations; i++) {
        stream.write(`[${new Date().toISOString()}][INFO] Benchmark test message\n`);
    }
    stream.end();
    const end = now();
    const cpu = cpuUsage(startCPU);

    return {
        name: "Winston (simulated)",
        iterations,
        duration_ms: end - start,
        logs_per_sec: (iterations / (end - start)) * 1000,
        cpu_ms: cpu,
    };
}
