// A flow as the addon sends it, and as it is recorded — redacted (UC-3, UC-4).
import { type Header, redactBody, redactHeaders } from './redact.ts';

type RawMessage = { headers: Header[]; size: number; body: string | null };
export type RawFlow = {
  start: number; end: number; method: string; scheme: string; host: string; port: number; path: string;
  status: number | null; error: string | null; request: RawMessage; response: RawMessage | null;
};
export type FlowRecord = {
  n: number; start: number; ms: number; method: string; url: string; host: string; path: string; status: number | null; error: string | null;
  requestHeaders: Header[]; responseHeaders: Header[]; requestBytes: number; responseBytes: number;
  requestBody?: string; responseBody?: string; cut?: ('request' | 'response')[];
};

const DEFAULT_PORT: Readonly<Record<string, number>> = { http: 80, https: 443 };

export function toRecord(raw: RawFlow, n: number): FlowRecord {
  const port = DEFAULT_PORT[raw.scheme] === raw.port ? '' : `:${raw.port}`;
  const bodies: Partial<FlowRecord> = {};
  const cut: ('request' | 'response')[] = [];
  for (const [side, message] of [['request', raw.request], ['response', raw.response]] as const) {
    if (!message?.body) continue;
    const said = redactBody(message.body);
    bodies[side === 'request' ? 'requestBody' : 'responseBody'] = said.text;
    if (said.cut) cut.push(side);
  }
  return {
    n, start: Math.round(raw.start * 1000), ms: Math.round((raw.end - raw.start) * 1000), method: raw.method,
    url: `${raw.scheme}://${raw.host}${port}${raw.path}`, host: raw.host, path: raw.path, status: raw.status, error: raw.error,
    requestHeaders: redactHeaders(raw.request.headers), responseHeaders: redactHeaders(raw.response?.headers ?? []),
    requestBytes: raw.request.size, responseBytes: raw.response?.size ?? 0, ...bodies, ...(cut.length > 0 ? { cut } : {}),
  };
}
