// The proxy engine (UC-1): mitmproxy's mitmdump — on PATH as it is, else the official standalone build fetched by `setup` into the
// cache and checked against the sha256 pinned here. mitmproxy publishes no checksums next to its builds, so these are the sums
// of the files its host served on 2026-10-16 (docs/features/01-record.md): a later download must match them, or nothing runs.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ENGINE_VERSION = '12.2.3';
export const ENGINE_BASE = 'https://downloads.mitmproxy.org';

// One official build: its file on the host, its sha256, and where mitmdump stands inside it.
export type Pin = { file: string; sha256: string; binary: string };
const MACOS_BINARY = 'mitmproxy.app/Contents/MacOS/mitmdump';
export const PINS: Readonly<Record<string, Pin>> = {
  'darwin-arm64': { file: 'macos-arm64.tar.gz', sha256: '0a09ee3b82569e8985aff8186e4792618b8e5d0c766098db093d09a87d4b013a', binary: MACOS_BINARY },
  'darwin-x64': { file: 'macos-x86_64.tar.gz', sha256: '7998187f5a0d399ab796af4523d3ad830ebe690726a41bc3e1df47a8e477a641', binary: MACOS_BINARY },
  'linux-x64': { file: 'linux-x86_64.tar.gz', sha256: '2e95286b618fa6fd33e5e62a78c2e5112571d85f42ec2bac29b97ee242bdb5c5', binary: 'mitmdump' },
  'linux-arm64': { file: 'linux-aarch64.tar.gz', sha256: 'b358643a6c4f4b39e33d985350f660b724fece95687d7daa899ef0c4e211f681', binary: 'mitmdump' },
  'win32-x64': { file: 'windows-x86_64.zip', sha256: '04a01ea95ae96df75058a893e774957d294e69012dab1f4e256ce2b0c6725483', binary: 'mitmdump.exe' },
};

export const platformKey = (platform: string, arch: string): string => `${platform}-${arch}`;

// What finding and fetching the engine reads of the world — the cache, the platform, PATH, the network, unpacking.
export type EngineDeps = {
  cache: string; platform: string; which: (name: string) => string | undefined;
  fetch: (url: string) => Promise<Uint8Array>; unpack: (archive: string, into: string) => Promise<void>;
  base?: string; pins?: Readonly<Record<string, Pin>>;
};

const homeOf = (cache: string): string => join(cache, `mitmproxy-${ENGINE_VERSION}`);

export function findEngine(deps: EngineDeps): string | undefined {
  const onPath = deps.which('mitmdump');
  if (onPath !== undefined) return onPath;
  const pin = (deps.pins ?? PINS)[deps.platform];
  const path = pin && join(homeOf(deps.cache), pin.binary);
  return path !== undefined && existsSync(path) ? path : undefined;
}

export async function setupEngine(deps: EngineDeps): Promise<string> {
  const pins = deps.pins ?? PINS;
  const pin = pins[deps.platform];
  if (!pin) throw new Error(`no official mitmproxy build for ${deps.platform} (builds: ${Object.keys(pins).join(', ')}); install mitmproxy so that mitmdump is on PATH`);
  const home = homeOf(deps.cache);
  const binary = join(home, pin.binary);
  if (existsSync(binary)) return binary;
  const name = `mitmproxy-${ENGINE_VERSION}-${pin.file}`;
  const bytes = await deps.fetch(`${deps.base ?? ENGINE_BASE}/${ENGINE_VERSION}/${name}`);
  const sum = createHash('sha256').update(bytes).digest('hex');
  if (sum !== pin.sha256) throw new Error(`the download of ${name} has sha256 ${sum}, not the pinned ${pin.sha256}: refused, nothing run`);
  mkdirSync(deps.cache, { recursive: true });
  const archive = join(deps.cache, `.${name}`);
  const staging = `${home}.part`;
  writeFileSync(archive, bytes);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    await deps.unpack(archive, staging);
    renameSync(staging, home);
  } finally {
    rmSync(archive, { force: true });
    rmSync(staging, { recursive: true, force: true });
  }
  return binary;
}

// A build unpacked by the system's own tools: unzip for a zip, tar for the rest.
export function unpackArchive(archive: string, into: string): Promise<void> {
  const [tool, args] = archive.endsWith('.zip') ? ['unzip', ['-q', archive, '-d', into]] : ['tar', ['-xzf', archive, '-C', into]];
  return new Promise((resolve, reject) => {
    execFile(tool, args, (error, _out, err) => { if (error) reject(new Error(`cannot unpack ${archive}: ${[err.trim(), error.message].find(Boolean)}`)); else resolve(); });
  });
}
