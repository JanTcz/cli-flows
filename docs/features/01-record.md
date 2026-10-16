# Slice 1 — record what a command sends, and say where it went

Owner, 2026-10-16: "ok, do toho" on docs/DESIGN.md. This slice records and summarizes; the plugin contract, `show` and `diff`
are slice 2.

## Use cases

- **UC-1 The engine is found or fetched.** `findEngine` answers `mitmdump` on `PATH`, else the one `setup` left in the cache
  (`<cache>/mitmproxy-<version>/…`), else nothing. `setupEngine` downloads the official build for the platform
  (`<base>/<version>/mitmproxy-<version>-<file>`), checks its sha256 against the pinned table, unpacks it and answers the
  binary's path; a sum that does not match deletes the download and is refused by name, nothing run; a platform the table does
  not have is refused by name; an engine already in the cache is not fetched again. Test: `test/engine.test.ts`.
- **UC-2 The wrapped command's environment.** Forward mode sets `HTTPS_PROXY`, `HTTP_PROXY` (and their lower-case forms) to the
  proxy and points every standard runtime's CA setting at the proxy's CA (`NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`,
  `SSL_CERT_FILE`, `CURL_CA_BUNDLE`, `GIT_SSL_CAINFO`); reverse mode sets none of those, but `FLOWS_PROXY_URL` and each variable
  named by `--env` to the proxy's URL. Nothing else of the caller's environment changes. Test: `test/env.test.ts`.
- **UC-3 Redaction.** Before a record touches the disk: the values of `authorization`, `proxy-authorization`, `cookie`,
  `set-cookie`, `x-api-key` and any header whose name says key, token, secret or password are `<redacted>`; in bodies, bearer
  tokens, JWTs, `sk-`/`ghp_`/`github_pat_`/`xox?-`/`AKIA` shaped keys and the values of JSON fields named like key, token,
  secret, password are `<redacted>`; nothing else changes. A body is kept up to 64 KiB, the cut said. Test: `test/redact.test.ts`.
- **UC-4 A run is recorded.** `run` starts the engine with the addon and its own config directory, waits until it listens and its
  CA exists, runs the command with UC-2's environment, receives each finished flow from the addon over a local socket, redacts it
  (UC-3) and appends it to `<runs>/<id>/flows.jsonl`; `meta.json` says the command, the mode, the start, the end and the
  command's exit code, which `run` exits with. The engine is stopped after the command, whatever happened. A command that cannot
  start is exit 127, said; an engine that does not come up within its time is said and nothing is run. Test: `test/run.test.ts`
  (a fake engine, `test/fake-mitmdump.mjs`).
- **UC-5 `ls` and `summary`.** `ls` lists the runs, newest first: id, when, flows, exit, command. `summary <run>` gives per host
  the requests, bytes up and down and the statuses, and per endpoint (method and path, ids in the path folded to `:id`) the
  count, the total and the average duration and the statuses; `--json` the same as data. A run that does not exist is said.
  Test: `test/summary.test.ts`.
- **UC-6 The CLI and its MCP twin.** `flows run [--reverse <upstream>] [--env <NAME>]… [--raw] -- <command…>`, `ls`,
  `summary <run> [--json]`, `setup`, `mcp`; usage on a mistake (exit 2). The MCP twin serves only what reads — `ls` and
  `summary`: running a command or fetching a binary is never a tool. Test: `test/cli.test.ts`, `test/mcp.test.ts`.
- **UC-7 The real engine** (`npm run contract`, not in the check — it needs the engine): forward mode against a local HTTPS
  server, the command trusting the proxy through UC-2's CA variables; reverse mode against a local HTTP upstream; each request on
  the wire, redacted as UC-3 says. Test: `test/contract/engine.test.ts`.

## The pinned engine (computed 2026-10-16 from downloads.mitmproxy.org over HTTPS)

mitmproxy publishes no checksums next to its builds, and the GitHub release of 12.2.3 has no assets to compare with: the sums
below are those of the files the official host served on that day (trust on first download), and a later download must match.

| Platform | File | sha256 | Binary in it |
|---|---|---|---|
| darwin-arm64 | macos-arm64.tar.gz | 0a09ee3b82569e8985aff8186e4792618b8e5d0c766098db093d09a87d4b013a | mitmproxy.app/Contents/MacOS/mitmdump |
| darwin-x64 | macos-x86_64.tar.gz | 7998187f5a0d399ab796af4523d3ad830ebe690726a41bc3e1df47a8e477a641 | mitmproxy.app/Contents/MacOS/mitmdump |
| linux-x64 | linux-x86_64.tar.gz | 2e95286b618fa6fd33e5e62a78c2e5112571d85f42ec2bac29b97ee242bdb5c5 | mitmdump |
| linux-arm64 | linux-aarch64.tar.gz | b358643a6c4f4b39e33d985350f660b724fece95687d7daa899ef0c4e211f681 | mitmdump |
| win32-x64 | windows-x86_64.zip | 04a01ea95ae96df75058a893e774957d294e69012dab1f4e256ce2b0c6725483 | mitmdump.exe |
