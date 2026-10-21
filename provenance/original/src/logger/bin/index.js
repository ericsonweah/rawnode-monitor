#!/usr/bin/env node
'use strict';

import { runCli } from '../src/enterprise/console/run.js';

runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = Number.isInteger(code) ? code : 0;
}).catch((error) => {
  process.stderr.write(`[rawnode-logger] ${error?.stack || error}\n`);
  process.exitCode = 1;
});
