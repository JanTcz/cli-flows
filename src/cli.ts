// The command line (UC-6): run, ls, summary, setup — and mcp, which main serves. Usage on a mistake, exit 2; a failure, one line
// `flows: …` and exit 1; a run exits with its command's code.
import { table, utc } from './format.ts';
import type { Io, Mode, RunOptions } from './run.ts';
import { listRuns, loadRun } from './runs.ts';
import { summarize, summaryLines } from './summary.ts';

export type { Io };
export type CliDeps = {
  runsDir: string; confDir: string; env: Readonly<Record<string, string>>;
  engine: () => string | undefined; setup: () => Promise<string>; record: (options: RunOptions) => Promise<{ id: string; exit: number }>;
};

const RUN_TIMEOUT_MS = 30_000;
const USAGE = 'usage: flows <run|ls|summary|setup|mcp> …';
const RUN_USAGE = 'usage: flows run [--reverse <upstream> [--env <NAME>]…] [--raw] -- <command…>';
const HELP = [
  USAGE, '',
  '  run [--reverse <upstream> [--env <NAME>]…] [--raw] -- <command…>   record what the command sends (forward mode by default)',
  '  ls [--json]                                                       the recorded runs, newest first',
  '  summary <run> [--json]                                            per host and per endpoint: counts, bytes, durations, statuses',
  '  setup                                                             fetch the official mitmproxy build, checked against its pinned sha256',
  '  mcp                                                               ls and summary as MCP tools over stdio',
];

class UsageError extends Error {}

function parseRun(argv: readonly string[]): { mode: Mode; raw: boolean; command: string[] } {
  const split = argv.indexOf('--');
  if (split === -1 || split === argv.length - 1) throw new UsageError('give the command after --');
  let upstream: string | undefined;
  const env: string[] = [];
  let raw = false;
  const options = argv.slice(0, split);
  for (let at = 0; at < options.length; at++) {
    const word = options[at]!;
    if (word === '--raw') raw = true;
    else if (word === '--reverse' || word === '--env') {
      const value = options[++at];
      if (value === undefined) throw new UsageError(`${word} needs a value`);
      if (word === '--reverse') upstream = value;
      else env.push(value);
    } else throw new UsageError(`run takes no ${word}`);
  }
  if (upstream === undefined && env.length > 0) throw new UsageError('--env goes with --reverse');
  return { mode: upstream === undefined ? { kind: 'forward' } : { kind: 'reverse', upstream, env }, raw, command: argv.slice(split + 1) };
}

async function runCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  let parsed;
  try {
    parsed = parseRun(argv);
  } catch (error) {
    io.err(`flows: ${(error as Error).message}`);
    io.err(RUN_USAGE);
    return 2;
  }
  const engine = deps.engine();
  if (engine === undefined) {
    io.err('flows: no mitmdump on PATH and none fetched: run `flows setup` (or install mitmproxy)');
    return 1;
  }
  const result = await deps.record({ ...parsed, engine: [engine], runsDir: deps.runsDir, confDir: deps.confDir, env: deps.env, timeoutMs: RUN_TIMEOUT_MS, io });
  return result.exit;
}

function ls(json: boolean, io: Io, deps: CliDeps): void {
  const runs = listRuns(deps.runsDir);
  if (json) { io.out(JSON.stringify(runs, null, 2)); return; }
  if (runs.length === 0) { io.out('no runs recorded yet: flows run -- <command>'); return; }
  for (const line of table([['RUN', 'STARTED', 'FLOWS', 'EXIT', 'COMMAND'], ...runs.map((r) => [r.id, utc(r.started), String(r.flows), String(r.exit), r.command.join(' ')])])) io.out(line);
}

export async function run(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === '--help' || command === '-h') { for (const line of HELP) io.out(line); return 0; }
    if (command === 'run') return await runCommand(rest, io, deps);
    if (command === 'setup' && rest.length === 0) { io.out(`mitmdump ready: ${await deps.setup()}`); return 0; }
    const json = rest.includes('--json');
    const args = rest.filter((word) => word !== '--json');
    if (command === 'ls' && args.length === 0) { ls(json, io, deps); return 0; }
    if (command === 'summary' && args.length === 1) {
      const summary = summarize(loadRun(deps.runsDir, args[0]!).records);
      for (const line of json ? JSON.stringify(summary, null, 2).split('\n') : summaryLines(summary)) io.out(line);
      return 0;
    }
  } catch (error) {
    io.err(`flows: ${(error as Error).message}`);
    return 1;
  }
  io.err(command === undefined ? 'flows: no command given' : `flows: ${[command, ...rest].join(' ')} is not a command`);
  io.err(USAGE);
  return 2;
}
