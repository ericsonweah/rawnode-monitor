#!/usr/bin/env node
'use strict';

import { runCli } from '../src/events/console/run.js';

runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = Number.isInteger(code) ? code : 0;
}).catch((error) => {
  process.stderr.write(`[rawnode-events] ${error?.stack || error}\n`);
  process.exitCode = error?.code === 'EVENT_CONFIGURATION_ERROR' ? 3 : 1;
});
