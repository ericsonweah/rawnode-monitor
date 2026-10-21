'use strict';

process.stdout.write(`external-online:${process.pid}\n`);
const timer = setInterval(() => process.stdout.write(`external-tick:${process.pid}\n`), 100);
process.on('SIGTERM', () => {
  clearInterval(timer);
  process.stdout.write(`external-stopping:${process.pid}\n`);
  process.exit(0);
});
