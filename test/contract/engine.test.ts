// UC-7 — the real engine (docs/features/01-record.md), `npm run contract`: mitmdump on PATH or fetched by `flows setup`. Forward
// mode over plain HTTP to a local server and over HTTPS to a public one (the command trusting the proxy through UC-2's CA
// variables), reverse mode to a local upstream; each request on the wire, redacted as UC-3 says. With no engine it fails and
// says how to get one — never a silent skip.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineDeps } from '../../src/engine-deps.ts';
import { findEngine } from '../../src/engine.ts';
import { recordRun, type RunOptions } from '../../src/run.ts';

const dir = mkdtempSync(join(tmpdir(), 'cli-flows-contract-'));
after(() => { rmSync(dir, { recursive: true, force: true }); });
const engine = findEngine(engineDeps());

const heard: string[] = [];
const server = createServer((req, res) => { heard.push(`${req.method} ${req.url}`); res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'); });
await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
after(() => { server.close(); });
const local = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

async function recorded(command: string[], mode: RunOptions['mode']) {
  assert.ok(engine, 'no mitmdump on PATH and none fetched: run `flows setup` (or install mitmproxy) before npm run contract');
  const runsDir = mkdtempSync(join(dir, 'runs-'));
  const result = await recordRun({ command, mode, runsDir, confDir: join(dir, 'conf'), engine: [engine], raw: false, timeoutMs: 30_000,
    env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '' }, io: { out: () => {}, err: () => {} } });
  const run = join(runsDir, readdirSync(runsDir)[0]!);
  const text = readFileSync(join(run, 'flows.jsonl'), 'utf8');
  return { exit: result.exit, text, records: text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>) };
}

test('UC-7: forward mode, plain HTTP to a local server — on the wire, the secret header redacted', async () => {
  const { exit, records, text } = await recorded(['curl', '-s', '-H', 'Authorization: Bearer t0k3n-secret', `${local}/items/42`], { kind: 'forward' });
  assert.equal(exit, 0);
  assert.ok(heard.includes('GET /items/42'), 'the server got it');
  const flow = records.find((r) => r['path'] === '/items/42');
  assert.ok(flow, text);
  assert.equal(flow['status'], 200);
  assert.ok(!text.includes('t0k3n-secret'), 'the token never reached the disk');
});

test('UC-7: forward mode, HTTPS — the command trusts the proxy through the CA variables', async () => {
  const { exit, records } = await recorded(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', 'https://example.com/'], { kind: 'forward' });
  assert.equal(exit, 0);
  assert.ok(records.some((r) => r['host'] === 'example.com' && r['status'] === 200), JSON.stringify(records));
});

test('UC-7: reverse mode — the command reaches the upstream through FLOWS_PROXY_URL', async () => {
  const { exit, records } = await recorded(['sh', '-c', 'curl -s "$FLOWS_PROXY_URL/v1/ping"'], { kind: 'reverse', upstream: local, env: [] });
  assert.equal(exit, 0);
  assert.ok(heard.includes('GET /v1/ping'));
  assert.ok(records.some((r) => r['path'] === '/v1/ping' && r['status'] === 200), JSON.stringify(records));
});
