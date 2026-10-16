// A stand-in for mitmdump in the unit tests, as the real one behaves for run (test/contract/ proves the real one): it takes the
// arguments run gives (--listen-host, --listen-port, --mode, --set confdir=<dir>, -s <addon>, -q), writes its CA into the
// confdir, listens on the port, and — as the addon does — connects to FLOWS_SOCKET and sends each finished flow as a JSON line;
// then it waits for SIGTERM. FAKE_FLOWS (a JSON array) are the flows it sends; FAKE_ARGS, a file it writes its arguments to;
// FAKE_MODE=exit makes it exit at once (an engine that does not come up), FAKE_MODE=silent never listen.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
if (process.env.FAKE_ARGS) writeFileSync(process.env.FAKE_ARGS, JSON.stringify(argv));
if (process.env.FAKE_MODE === 'exit') { process.stderr.write('Error: the address is in use\n'); process.exit(1); }
if (process.env.FAKE_MODE === 'silent') setInterval(() => {}, 1000);
else {
  const confdir = argv.find((a) => a.startsWith('confdir='))?.slice('confdir='.length) ?? '';
  mkdirSync(confdir, { recursive: true });
  writeFileSync(join(confdir, 'mitmproxy-ca-cert.pem'), '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n');
  const server = createServer((socket) => socket.end());
  server.listen(Number(flag('--listen-port')), flag('--listen-host'), () => {
    const flows = JSON.parse(process.env.FAKE_FLOWS ?? '[]');
    const out = createConnection(process.env.FLOWS_SOCKET, () => {
      for (const flow of flows) out.write(`${JSON.stringify(flow)}\n`);
    });
    process.on('SIGTERM', () => { out.end(() => { server.close(); process.exit(0); }); });
  });
  if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, 'started\n');
}
