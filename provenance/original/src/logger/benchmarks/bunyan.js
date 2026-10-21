// benchmarks/bunyan.js
"use strict";

import fs from "fs";
import { now, cpuUsage } from "./utils.js";

export default async function benchBunyan(iterations = 200_000) {
    const stream = fs.createWriteStream("/tmp/bunyan.log", { flags: "w" });

    const startCPU = process.cpuUsage();
    const start = now();
    for (let i = 0; i < iterations; i++) {
        stream.write(
            JSON.stringify({
                name: "app",
                level: 30,
                msg: "Benchmark test message",
                time: new Date().toISOString(),
            }) + "\n"
        );
    }
    stream.end();

    const end = now();
    const cpu = cpuUsage(startCPU);

    return {
        name: "Bunyan (simulated)",
        iterations,
        duration_ms: end - start,
        logs_per_sec: (iterations / (end - start)) * 1000,
        cpu_ms: cpu,
    };
}
