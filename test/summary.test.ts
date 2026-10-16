// UC-5 — ls and summary (docs/features/01-record.md): the runs newest first; per host and per endpoint (ids folded to :id) the
// counts, bytes, durations and statuses; as data with --json; a run that does not exist is said.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRuns, loadRun } from '../src/runs.ts';
import { endpointOf, summarize, summaryLines } from '../src/summary.ts';
import type { FlowRecord } from '../src/record.ts';

const dir = mkdtempSync(join(tmpdir(), 'cli-flows-summary-'));
after(() => { rmSync(dir, { recursive: true, force: true }); });

const rec = (over: Partial<FlowRecord>): FlowRecord => ({
  n: 0, start: 0, ms: 100, method: 'GET', url: 'https://a.test/', host: 'a.test', path: '/', status: 200, error: null,
  requestHeaders: [], responseHeaders: [], requestBytes: 10, responseBytes: 100, ...over,
});

function makeRun(id: string, started: number, records: FlowRecord[], exit = 0): void {
  const at = join(dir, id);
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, 'meta.json'), JSON.stringify({ id, command: ['curl', 'https://a.test/'], mode: { kind: 'forward' }, started, ended: started + 1000, exit, flows: records.length }));
  writeFileSync(join(at, 'flows.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
}

test('UC-5: an endpoint is the method and the path, its ids folded to :id and its query left out', () => {
  assert.equal(endpointOf('GET', '/v1/items/1234/parts/550e8400-e29b-41d4-a716-446655440000?x=1'), 'GET /v1/items/:id/parts/:id');
  assert.equal(endpointOf('POST', '/blobs/0123456789abcdef0123'), 'POST /blobs/:id');
  assert.equal(endpointOf('GET', '/v2/users/me'), 'GET /v2/users/me');
});

test('UC-5: per host and per endpoint — counts, bytes, durations, statuses', () => {
  const s = summarize([
    rec({ host: 'a.test', path: '/items/1', ms: 100, status: 200 }), rec({ host: 'a.test', path: '/items/2', ms: 300, status: 404 }),
    rec({ host: 'b.test', method: 'POST', path: '/log', ms: 50, status: null, error: 'reset', requestBytes: 5, responseBytes: 0 }),
  ]);
  assert.deepEqual(s.hosts, [
    { host: 'a.test', requests: 2, bytesUp: 20, bytesDown: 200, statuses: { '200': 1, '404': 1 } },
    { host: 'b.test', requests: 1, bytesUp: 5, bytesDown: 0, statuses: { error: 1 } },
  ]);
  assert.deepEqual(s.endpoints, [
    { host: 'a.test', endpoint: 'GET /items/:id', count: 2, totalMs: 400, avgMs: 200, statuses: { '200': 1, '404': 1 } },
    { host: 'b.test', endpoint: 'POST /log', count: 1, totalMs: 50, avgMs: 50, statuses: { error: 1 } },
  ]);
  const lines = summaryLines(s);
  assert.match(lines[0]!, /^HOST\s+REQUESTS\s+UP\s+DOWN\s+STATUSES$/u);
  assert.ok(lines.some((l) => /^a\.test\s+2\s+20 B\s+200 B\s+200×1 404×1$/u.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /^b\.test\s+POST \/log\s+1\s+50 ms\s+50 ms\s+error×1$/u.test(l)), lines.join('\n'));
});

test('UC-5: the runs are listed newest first; a run is loaded with its records; one that does not exist is said', () => {
  makeRun('20261016-100000-aaaa', 1000, [rec({})]);
  makeRun('20261016-110000-bbbb', 2000, [rec({}), rec({})], 7);
  const runs = listRuns(dir);
  assert.deepEqual(runs.map((r) => [r.id, r.flows, r.exit]), [['20261016-110000-bbbb', 2, 7], ['20261016-100000-aaaa', 1, 0]]);
  const loaded = loadRun(dir, '20261016-110000-bbbb');
  assert.equal(loaded.records.length, 2);
  assert.throws(() => loadRun(dir, 'nope'), /no run nope in /u);
  assert.deepEqual(listRuns(join(dir, 'none')), [], 'no runs directory is no runs');
});
