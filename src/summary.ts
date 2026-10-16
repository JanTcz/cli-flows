// What flows here (UC-5): per host the requests, bytes up and down, statuses; per endpoint — the method and the path, its ids
// folded to :id and its query left out — the count, the total and the average duration, the statuses.
import { bytes, statusesText, table } from './format.ts';
import type { FlowRecord } from './record.ts';

const ID = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,})$/iu;

export const endpointOf = (method: string, path: string): string =>
  `${method} ${path.split('?')[0]!.split('/').map((segment) => (ID.test(segment) ? ':id' : segment)).join('/')}`;

export type HostSummary = { host: string; requests: number; bytesUp: number; bytesDown: number; statuses: Record<string, number> };
export type EndpointSummary = { host: string; endpoint: string; count: number; totalMs: number; avgMs: number; statuses: Record<string, number> };
export type Summary = { flows: number; hosts: HostSummary[]; endpoints: EndpointSummary[] };

// Bigger first, then by host name.
const order = <T extends { host: string }>(a: T, b: T, size: (x: T) => number): number => size(b) - size(a) || a.host.localeCompare(b.host);
const statusOf = (r: FlowRecord): string => (r.status === null ? 'error' : String(r.status));
const counted = (statuses: Record<string, number>, status: string): Record<string, number> => ({ ...statuses, [status]: (statuses[status] ?? 0) + 1 });

export function summarize(records: readonly FlowRecord[]): Summary {
  const hosts = new Map<string, HostSummary>();
  const endpoints = new Map<string, EndpointSummary>();
  for (const r of records) {
    const h = hosts.get(r.host) ?? { host: r.host, requests: 0, bytesUp: 0, bytesDown: 0, statuses: {} };
    hosts.set(r.host, { ...h, requests: h.requests + 1, bytesUp: h.bytesUp + r.requestBytes, bytesDown: h.bytesDown + r.responseBytes, statuses: counted(h.statuses, statusOf(r)) });
    const endpoint = endpointOf(r.method, r.path);
    const key = `${r.host} ${endpoint}`;
    const e = endpoints.get(key) ?? { host: r.host, endpoint, count: 0, totalMs: 0, avgMs: 0, statuses: {} };
    const count = e.count + 1;
    const totalMs = e.totalMs + r.ms;
    endpoints.set(key, { ...e, count, totalMs, avgMs: Math.round(totalMs / count), statuses: counted(e.statuses, statusOf(r)) });
  }
  return {
    flows: records.length,
    hosts: [...hosts.values()].toSorted((a, b) => order(a, b, (x) => x.requests)),
    endpoints: [...endpoints.values()].toSorted((a, b) => order(a, b, (x) => x.count)),
  };
}

export function summaryLines(s: Summary): string[] {
  if (s.flows === 0) return ['no flows recorded: the command sent nothing through the proxy (in forward mode, does it read HTTPS_PROXY?)'];
  return [
    ...table([['HOST', 'REQUESTS', 'UP', 'DOWN', 'STATUSES'], ...s.hosts.map((h) => [h.host, String(h.requests), bytes(h.bytesUp), bytes(h.bytesDown), statusesText(h.statuses)])]),
    '',
    ...table([['HOST', 'ENDPOINT', 'COUNT', 'TOTAL', 'AVG', 'STATUSES'], ...s.endpoints.map((e) => [e.host, e.endpoint, String(e.count), `${e.totalMs} ms`, `${e.avgMs} ms`, statusesText(e.statuses)])]),
  ];
}
