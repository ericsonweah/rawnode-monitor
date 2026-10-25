import net from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const run = resolve('qualification-runs/20261025T135100Z-node22-browser-pm');
const sessions = ['diagnostic-01','diagnostic-safari-02','final-local-01','final-local-02','final-local-03','final-local-04','final-token-05'];
const results = [];
for (const session of sessions) {
  const input = JSON.parse(readFileSync(resolve(run, 'browser', `${session}-input.json`)));
  const records = readFileSync(resolve(run, 'browser', `${session}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
  const closed = records.findLast(record => record.kind === 'closed');
  assert.ok(closed, `${session} must have an actual closed receipt`);
  assert.equal(closed.reason, 'stdin'); assert.equal(closed.listening, false);
  assert.equal(closed.server.clients, 0); assert.equal(closed.server.signalListeners, 0);
  const url = new URL(input.url);
  const connection = await new Promise(resolveResult => {
    const socket = net.connect({ host: '127.0.0.1', port: Number(url.port) });
    let settled = false;
    const finish = outcome => { if (settled) return; settled = true; socket.destroy(); resolveResult(outcome); };
    socket.setTimeout(1500, () => finish('TIMEOUT'));
    socket.once('connect', () => finish('CONNECTED'));
    socket.once('error', error => finish(error.code));
  });
  results.push({ session, pid: input.pid, port: Number(url.port), closedAt: closed.at, closed, connection });
}
const receipt = { at: new Date().toISOString(), node: process.version, execPath: process.execPath, results, portsRefused: results.every(result => result.connection === 'ECONNREFUSED'), processExits: { source: 'Parent exec write_stdin tool outputs; all seven supported close commands returned exit_code 0', code: 0, signalsSent: false }, browserWindows: { status: 'operator-confirmed', scope: 'Named task windows only; unrelated browser windows/processes were borrowed and left alone', statement: 'Named task windows are closed', independentControllerConfirmation: false, reason: 'Native Safari controller timed out after close and after one kernel reconnect; application-only inventory did not include windows' } };
writeFileSync(resolve(run, 'browser', process.argv[2] || 'cleanup.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ portsRefused: receipt.portsRefused, sessions: results.map(({ session, connection }) => ({ session, connection })), browserWindows: receipt.browserWindows }, null, 2));
assert.equal(receipt.portsRefused, true, 'Every recorded owned loopback port must independently refuse connections');
