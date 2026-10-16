# cli-flows — how to work here

Read `docs/DESIGN.md` first. `flows` runs a command through a man-in-the-middle proxy (the mitmproxy engine) and says what flows
where; `flows mcp` serves its read-only commands as MCP tools.

- **Generic in this repository.** Built in only what vendors document publicly (proxy and gateway settings, public API formats),
  worded neutrally; anything about undocumented or internal traffic of a particular product lives in local plugins, never here —
  not in code, docs, tests or commit messages.
- **Safe by default.** Redaction before a record touches the disk; the raw capture only on request; runs in the cache, never in
  the working directory. The MCP twin never runs a command or fetches a binary.
- **The engine is external.** mitmdump on PATH, or the official build fetched by `flows setup` and checked against the sha256
  pinned in `src/engine.ts` — never installed by npm, never a postinstall script.
- **The contract comes first:** a slice is agreed (`docs/DESIGN.md`), then `docs/features/<nn>-<slice>.md` with UC-1..n and a RED
  test (`UC-n:` titles) committed before the code (`--no-verify`, red only in that slice's tests).
- **`npm run check` is green before every commit** (the hook in `hooks/`, `npm run hooks`): pedantic `oxlint`, strict `tsc`,
  `node --test` at **100 %** line, branch and function coverage of `src` (`src/main.ts` aside). `npm run contract` proves the real
  engine (it needs one); the addon `src/addon/flows_addon.py` is proven there.
- Silence is never a success: empty, skipped and unmeasured say so.
