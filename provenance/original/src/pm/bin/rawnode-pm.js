#!/usr/bin/env node
'use strict';

import { runCli } from '../src/console/run.js';

runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = Number.isInteger(code) ? code : 0;
}).catch((error) => {
  process.stderr.write(`[rawnode-pm] ${error?.stack || error}\n`);
  process.exitCode = error?.code === 'RNPM_CONFIGURATION_ERROR' ? 3 : 1;
});
