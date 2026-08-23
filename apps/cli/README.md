# cw-duel

**Run the same coding task against two AI engines. Compare the results. Pick the winner.**

`cw-duel` is a CLI companion to a local [CodeWave](../../README.md) daemon:

```
cw-duel "Add input validation to calc.js" --providers opencode,qwen
```

Each provider runs in its own lane (session + run) inside the daemon, with the
daemon's usual approval policy and run ledger fully enforced. When every lane
reaches a terminal state you get, per lane:

- final status (`completed` / `failed` / `awaiting_approval`) and duration
- changed-file summary (diffed against the run's `preRunCommit`)
- the agent's final message

## Requirements

- Node.js ≥ 20
- A running CodeWave daemon (default `http://127.0.0.1:4120`, override with `--daemon`)
- The providers you name must be **enabled** in the daemon's provider registry
  (paid/BYOK engines like Qwen or Gemini stay off until you explicitly enable them)

## Usage

```
cw-duel "<prompt>" --providers <id,id[,id]> [--workspace <path>] [--daemon <url>] [--json]
```

| Flag | Meaning |
|---|---|
| `--providers` | 2+ comma-separated provider IDs from the daemon registry |
| `--workspace` | Git working tree for the task (defaults to cwd) |
| `--daemon` | Daemon base URL |
| `--json` | Machine-readable result dump on stdout |

Exit codes: `0` duel completed · `1` startup/usage error · `2` invalid arguments · `3` daemon rejected the duel (message printed verbatim).

## Known limitations

- Lanes that hit the daemon's approval gate are reported as `awaiting_approval`
  and stop — headless/auto-approve provider setups give the smoothest duels.
- Provider bootstrap failures (missing CLIs, auth) surface verbatim as failed lanes.
- Verdict ledger + winner apply are not wired into this build yet.

## Development

```bash
npm install
npm test -w @codewave/cli   # unit tests (stub HTTP daemon)
npm run start -w @codewave/cli -- --version
```
