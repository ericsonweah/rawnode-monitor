// benchmarks/rawnode.js
"use strict";

import { Logger, ConsoleTransport } from "../index.js";
import { now, cpuUsage } from "./utils.js";

export default async function benchRawNode(iterations = 200_000) {
    const log = Logger.create()
        .level("debug")
        .transport(new ConsoleTransport())
        .done();

    const startCPU = process.cpuUsage();
    const start = now();
    for (let i = 0; i < iterations; i++) {
        log.debug("Benchmark test message");
    }
    const end = now();
    const cpu = cpuUsage(startCPU);

    return {
        name: "RawNodeLogger",
        iterations,
        duration_ms: end - start,
        logs_per_sec: (iterations / (end - start)) * 1000,
        cpu_ms: cpu,
    };
}
