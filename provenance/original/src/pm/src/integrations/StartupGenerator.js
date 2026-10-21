'use strict';

import path from 'node:path';
import { resolveStatePaths } from '../support/paths.js';

function systemdQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function xml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function plistString(value, indent = '    ') {
  return `${indent}<string>${xml(value)}</string>`;
}

function normalizePlatform(value) {
  const platform = String(value || '').trim().toLowerCase();
  if (platform === 'linux' || platform === 'systemd') return 'systemd';
  if (platform === 'darwin' || platform === 'macos' || platform === 'launchd') return 'launchd';
  return platform;
}

export class StartupGenerator {
  constructor(options = {}) {
    this.nodePath = path.resolve(options.nodePath || process.execPath);
    this.binPath = path.resolve(options.binPath);
    this.cwd = path.resolve(options.cwd || process.cwd());
    this.paths = resolveStatePaths(options.stateDir);
    this.user = options.user || null;
    this.group = options.group || null;
    this.userService = options.userService === true;
    this.label = String(options.label || 'org.rawnode.pm');
    this.description = String(options.description || 'RawNode PM Runtime Control Plane');
    this.resurrect = options.resurrect !== false;
    this.environment = {
      NODE_ENV: options.nodeEnv || process.env.NODE_ENV || 'production',
      RAWNODE_PM_HOME: this.paths.root,
      ...(options.environment || {}),
    };
    if (!options.binPath) throw new TypeError('StartupGenerator requires binPath.');
  }

  arguments() {
    const args = [this.nodePath, this.binPath, 'daemon', '--state-dir', this.paths.root, '--cwd', this.cwd];
    if (this.resurrect) args.push('--resurrect');
    return args;
  }

  systemd() {
    const serviceTarget = this.userService ? 'default.target' : 'multi-user.target';
    const lines = [
      '[Unit]',
      `Description=${this.description}`,
      'Wants=network-online.target',
      'After=network-online.target',
      '',
      '[Service]',
      'Type=simple',
      `WorkingDirectory=${systemdQuote(this.cwd)}`,
      `ExecStart=${this.arguments().map(systemdQuote).join(' ')}`,
      'ExecReload=/bin/kill -HUP $MAINPID',
      'Restart=on-failure',
      'RestartSec=2s',
      'TimeoutStartSec=30s',
      'TimeoutStopSec=45s',
      'KillMode=mixed',
      'UMask=0077',
      'LimitNOFILE=65535',
      'NoNewPrivileges=true',
    ];
    if (!this.userService && this.user) lines.splice(8, 0, `User=${this.user}`);
    if (!this.userService && this.group) lines.splice(this.user ? 9 : 8, 0, `Group=${this.group}`);
    for (const [key, value] of Object.entries(this.environment)) {
      if (value == null) continue;
      lines.push(`Environment=${systemdQuote(`${key}=${value}`)}`);
    }
    lines.push('', '[Install]', `WantedBy=${serviceTarget}`, '');
    return lines.join('\n');
  }

  launchd() {
    const args = this.arguments().map((value) => plistString(value, '      ')).join('\n');
    const env = Object.entries(this.environment)
      .filter(([, value]) => value != null)
      .map(([key, value]) => `      <key>${xml(key)}</key>\n${plistString(value, '      ')}`)
      .join('\n');
    const outLog = path.join(this.paths.root, 'daemon-output.log');
    const errorLog = path.join(this.paths.root, 'daemon-error.log');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(this.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(this.cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>2</integer>
  <key>StandardOutPath</key>
  <string>${xml(outLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(errorLog)}</string>
</dict>
</plist>
`;
  }

  generate(platform = process.platform) {
    const normalized = normalizePlatform(platform);
    if (normalized === 'systemd') {
      return {
        platform: normalized,
        filename: 'rawnode-pm.service',
        content: this.systemd(),
        installTarget: this.userService
          ? path.join(process.env.HOME || '~', '.config/systemd/user/rawnode-pm.service')
          : '/etc/systemd/system/rawnode-pm.service',
      };
    }
    if (normalized === 'launchd') {
      return {
        platform: normalized,
        filename: `${this.label}.plist`,
        content: this.launchd(),
        installTarget: path.join(process.env.HOME || '~', 'Library/LaunchAgents', `${this.label}.plist`),
      };
    }
    const error = new Error(`Unsupported startup platform '${platform}'. Use systemd or launchd.`);
    error.code = 'RNPM_STARTUP_PLATFORM_UNSUPPORTED';
    throw error;
  }
}

export default StartupGenerator;
