// UC-6 — the MCP twin (docs/features/01-record.md): it serves only what reads — ls and summary; running a command or fetching a
// binary is never a tool. Each call runs the CLI with those words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpServer, TOOLS } from '../src/mcp.ts';

function server() {
  const ran: string[][] = [];
  const handle = mcpServer((argv, io) => { ran.push(argv); io.out('done'); return Promise.resolve(0); }, '0.1.0');
  const ask = async (message: object) => JSON.parse((await handle(JSON.stringify({ jsonrpc: '2.0', ...message })))!) as { result?: any; error?: { code: number; message: string } };
  return { ask, ran, handle };
}

test('UC-6: the tools are ls and summary only, both read-only', async () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ['ls', 'summary']);
  const { ask } = server();
  const listed = (await ask({ id: 1, method: 'tools/list' })).result.tools as { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean }; inputSchema: { required: string[] } }[];
  assert.deepEqual(listed.map((t) => [t.name, t.annotations.readOnlyHint, t.annotations.destructiveHint]), [['ls', true, false], ['summary', true, false]]);
  assert.deepEqual(listed[1]?.inputSchema.required, ['run']);
});

test('UC-6: a call runs the CLI; run and setup are no tools', async () => {
  const { ask, ran } = server();
  const answer = await ask({ id: 2, method: 'tools/call', params: { name: 'summary', arguments: { run: 'r1', json: true } } });
  assert.deepEqual(ran, [['summary', 'r1', '--json']]);
  assert.deepEqual(answer.result, { content: [{ type: 'text', text: 'done' }], isError: false });
  await ask({ id: 3, method: 'tools/call', params: { name: 'ls', arguments: {} } });
  assert.deepEqual(ran[1], ['ls']);
  for (const name of ['run', 'setup']) {
    assert.deepEqual((await ask({ id: 4, method: 'tools/call', params: { name, arguments: {} } })).error, { code: -32_602, message: `no tool ${name}` });
  }
  assert.deepEqual((await ask({ id: 5, method: 'tools/call', params: { name: 'summary', arguments: {} } })).error, { code: -32_602, message: 'summary: run is required' });
  assert.deepEqual((await ask({ id: 6, method: 'tools/call', params: { name: 'summary', arguments: { run: 1 } } })).error, { code: -32_602, message: 'summary: run is a string' });
  assert.deepEqual((await ask({ id: 7, method: 'tools/call', params: { name: 'ls', arguments: { x: '1' } } })).error, { code: -32_602, message: 'ls: no argument x' });
  assert.deepEqual((await ask({ id: 8, method: 'tools/call', params: { name: 'ls', arguments: { json: 'yes' } } })).error, { code: -32_602, message: 'ls: json is a boolean' });
});

test('UC-6: initialize, ping, notifications, unknown methods and bad lines', async () => {
  const { ask, handle } = server();
  assert.equal((await ask({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })).result.serverInfo.name, 'flows');
  assert.equal((await ask({ id: 2, method: 'initialize', params: {} })).result.protocolVersion, '2025-06-18');
  assert.deepEqual((await ask({ id: 3, method: 'ping' })).result, {});
  assert.equal(await handle(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })), undefined);
  assert.equal(await handle(''), undefined);
  assert.deepEqual((await ask({ id: 4, method: 'resources/list' })).error, { code: -32_601, message: 'no method resources/list' });
  assert.deepEqual(JSON.parse((await handle('{bad'))!), { jsonrpc: '2.0', id: null, error: { code: -32_700, message: 'not JSON' } });
  const failing = mcpServer((_argv, io) => { io.err('flows: no run x'); return Promise.resolve(1); }, '0');
  assert.deepEqual(JSON.parse((await failing(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'summary', arguments: { run: 'x' } } })))!).result, { content: [{ type: 'text', text: 'flows: no run x' }], isError: true });
});
