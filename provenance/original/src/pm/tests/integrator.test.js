'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { RawNodeIntegrator, RAWNODE_INTEGRATION_ANCHORS } from '../src/integrations/RawNodeIntegrator.js';

test('RawNode integrator applies exact anchors, creates templates, and remains idempotent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rawnode-pm-integrate-'));
  const applicationFile = path.join(root, 'src/foundation/Application.js');
  const serveFile = path.join(root, 'src/console/commands/ServeCommand.js');
  await mkdir(path.dirname(applicationFile), { recursive: true });
  await mkdir(path.dirname(serveFile), { recursive: true });

  await writeFile(applicationFile, `'use strict';\n${RAWNODE_INTEGRATION_ANCHORS.APPLICATION_IMPORT_ANCHOR}\nexport class Application {\n  constructor() {\n${RAWNODE_INTEGRATION_ANCHORS.APPLICATION_PROVIDER_ANCHOR}\n  }\n}\n`);
  await writeFile(serveFile, `'use strict';\nexport class ServeCommand {\n  handle() {\n${RAWNODE_INTEGRATION_ANCHORS.SERVE_SERVER_ANCHOR}\n${RAWNODE_INTEGRATION_ANCHORS.SERVE_LISTEN_ANCHOR}\n  }\n}\n`);

  const integrator = new RawNodeIntegrator({ root });
  const dryRun = await integrator.integrate({ dryRun: true });
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.changed.length, 2);
  assert.equal(dryRun.created.length, 2);

  const result = await integrator.integrate();
  assert.equal(result.ok, true);
  assert.equal(result.backups.length, 2);
  const application = await readFile(applicationFile, 'utf8');
  const serve = await readFile(serveFile, 'utf8');
  assert.match(application, /RawNodePmServiceProvider/);
  assert.match(application, /this\.register\(RawNodePmServiceProvider\)/);
  assert.match(serve, /pmRuntime\?\.trackServer/);
  assert.match(serve, /source: 'serve-command'/);
  assert.match(await readFile(path.join(root, 'config/pm.js'), 'utf8'), /RA[NW]NODE_PM_RUNTIME/);
  assert.match(await readFile(path.join(root, 'rawnode.process.mjs'), 'utf8'), /rawnode-api/);

  const second = await integrator.integrate();
  assert.deepEqual(second.changed, []);
  assert.deepEqual(second.created, []);
});
