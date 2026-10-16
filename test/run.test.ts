// UC-4 — a run is recorded (docs/features/01-record.md): the engine started with the addon and its own confdir, the command run
// with UC-2's environment, each flow received over the socket, redacted and appended; meta.json; the command's exit code; the
// engine stopped whatever happened; a command that cannot start is 127, an engine that does not come up is said.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADDON, recordRun, type RunOptions } from '../src/run.ts';

const dir = mkdtempSync(join(tmpdir(), 'cli-flows-run-'));
after(() => { rmSync(dir, { recursive: true, force: true }); });
const FAKE = join(import.meta.dirname, 'fake-mitmdump.mjs');

const FLOW = {
  start: 1_792_000_000.25, end: 1_792_000_000.75, method: 'POST', scheme: 'https', host: 'api.example.test', port: 443, path: '/v1/items/1234?x=1',
  status: 201, error: null,
  request: { headers: [['Authorization', 'Bearer secret-token'], ['Content-Type', 'application/json']], size: 40, body: '{"name":"a","api_key":"k-123"}' },
  response: { headers: [['Set-Cookie', 's=1'], ['Content-Type', 'application/json']], size: 12, body: '{"id":1234}' },
};
const FAILED = { ...FLOW, path: '/down', status: null, error: 'connection refused', response: null };

function options(over: Partial<RunOptions> & { env?: Record<string, string> } = {}): RunOptions & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const { env = {}, ...rest } = over;
  return {
    out, err, command: [process.execPath, '-e', 'process.exit(0)'], runsDir: mkdtempSync(join(dir, 'runs-')), confDir: join(dir, 'conf'),
    engine: [process.execPath, FAKE], mode: { kind: 'forward' }, raw: false, timeoutMs: 5000,
    env: { PATH: process.env['PATH'] ?? '', FAKE_FLOWS: JSON.stringify([FLOW, FAILED]), ...env },
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    ...rest,
  };
}
const only = (runsDir: string) => join(runsDir, readdirSync(runsDir)[0]!);
const lines = (file: string) => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

test('UC-4: the engine is started with the addon, its own confdir, a free local port and the forward mode', async () => {
  const args = join(dir, 'args.json');
  const o = options({ env: { FAKE_ARGS: args } });
  await recordRun(o);
  const argv = JSON.parse(readFileSync(args, 'utf8')) as string[];
  assert.equal(argv[argv.indexOf('-s') + 1], ADDON);
  assert.ok(existsSync(ADDON), 'the addon ships with the package');
  assert.equal(argv[argv.indexOf('--listen-host') + 1], '127.0.0.1');
  assert.match(argv[argv.indexOf('--listen-port') + 1]!, /^\d+$/u);
  assert.equal(argv[argv.indexOf('--mode') + 1], 'regular');
  assert.ok(argv.includes(`confdir=${o.confDir}`));
  assert.ok(argv.includes('-q'));
});

test('UC-4: each flow arrives, is redacted and appended; meta.json says the run; the exit code is the command\'s', async () => {
  const o = options({ command: [process.execPath, '-e', 'setTimeout(() => process.exit(3), 300)'] });
  const result = await recordRun(o);
  assert.equal(result.exit, 3);
  const run = only(o.runsDir);
  assert.equal(result.id, run.split('/').at(-1));
  const [first, second] = lines(join(run, 'flows.jsonl'));
  assert.equal(first?.['method'], 'POST');
  assert.equal(first?.['url'], 'https://api.example.test/v1/items/1234?x=1');
  assert.equal(first?.['status'], 201);
  assert.equal(first?.['ms'], 500);
  assert.deepEqual(first?.['requestHeaders'], [['Authorization', '<redacted>'], ['Content-Type', 'application/json']]);
  assert.deepEqual(first?.['responseHeaders'], [['Set-Cookie', '<redacted>'], ['Content-Type', 'application/json']]);
  assert.equal(first?.['requestBody'], '{"name":"a","api_key":"<redacted>"}');
  assert.equal(second?.['error'], 'connection refused');
  assert.equal(second?.['status'], null);
  const meta = JSON.parse(readFileSync(join(run, 'meta.json'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual(meta['command'], o.command);
  assert.deepEqual(meta['mode'], { kind: 'forward' });
  assert.equal(meta['exit'], 3);
  assert.equal(meta['flows'], 2);
  assert.ok(typeof meta['started'] === 'number' && typeof meta['ended'] === 'number' && meta['ended'] >= meta['started']);
  assert.ok(!readFileSync(join(run, 'flows.jsonl'), 'utf8').includes('secret-token'), 'no secret reached the disk');
});

test('UC-4: the command runs with the forward environment; reverse mode gives it the proxy URL in the variables named', async () => {
  const seen = join(dir, 'seen.json');
  const dump = `require('fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify(process.env))`;
  await recordRun(options({ command: [process.execPath, '-e', dump] }));
  const forward = JSON.parse(readFileSync(seen, 'utf8')) as Record<string, string>;
  assert.match(forward['HTTPS_PROXY'] ?? '', /^http:\/\/127\.0\.0\.1:\d+$/u);
  assert.equal(forward['NODE_EXTRA_CA_CERTS'], join(dir, 'conf', 'mitmproxy-ca-cert.pem'));
  const args = join(dir, 'args-reverse.json');
  await recordRun(options({ command: [process.execPath, '-e', dump], mode: { kind: 'reverse', upstream: 'https://api.example.test', env: ['SERVICE_URL'] }, env: { FAKE_ARGS: args } }));
  const reverse = JSON.parse(readFileSync(seen, 'utf8')) as Record<string, string>;
  assert.equal(reverse['HTTPS_PROXY'], undefined);
  assert.equal(reverse['SERVICE_URL'], reverse['FLOWS_PROXY_URL']);
  const argv = JSON.parse(readFileSync(args, 'utf8')) as string[];
  assert.equal(argv[argv.indexOf('--mode') + 1], 'reverse:https://api.example.test');
});

test('UC-4: a command that cannot start is exit 127, said; the engine is stopped and the run still recorded', async () => {
  const o = options({ command: ['/nonexistent/command-xyz'] });
  const result = await recordRun(o);
  assert.equal(result.exit, 127);
  assert.match(o.err.join('\n'), /cannot start \/nonexistent\/command-xyz: ENOENT/u);
  assert.equal((JSON.parse(readFileSync(join(only(o.runsDir), 'meta.json'), 'utf8')) as { exit: number }).exit, 127);
});

test('UC-4: an engine that exits before it listens, or does not listen in time, is said and nothing is run', async () => {
  const marker = join(dir, 'ran');
  const touch = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`];
  await assert.rejects(recordRun(options({ command: touch, env: { FAKE_MODE: 'exit' } })), /the engine exited before it listened \(exit 1\): Error: the address is in use/u);
  await assert.rejects(recordRun(options({ command: touch, env: { FAKE_MODE: 'silent' }, timeoutMs: 300 })), /the engine did not listen within 300 ms/u);
  assert.equal(existsSync(marker), false, 'the command never ran');
});
