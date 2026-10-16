// The recorded runs (UC-5): each a directory of the runs directory with its meta.json and flows.jsonl.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowRecord } from './record.ts';
import type { RunMeta } from './run.ts';

export function listRuns(dir: string): RunMeta[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => existsSync(join(dir, name, 'meta.json')))
    .map((name) => JSON.parse(readFileSync(join(dir, name, 'meta.json'), 'utf8')) as RunMeta)
    .toSorted((a, b) => b.started - a.started);
}

export function loadRun(dir: string, id: string): { meta: RunMeta; records: FlowRecord[] } {
  const at = join(dir, id);
  if (!existsSync(join(at, 'meta.json'))) throw new Error(`no run ${id} in ${dir}`);
  const records = readFileSync(join(at, 'flows.jsonl'), 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as FlowRecord);
  return { meta: JSON.parse(readFileSync(join(at, 'meta.json'), 'utf8')) as RunMeta, records };
}
