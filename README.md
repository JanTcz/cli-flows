# cli-flows

`flows` — what flows here: run a command through a man-in-the-middle proxy and see which hosts and endpoints it talks to, how
much and how often. Redacted by default. A CLI and its MCP twin.

```
flows run -- curl https://example.com/      # record what the command sends
flows ls                                    # the recorded runs
flows summary <run>                         # per host and per endpoint: counts, bytes, durations, statuses
```

Design: [docs/DESIGN.md](docs/DESIGN.md). Requires Node ≥ 26 and mitmproxy (`flows setup` fetches the official build). MIT.
