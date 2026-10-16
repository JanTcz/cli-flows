// The composition root: `flows <command>` and `flows mcp` on this machine's cache, PATH and network. Proven by npm run contract.
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { type CliDeps, type Io, run } from './cli.ts';
import { cacheHome, engineDeps } from './engine-deps.ts';
import { findEngine, setupEngine } from './engine.ts';
import { mcpServer } from './mcp.ts';
import { recordRun } from './run.ts';
import { VERSION } from './version.ts';

const home = cacheHome();
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
const deps: CliDeps = {
  runsDir: join(home, 'runs'), confDir: join(home, 'mitmproxy-conf'), env,
  engine: () => findEngine(engineDeps()), setup: () => setupEngine(engineDeps()), record: recordRun,
};
const io: Io = { out: (line) => { process.stdout.write(`${line}\n`); }, err: (line) => { process.stderr.write(`${line}\n`); } };
const argv = process.argv.slice(2);

if (argv[0] === 'mcp' && argv.length === 1) {
  const handle = mcpServer((words, said) => run(words, said, deps), VERSION);
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const answer = await handle(line);
    if (answer !== undefined) process.stdout.write(`${answer}\n`);
  }
} else {
  process.exitCode = await run(argv, io, deps);
}
