// `flows mcp` (UC-6): the commands that read — ls and summary — as MCP tools over stdio (newline-delimited JSON-RPC 2.0, by hand,
// as the other cli- tools do). Running a command or fetching a binary is never a tool. Each call runs the CLI itself.
import type { Io } from './run.ts';

export type Cli = (argv: string[], io: Io) => Promise<number>;
type Message = { id?: number | string | null; method?: string; params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> } };
type Tool = { name: string; args: readonly string[]; summary: string };

export const TOOLS: readonly Tool[] = [
  { name: 'ls', args: [], summary: 'the recorded runs, newest first: id, when, flows, exit, command' },
  { name: 'summary', args: ['run'], summary: 'what flowed in a run: per host and per endpoint the counts, bytes, durations and statuses' },
];
const PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'];

const answer = (id: Message['id'], result: unknown): string => JSON.stringify({ jsonrpc: '2.0', id, result });
const fault = (id: Message['id'], code: number, message: string): string => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
const SILENCE: Promise<string | undefined> = Promise.resolve(void 0);

const toolOf = (tool: Tool) => ({
  name: tool.name, description: tool.summary,
  inputSchema: { type: 'object', additionalProperties: false, required: [...tool.args],
    properties: { ...Object.fromEntries(tool.args.map((arg) => [arg, { type: 'string' }])), json: { type: 'boolean', description: 'the whole answer as JSON' } } },
  annotations: { title: `flows ${tool.name}`, readOnlyHint: true, destructiveHint: false, openWorldHint: false },
});

function argvOf(tool: Tool, given: Record<string, unknown>): string[] {
  for (const [key, value] of Object.entries(given)) {
    if (key === 'json') {
      if (typeof value !== 'boolean') throw new TypeError(`${tool.name}: json is a boolean`);
    } else if (!tool.args.includes(key)) throw new TypeError(`${tool.name}: no argument ${key}`);
    else if (typeof value !== 'string') throw new TypeError(`${tool.name}: ${key} is a string`);
  }
  const missing = tool.args.find((arg) => given[arg] === undefined);
  if (missing !== undefined) throw new TypeError(`${tool.name}: ${missing} is required`);
  return [tool.name, ...tool.args.map((arg) => given[arg] as string), ...(given['json'] === true ? ['--json'] : [])];
}

export function mcpServer(cli: Cli, version: string): (line: string) => Promise<string | undefined> {
  async function call(id: Message['id'], params: Message['params']): Promise<string> {
    const tool = TOOLS.find((one) => one.name === params?.name);
    if (!tool) return fault(id, -32_602, `no tool ${params?.name}`);
    let argv: string[];
    try {
      argv = argvOf(tool, params?.arguments ?? {});
    } catch (error) {
      return fault(id, -32_602, (error as Error).message);
    }
    const said: string[] = [];
    const code = await cli(argv, { out: (line) => said.push(line), err: (line) => said.push(line) });
    return answer(id, { content: [{ type: 'text', text: said.join('\n') }], isError: code !== 0 });
  }
  return (line) => {
    if (line.trim() === '') return SILENCE;
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      return Promise.resolve(fault(null, -32_700, 'not JSON'));
    }
    const { id, method, params } = message;
    if (id === undefined) return SILENCE;
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        return Promise.resolve(answer(id, { protocolVersion: PROTOCOLS.includes(asked!) ? asked : PROTOCOLS.at(-1), capabilities: { tools: {} }, serverInfo: { name: 'flows', version } }));
      }
      case 'ping': return Promise.resolve(answer(id, {}));
      case 'tools/list': return Promise.resolve(answer(id, { tools: TOOLS.map((tool) => toolOf(tool)) }));
      case 'tools/call': return call(id, params);
      default: return Promise.resolve(fault(id, -32_601, `no method ${method}`));
    }
  };
}
