// UC-1 — the engine is found or fetched (docs/features/01-record.md): mitmdump on PATH, else the one setup left in the cache;
// setup downloads the platform's official build, checks its pinned sha256, unpacks it; a mismatch or an unknown platform is
// refused by name, and nothing is run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENGINE_VERSION, type EngineDeps, findEngine, PINS, platformKey, setupEngine, unpackArchive } from '../src/engine.ts';

const dir = mkdtempSync(join(tmpdir(), 'cli-flows-engine-'));
after(() => { rmSync(dir, { recursive: true, force: true }); });

// A build as the official host serves it: a tar.gz holding the binary at the pinned path.
function build(binary: string): Uint8Array {
  const src = mkdtempSync(join(dir, 'src-'));
  mkdirSync(join(src, ...binary.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(join(src, binary), '#!/bin/sh\necho mitmdump\n');
  chmodSync(join(src, binary), 0o755);
  const out = join(dir, `build-${Math.random()}.tar.gz`);
  execFileSync('tar', ['-czf', out, '-C', src, binary.split('/')[0]!]);
  return readFileSync(out);
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function deps(over: Partial<EngineDeps> = {}): EngineDeps & { asked: string[] } {
  const asked: string[] = [];
  const bytes = build('mitmproxy.app/Contents/MacOS/mitmdump');
  return {
    asked, cache: mkdtempSync(join(dir, 'cache-')), platform: 'darwin-arm64', which: () => void 0, base: 'https://dl.test',
    pins: { 'darwin-arm64': { file: 'macos-arm64.tar.gz', sha256: sha(bytes), binary: 'mitmproxy.app/Contents/MacOS/mitmdump' } },
    fetch: (url) => { asked.push(url); return Promise.resolve(bytes); }, unpack: unpackArchive,
    ...over,
  };
}

test('UC-1: the pinned table covers the five official builds of the pinned version', () => {
  assert.equal(ENGINE_VERSION, '12.2.3');
  assert.deepEqual(Object.keys(PINS).toSorted(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']);
  assert.equal(PINS['darwin-arm64']?.sha256, '0a09ee3b82569e8985aff8186e4792618b8e5d0c766098db093d09a87d4b013a');
  assert.equal(PINS['linux-x64']?.binary, 'mitmdump');
  assert.equal(PINS['win32-x64']?.binary, 'mitmdump.exe');
  for (const pin of Object.values(PINS)) assert.match(pin.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(platformKey('darwin', 'arm64'), 'darwin-arm64');
});

test('UC-1: mitmdump on PATH is the engine; else the cached one; else none', async () => {
  assert.equal(findEngine({ ...deps(), which: () => '/opt/homebrew/bin/mitmdump' }), '/opt/homebrew/bin/mitmdump');
  const d = deps();
  assert.equal(findEngine(d), undefined);
  const path = await setupEngine(d);
  assert.equal(findEngine(d), path);
});

test('UC-1: setup fetches the official build, checks its sum, unpacks it and answers the binary', async () => {
  const d = deps();
  const path = await setupEngine(d);
  assert.deepEqual(d.asked, [`https://dl.test/${ENGINE_VERSION}/mitmproxy-${ENGINE_VERSION}-macos-arm64.tar.gz`]);
  assert.equal(path, join(d.cache, `mitmproxy-${ENGINE_VERSION}`, 'mitmproxy.app/Contents/MacOS/mitmdump'));
  assert.ok(existsSync(path));
  await setupEngine(d);
  assert.equal(d.asked.length, 1, 'an engine already in the cache is not fetched again');
});

test('UC-1: a download whose sum does not match is deleted and refused by name; nothing is unpacked', async () => {
  const d = deps({ fetch: () => Promise.resolve(new TextEncoder().encode('not the build')) });
  await assert.rejects(setupEngine(d), /the download of mitmproxy-12\.2\.3-macos-arm64\.tar\.gz has sha256 [0-9a-f]{64}, not the pinned [0-9a-f]{64}: refused, nothing run/u);
  assert.deepEqual(readdirSync(d.cache).filter((name) => !name.startsWith('.')), [], 'nothing kept');
});

test('UC-1: a platform the table does not have is refused by name', async () => {
  await assert.rejects(setupEngine(deps({ platform: 'aix-ppc64' })), /no official mitmproxy build for aix-ppc64 \(builds: darwin-arm64\); install mitmproxy so that mitmdump is on PATH/u);
});

test('UC-1: a zip build (Windows) is unpacked too', async () => {
  const src = mkdtempSync(join(dir, 'zip-'));
  writeFileSync(join(src, 'mitmdump.exe'), 'MZ');
  const zip = join(dir, 'build.zip');
  execFileSync('zip', ['-q', zip, 'mitmdump.exe'], { cwd: src });
  const into = mkdtempSync(join(dir, 'into-'));
  await unpackArchive(zip, into);
  assert.equal(readFileSync(join(into, 'mitmdump.exe'), 'utf8'), 'MZ');
  await assert.rejects(unpackArchive(join(dir, 'missing.tar.gz'), into), /cannot unpack .*missing\.tar\.gz/u);
});
