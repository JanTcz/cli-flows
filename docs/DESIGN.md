# cli-flows — what flows here (design draft, 2026-10-16)

`flows run -- <command>` runs a command through a man-in-the-middle proxy and records what it sends and receives over HTTP(S);
`flows summary` answers "what flows here": which hosts, which endpoints, how much, how often, with what status. A tool of the
`cli-*` family: CLI, its MCP twin, a skill, a plugin in the marketplace, 100 % coverage, RED contracts.

The repository is generic: it knows HTTP, TLS, proxies and runtimes — no particular product or service. What is specific to
one (how to point it at the proxy, how to read its API) is a **local plugin** of the person who runs it, outside this
repository.

## Why

- Knowing what a program really sends and where — the hosts it calls, the requests as sent, the headers.
- Debugging a client that fails against an API: the exact request, not the client's account of it.
- Comparing two runs: what changed between them (`flows diff`).

## Commands (first cut)

```
flows run [--all] [--raw] [--plugin <name>] -- <command…>
flows ls                       the recorded runs
flows summary <run>            hosts, endpoints, counts, bytes, durations, statuses
flows show <run> <n>           one request whole (redacted)
flows diff <run-a> <run-b>     new hosts, changed sizes, headers, statuses
flows setup                    fetch the proxy engine (see below)
flows plugins                  the local plugins found, and what each adds
flows mcp                      the same as MCP tools
```

- **Two modes.** Forward (default): `HTTPS_PROXY`/`HTTP_PROXY`, and the proxy's CA trusted per runtime through the variables each
  standard runtime reads (Node, Python, curl, git, Go). Reverse (`--reverse <upstream>`): the command is pointed at the proxy as
  its upstream, no CA needed — for a program that takes a base URL. Only the wrapped process's environment changes — no system
  settings, no other process affected.
- **Safe by default.** Secret headers (`authorization`, `x-api-key`, `cookie`, `set-cookie`, `proxy-authorization`) and token
  patterns in bodies are redacted in the record. The raw capture (secrets included) only with `--raw`. Runs are kept in
  `~/.cache/cli-flows/runs/`, never in the working directory.

## Local plugins — what this repository does not hold

A plugin is a module in `~/.config/cli-flows/plugins/<name>/` (or a path given by `FLOWS_PLUGINS`), loaded at run time and
never shipped. It may add:
- a **preset**: the environment that points one program at the proxy (its base-URL variable, its own CA setting);
- an **analyzer**: how to read one API's requests and responses (the parts of a message, its sizes, its usage figures) for
  `summary`, `show` and `diff`;
- **redactions**: the secret fields of one API beyond the generic ones.

The repository defines the plugin contract (an abstract class, as the other `cli-*` tools do), a generic JSON analyzer and the
tests of the contract; `flows plugins` lists what is loaded. Nothing in the repository, its docs or its tests names a product.

## The engine: mitmproxy, fetched — not shipped, not installed by npm

mitmproxy is the de facto MITM proxy (a tool, not an MCP server). Node can do TLS but cannot create X.509 certificates, so an own
MITM would need a third-party certificate library — more work and more dependency than it pays.

- `mitmdump` on `PATH` (a package manager, pipx, uvx) is used as it is.
- Else `flows setup` (or the first `run`, after saying so) downloads the official standalone build for the platform from
  `downloads.mitmproxy.org` into `~/.cache/cli-flows/mitmproxy-<version>/`. Verified 2026-10-16 for 12.2.3: macOS arm64 and
  x86_64, Linux x86_64 and aarch64, Windows x86_64.
- **No postinstall script**: many run npm with `--ignore-scripts`, and a package that downloads binaries on install is what
  supply-chain checks flag.
- **Checksums pinned in the package.** mitmproxy publishes none next to the builds (checked 2026-10-16), so the package carries a
  sha256 per platform for its pinned version, computed when the version is bumped and cross-checked against the digest GitHub
  shows for the release's assets. A download that does not match is deleted and refused by name; nothing is run.

## Shape

TypeScript run by Node, no runtime dependencies (mitmproxy is an external engine behind one module, `src/engine.ts`), one
catalog for the CLI and the MCP twin, `npm run check` (oxlint, strict tsc, `node --test` at 100 %), a RED contract per slice, an
`agents/` plugin with a skill, a release on a version tag with Trusted Publishing.

## Slices

1. `run` (forward and reverse), the mitmproxy addon writing redacted JSONL, `ls`, `summary`; the engine found on `PATH` or
   fetched with `setup` (checksums); the MCP twin.
2. The plugin contract and its loader (`plugins`, presets, analyzers, redactions), `show`, `diff`.

## Open

- The name: `cli-flows` (command `flows`, "what flows here"; MITM in the description) — or `cli-mitm`.
