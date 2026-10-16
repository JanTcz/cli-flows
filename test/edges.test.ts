/* oxlint-disable import/max-dependencies -- the edges of every module, in one place */
// The edges of slice 1 (docs/features/01-record.md) the use cases' own tests do not reach — and every module of src loaded, so that
// coverage measures all of them (src/main.ts, the composition root, aside: npm run contract proves it).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import { cacheHome, download, engineDeps, which } from '../src/engine-deps.ts';
import { ENGINE_BASE, ENGINE_VERSION, findEngine, setupEngine } from '../src/engine.ts';
import { bytes } from '../src/format.ts';
import { mcpServer } from '../src/mcp.ts';
import { type RawFlow, toRecord } from '../src/record.ts';
import { BODY_LIMIT, redactBody } from '../src/redact.ts';
import { recordRun } from '../src/run.ts';
import { summarize, summaryLines } from '../src/summary.ts';
import { VERSION } from '../src/version.ts';

const dir = mkdtempSync(join(tmpdir(), 'cli-flows-edges-'));
after(() => { rmSync(dir, { recursive: true, force: true }); });
const SRC = join(import.meta.dirname, '..', 'src');

test('every module of src is loaded here or by a use case\'s test', async () => {
  for (const file of readdirSync(SRC).filter((name) => name.endsWith('.ts') && name !== 'main.ts')) {
    // oxlint-disable-next-line no-await-in-loop -- each module once
    await import(join(SRC, file));
  }
});

test('the version is the package\'s', () => {
  assert.equal(VERSION, (JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as { version: string }).version);
});

test('ls as JSON, and with no runs yet', async () => {
  const out: string[] = [];
  const deps = { runsDir: join(dir, 'no-runs'), confDir: dir, env: {}, engine: () => void 0, setup: () => Promise.resolve(''), record: () => Promise.resolve({ id: '', exit: 0 }) };
  await run(['ls'], { out: (l) => out.push(l), err: () => {} }, deps);
  await run(['ls', '--json'], { out: (l) => out.push(l), err: () => {} }, deps);
  assert.deepEqual(out, ['no runs recorded yet: flows run -- <command>', '[]']);
});

test('the engine: a platform with no build finds none; the default table and host are used when none is given', async () => {
  assert.equal(findEngine({ cache: dir, platform: 'aix-ppc64', which: () => void 0, fetch: () => Promise.reject(new Error('x')), unpack: () => Promise.resolve() }), undefined);
  const asked: string[] = [];
  await assert.rejects(setupEngine({ cache: join(dir, 'c'), platform: 'linux-x64', which: () => void 0, unpack: () => Promise.resolve(),
    fetch: (url) => { asked.push(url); return Promise.resolve(new Uint8Array([1])); } }), /not the pinned 2e95286b/u);
  assert.deepEqual(asked, [`${ENGINE_BASE}/${ENGINE_VERSION}/mitmproxy-${ENGINE_VERSION}-linux-x86_64.tar.gz`]);
});

test('the engine\'s world: the cache home, PATH, the download', async () => {
  assert.equal(cacheHome({ FLOWS_CACHE: '/x' }), '/x');
  assert.equal(cacheHome({ XDG_CACHE_HOME: '/xdg' }), '/xdg/cli-flows');
  assert.equal(cacheHome({}), join(homedir(), '.cache', 'cli-flows'));
  const bin = join(dir, 'bin');
  mkdirSync(join(bin, 'adir'), { recursive: true });
  writeFileSync(join(bin, 'tool'), '#!/bin/sh\n');
  chmodSync(join(bin, 'tool'), 0o755);
  writeFileSync(join(bin, 'plain'), '');
  assert.equal(which('tool', { PATH: `:${bin}` }), join(bin, 'tool'));
  assert.equal(which('plain', { PATH: bin }), undefined, 'not executable');
  assert.equal(which('adir', { PATH: bin }), undefined, 'not a file');
  assert.equal(which('tool', {}), undefined);
  assert.equal(engineDeps({ PATH: bin }).which('tool'), join(bin, 'tool'));
  const server = createServer((req, res) => { if (req.url === '/ok') res.end('bytes'); else res.writeHead(404).end(); });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  assert.equal(new TextDecoder().decode(await download(`${base}/ok`)), 'bytes');
  await assert.rejects(download(`${base}/missing`), /\/missing: HTTP 404/u);
  server.close();
});

