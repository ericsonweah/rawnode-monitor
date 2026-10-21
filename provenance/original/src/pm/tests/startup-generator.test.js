'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { StartupGenerator } from '../src/integrations/StartupGenerator.js';

test('startup generator emits hardened systemd and launchd definitions', () => {
  const generator = new StartupGenerator({
    nodePath: '/usr/bin/node',
    binPath: '/opt/rawnode/rawnode-pm.js',
    cwd: '/srv/rawnode app',
    stateDir: '/var/lib/rawnode-pm',
    user: 'rawnode',
    group: 'rawnode',
    environment: { APP_ENV: 'production' },
  });

  const systemd = generator.generate('systemd');
  assert.equal(systemd.filename, 'rawnode-pm.service');
  assert.match(systemd.content, /NoNewPrivileges=true/);
  assert.match(systemd.content, /UMask=0077/);
  assert.match(systemd.content, /User=rawnode/);
  assert.match(systemd.content, /Group=rawnode/);
  assert.match(systemd.content, /WorkingDirectory="\/srv\/rawnode app"/);
  assert.match(systemd.content, /--resurrect/);
  assert.doesNotMatch(systemd.content, /PrivateTmp=true/);

  const launchd = generator.generate('launchd');
  assert.equal(launchd.filename, 'org.rawnode.pm.plist');
  assert.match(launchd.content, /<key>RunAtLoad<\/key>/);
  assert.match(launchd.content, /<key>SuccessfulExit<\/key>/);
  assert.match(launchd.content, /<string>\/srv\/rawnode app<\/string>/);
});
