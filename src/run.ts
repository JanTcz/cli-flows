// A run, recorded (UC-4): the engine started on a free local port with the addon and its own confdir; once it listens and its CA
// exists, the command runs with UC-2's environment; each finished flow arrives from the addon over a local socket, is redacted
// (UC-3) and appended to <runs>/<id>/flows.jsonl. meta.json says the run; the command's exit code is the run's. The engine is
// stopped after the command, whatever happened.
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Server } from 'node:net';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forwardEnv, reverseEnv } from './env.ts';
import { type RawFlow, toRecord } from './record.ts';

export type Io = { out: (line: string) => void; err: (line: string) => void };
export type Mode = { kind: 'forward' } | { kind: 'reverse'; upstream: string; env: string[] };
export type RunOptions = {
  command: string[]; mode: Mode; runsDir: string; confDir: string; engine: string[]; raw: boolean; timeoutMs: number;
  env: Readonly<Record<string, string>>; io: Io;
  // How long the engine has to stop after SIGTERM before it is killed; STOP_MS when not given.
  stopMs?: number;
};
export type RunMeta = { id: string; command: string[]; mode: Mode; started: number; ended: number; exit: number; flows: number };

// The mitmproxy addon that sends each flow to the recorder; it ships beside this module.
export const ADDON = fileURLToPath(new URL('addon/flows_addon.py', import.meta.url));
const POLL_MS = 50;
const STOP_MS = 5000;

const runId = (at: Date): string => `${at.toISOString().slice(0, 19).replaceAll(/[-:]/gu, '').replace('T', '-')}-${randomBytes(2).toString('hex')}`;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => { resolve(port); });
    });
  });
}

const listening = (port: number): Promise<boolean> => new Promise((resolve) => {
  const socket = connect(port, '127.0.0.1', () => { socket.destroy(); resolve(true); });
  socket.on('error', () => { resolve(false); });
});

// The recorder: a local socket the addon writes JSON lines to, each line a flow, redacted as it is appended.
function recorder(path: string, flows: string): { server: Server; count: () => number } {
  let n = 0;
  const server = createServer((socket) => {
    let pending = '';
    socket.setEncoding('utf8').on('data', (chunk: string) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop()!;
      for (const line of lines.filter((l) => l.trim() !== '')) appendFileSync(flows, `${JSON.stringify(toRecord(JSON.parse(line) as RawFlow, n++))}\n`);
    });
  });
  server.listen(path);
  return { server, count: () => n };
}

// The engine up — listening, its CA written — or why not.
async function started(engine: ChildProcess, port: number, ca: string, timeoutMs: number, stderr: () => string): Promise<void> {
  let exited: number | null | undefined;
  engine.on('exit', (code) => { exited = code; });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (exited !== undefined) throw new Error(`the engine exited before it listened (exit ${exited}): ${stderr().trim().split('\n').at(-1)}`);
    // oxlint-disable-next-line no-await-in-loop -- polled until it answers
    if (existsSync(ca) && await listening(port)) return;
    if (Date.now() > deadline) throw new Error(`the engine did not listen within ${timeoutMs} ms`);
    // oxlint-disable-next-line no-await-in-loop -- the poll's pause
    await new Promise((resolve) => { setTimeout(resolve, POLL_MS); });
  }
}

function stop(engine: ChildProcess, stopMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (engine.exitCode !== null || engine.signalCode !== null) { resolve(); return; }
    const kill = setTimeout(() => { engine.kill('SIGKILL'); }, stopMs);
    engine.on('exit', () => { clearTimeout(kill); resolve(); });
    engine.kill('SIGTERM');
  });
}

function runCommand(command: string[], env: Record<string, string>, io: Io): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command[0]!, command.slice(1), { env, stdio: 'inherit' });
    child.on('error', (error: NodeJS.ErrnoException) => { io.err(`flows: cannot start ${command[0]}: ${error.code}`); resolve(127); });
    child.on('exit', (code, signal) => { resolve(code ?? 128 + constants.signals[signal!]); });
  });
}

export async function recordRun(o: RunOptions): Promise<{ id: string; exit: number }> {
  const startedAt = Date.now();
  const id = runId(new Date(startedAt));
  const run = join(o.runsDir, id);
  mkdirSync(run, { recursive: true });
  const flows = join(run, 'flows.jsonl');
  writeFileSync(flows, '');
  const sockets = mkdtempSync(join(tmpdir(), 'cli-flows-'));
  const socket = join(sockets, 's');
  const rec = recorder(socket, flows);
  const port = await freePort();
  const mode = o.mode.kind === 'forward' ? 'regular' : `reverse:${o.mode.upstream}`;
  let stderr = '';
  const engine = spawn(o.engine[0]!, [...o.engine.slice(1), '--listen-host', '127.0.0.1', '--listen-port', String(port), '--mode', mode,
    '--set', `confdir=${o.confDir}`, '-s', ADDON, '-q', ...(o.raw ? ['-w', join(run, 'raw.flow')] : [])],
  { env: { ...o.env, FLOWS_SOCKET: socket }, stdio: ['ignore', 'ignore', 'pipe'] });
  engine.stderr!.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
  const proxy = `http://127.0.0.1:${port}`;
  let exit: number;
  try {
    await started(engine, port, join(o.confDir, 'mitmproxy-ca-cert.pem'), o.timeoutMs, () => stderr);
    const env = o.mode.kind === 'forward' ? forwardEnv(o.env, proxy, join(o.confDir, 'mitmproxy-ca-cert.pem')) : reverseEnv(o.env, proxy, o.mode.env);
    exit = await runCommand(o.command, env, o.io);
  } catch (error) {
    await stop(engine, o.stopMs ?? STOP_MS);
    rec.server.close();
    rmSync(run, { recursive: true, force: true });
    rmSync(sockets, { recursive: true, force: true });
    throw error;
  }
  await stop(engine, o.stopMs ?? STOP_MS);
  await new Promise<void>((resolve) => { rec.server.close(() => { resolve(); }); });
  rmSync(sockets, { recursive: true, force: true });
  const meta: RunMeta = { id, command: o.command, mode: o.mode, started: startedAt, ended: Date.now(), exit, flows: rec.count() };
  writeFileSync(join(run, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  o.io.err(`flows: run ${id}: ${meta.flows} flows recorded; flows summary ${id}`);
  return { id, exit };
}
