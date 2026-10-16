// UC-6 — the CLI (docs/features/01-record.md): run, ls, summary, setup; usage on a mistake (exit 2); a failure one line, exit 1.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CliDeps, run } from '../src/cli.ts';
import type { RunOptions } from '../src/run.ts';

const dir = mkdtempSync(join(tmpdir(), 'cli-flows-cli-'));
after(() => { rmSync(dir, { recursive: true, force: true }); });
mkdirSync(join(dir, 'runs', '20261016-120000-cccc'), { recursive: true });
writeFileSync(join(dir, 'runs', '20261016-120000-cccc', 'meta.json'), JSON.stringify({ id: '20261016-120000-cccc', command: ['curl', 'https://a.test/'], mode: { kind: 'forward' }, started: 1_792_000_000_000, ended: 1_792_000_001_000, exit: 0, flows: 1 }));
writeFileSync(join(dir, 'runs', '20261016-120000-cccc', 'flows.jsonl'), `${JSON.stringify({ n: 0, start: 0, ms: 120, method: 'GET', url: 'https://a.test/x', host: 'a.test', path: '/x', status: 200, error: null, requestHeaders: [], responseHeaders: [], requestBytes: 1, responseBytes: 2 })}\n`);

async function cli(argv: string[], over: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const recorded: Partial<RunOptions>[] = [];
  const deps: CliDeps = {
    runsDir: join(dir, 'runs'), confDir: join(dir, 'conf'), env: { PATH: '/bin' },
    engine: () => '/usr/local/bin/mitmdump', setup: () => Promise.resolve('/cache/mitmproxy-12.2.3/mitmdump'),
    record: (options) => { recorded.push(options); return Promise.resolve({ id: 'r1', exit: 4 }); },
    ...over,
  };
  const code = await run(argv, { out: (l) => out.push(l), err: (l) => err.push(l) }, deps);
  return { code, out, err, recorded };
}

test('UC-6: run takes its options before --, the command after it, and exits with the command\'s code', async () => {
  const { code, recorded } = await cli(['run', '--reverse', 'https://api.example.test', '--env', 'A_URL', '--env', 'B_URL', '--raw', '--', 'node', 'app.js', '--flag']);
  assert.equal(code, 4);
  assert.deepEqual(recorded[0]?.command, ['node', 'app.js', '--flag']);
  assert.deepEqual(recorded[0]?.mode, { kind: 'reverse', upstream: 'https://api.example.test', env: ['A_URL', 'B_URL'] });
  assert.equal(recorded[0]?.raw, true);
  assert.deepEqual(recorded[0]?.engine, ['/usr/local/bin/mitmdump']);
  const forward = await cli(['run', '--', 'curl', 'https://a.test/']);
  assert.deepEqual(forward.recorded[0]?.mode, { kind: 'forward' });
  assert.equal(forward.recorded[0]?.raw, false);
});

test('UC-6: run without -- or a command, --env without --reverse, an unknown option — usage, exit 2', async () => {
  for (const argv of [['run', 'curl'], ['run', '--'], ['run', '--env', 'X', '--', 'a'], ['run', '--colour', '--', 'a'], ['run', '--reverse', '--', 'a']]) {
    const { code, err, recorded } = await cli(argv);
    assert.equal(code, 2, argv.join(' '));
    assert.match(err.join('\n'), /usage: flows run/u, argv.join(' '));
    assert.equal(recorded.length, 0);
  }
});

test('UC-6: with no engine, run says how to get one; setup fetches it and says where', async () => {
  const none = await cli(['run', '--', 'curl', 'x'], { engine: () => undefined });
  assert.equal(none.code, 1);
  assert.deepEqual(none.err, ['flows: no mitmdump on PATH and none fetched: run `flows setup` (or install mitmproxy)']);
  const setup = await cli(['setup']);
  assert.equal(setup.code, 0);
  assert.deepEqual(setup.out, ['mitmdump ready: /cache/mitmproxy-12.2.3/mitmdump']);
  const failed = await cli(['setup'], { setup: () => Promise.reject(new Error('refused')) });
  assert.deepEqual([failed.code, failed.err], [1, ['flows: refused']]);
});

test('UC-6: ls and summary read the runs; --json is the data; an unknown run is said', async () => {
  const ls = await cli(['ls']);
  assert.match(ls.out[0]!, /^RUN\s+STARTED\s+FLOWS\s+EXIT\s+COMMAND$/u);
  assert.match(ls.out[1]!, /^20261016-120000-cccc\s+2026-\d\d-\d\d \d\d:\d\d:\d\d\s+1\s+0\s+curl https:\/\/a\.test\/$/u);
  const summary = await cli(['summary', '20261016-120000-cccc']);
  assert.equal(summary.code, 0);
  assert.ok(summary.out.some((l) => l.startsWith('a.test')));
  const json = JSON.parse((await cli(['summary', '20261016-120000-cccc', '--json'])).out.join('\n')) as { hosts: { host: string }[] };
  assert.equal(json.hosts[0]?.host, 'a.test');
  const missing = await cli(['summary', 'nope']);
  assert.equal(missing.code, 1);
  assert.match(missing.err[0]!, /^flows: no run nope in /u);
});

test('UC-6: no command, an unknown one, a missing argument — usage, exit 2; --help, the commands', async () => {
  for (const argv of [[], ['frobnicate'], ['summary'], ['ls', 'extra']]) {
    const { code, err } = await cli(argv);
    assert.equal(code, 2, argv.join(' '));
    assert.match(err.join('\n'), /usage: flows/u);
  }
  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  for (const command of ['run', 'ls', 'summary', 'setup', 'mcp']) assert.ok(help.out.some((l) => l.trimStart().startsWith(command)), command);
});
