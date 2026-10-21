// benchmarks/runner.js
"use strict";

import benchRawNode from "./rawnode.js";
import benchPino from "./pino.js";
import benchWinston from "./winston.js";
import benchBunyan from "./bunyan.js";
import benchLaravel from "./laravel.js";
import { measureEventLoopDelay, printResults } from "./utils.js";

async function runAll() {
    console.log("Running RawNode Logger Benchmarks...\n");

    const results = [];

    results.push(await benchRawNode());
    results.push(await benchPino());
    results.push(await benchWinston());
    results.push(await benchBunyan());
    results.push(await benchLaravel());

    printResults("Logger Throughput", results);

    const delay = await measureEventLoopDelay(500);
    printResults("Event Loop Delay (500ms sample)", [delay]);
}

runAll();
