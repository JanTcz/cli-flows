// The engine's world as it is on this machine: the cache under XDG_CACHE_HOME (or FLOWS_CACHE), the platform, PATH, fetch.
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { type EngineDeps, platformKey, unpackArchive } from './engine.ts';

type Env = Readonly<Record<string, string | undefined>>;

export const cacheHome = (env: Env = process.env): string => env['FLOWS_CACHE'] ?? join(env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), 'cli-flows');

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// The first executable file of that name in PATH's directories.
export const which = (name: string, env: Env = process.env): string | undefined =>
  (env['PATH'] ?? '').split(delimiter).filter((dir) => dir !== '').map((dir) => join(dir, name)).find((path) => executable(path));

export async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export const engineDeps = (env: Env = process.env): EngineDeps => ({
  cache: cacheHome(env), platform: platformKey(process.platform, process.arch), which: (name) => which(name, env), fetch: download, unpack: unpackArchive,
});