test('bytes are said in B, KiB, MiB', () => {
  assert.deepEqual([bytes(5), bytes(2048), bytes(3 * 1024 * 1024)], ['5 B', '2.0 KiB', '3.0 MiB']);
});

test('a record: a port that is not the scheme\'s default, a body cut, no response', () => {
  const raw: RawFlow = { start: 1, end: 2, method: 'GET', scheme: 'http', host: 'h', port: 8080, path: '/', status: null, error: 'refused',
    request: { headers: [], size: BODY_LIMIT + 1, body: 'x'.repeat(BODY_LIMIT + 1) }, response: null };
  const record = toRecord(raw, 0);
  assert.equal(record.url, 'http://h:8080/');
  assert.deepEqual(record.cut, ['request']);
  assert.deepEqual([record.responseHeaders, record.responseBytes, 'responseBody' in record], [[], 0, false]);
});

test('redaction: a secret-named field holding an object is walked into; a JSON string body stays as it is', () => {
  assert.deepEqual(JSON.parse(redactBody(JSON.stringify({ secret: { value: 'v', password: 'p' } })).text), { secret: { value: 'v', password: '<redacted>' } });
  assert.equal(redactBody('"just a string"').text, '"just a string"');
});

test('a run with --raw asks the engine to keep the raw capture; a command killed by a signal exits 128+n', async () => {
  const args = join(dir, 'args.json');
  const runsDir = mkdtempSync(join(dir, 'runs-'));
  const result = await recordRun({ command: [process.execPath, '-e', 'process.kill(process.pid, "SIGKILL")'], mode: { kind: 'forward' }, runsDir, confDir: join(dir, 'conf'),
    engine: [process.execPath, join(import.meta.dirname, 'fake-mitmdump.mjs')], raw: true, timeoutMs: 5000, env: { PATH: process.env['PATH'] ?? '', FAKE_ARGS: args }, io: { out: () => {}, err: () => {} } });
  assert.equal(result.exit, 137);
  const argv = JSON.parse(readFileSync(args, 'utf8')) as string[];
  assert.equal(argv[argv.indexOf('-w') + 1], join(runsDir, result.id, 'raw.flow'));
});

const rec = (host: string) => ({ n: 0, start: 0, ms: 1, method: 'GET', url: '', host, path: '/', status: 200, error: null, requestHeaders: [], responseHeaders: [], requestBytes: 0, responseBytes: 0 });

test('an engine that ignores SIGTERM is killed after its stop time, and the run still ends', async () => {
  const runsDir = mkdtempSync(join(dir, 'runs-'));
  const result = await recordRun({ command: [process.execPath, '-e', 'process.exit(0)'], mode: { kind: 'forward' }, runsDir, confDir: join(dir, 'conf'),
    engine: [process.execPath, join(import.meta.dirname, 'fake-mitmdump.mjs')], raw: false, timeoutMs: 5000, stopMs: 200,
    env: { PATH: process.env['PATH'] ?? '', FAKE_MODE: 'stubborn' }, io: { out: () => {}, err: () => {} } });
  assert.equal(result.exit, 0);
});

test('a summary: equal counts by host name; no flows said, not silent', () => {
  assert.deepEqual(summarize([rec('b.test'), rec('a.test')]).hosts.map((h) => h.host), ['a.test', 'b.test']);
  assert.match(summaryLines(summarize([]))[0]!, /^no flows recorded/u);
});

test('the MCP twin: a call with no arguments object is a call with none', async () => {
  const ran: string[][] = [];
  const handle = mcpServer((argv) => { ran.push(argv); return Promise.resolve(0); }, '0');
  await handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ls' } }));
  assert.deepEqual(ran, [['ls']]);
});
