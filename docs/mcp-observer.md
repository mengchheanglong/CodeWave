# CodeWave MCP observer v0

The MCP observer is an optional, read-only stdio process that gives an MCP host bounded context from the local CodeWave daemon. It complements CodeWave's visual workspace; it does not replace the shell, daemon ledger, provider adapters, or inbound MCP hub.

## Why this boundary

The current MCP specification describes tools as model-controlled actions and resources as application-controlled read-only context. It also requires servers to validate inputs and sanitize outputs; annotations are client-facing hints, not enforcement. CodeWave therefore starts with observation only and keeps authorization in the daemon's exact route scopes. [MCP tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [MCP resources specification](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)

The adapter uses the official v2 TypeScript server and `serveStdio`, which can negotiate the 2026-07-28 protocol while retaining legacy-host compatibility. Stdio is local process IPC: stdout contains protocol messages only and diagnostics go to stderr. [TypeScript SDK compatibility guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28), [stdio transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)

MCP OAuth applies to HTTP transports, not stdio. A local stdio process runs with the host user's privileges and MCP is not a sandbox. The daemon lease is scoped, but it is not authentication against another process running as the same OS user. [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [MCP security policy](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/SECURITY.md)

## Surface

Tools:

- `codewave_list_sessions`
- `codewave_get_session`
- `codewave_get_run`
- `codewave_read_transcript`

Resources:

- `codewave://sessions/recent`
- `codewave://runs/{runId}`

Every surface is read-only, deterministic for the same daemon snapshot, private-cache hinted, and capped at 256 KiB outward. Session lists, run lists, and transcript pages expose at most 50 items; message content is capped at 16,000 characters.

## Privacy and least privilege

The observer negotiates exactly:

```text
sessions:read
runs:read
```

It accepts only a credential-free `http://127.0.0.1:<port>` or IPv6 loopback origin. The connection ID stays in memory and is renegotiated once after a 401 caused by daemon restart.

Outward projections omit absolute workspace paths, provider session IDs, provider-policy revisions and commands, pre-run commits, raw events, tool inputs/outputs, approval payloads, artifact contents, steering prompts, source event IDs, and transcript metadata. Transcript text and run prompts remain potentially sensitive by design because context handoff is the feature; users should register the observer only with MCP hosts they trust.

## Development setup

Start the CodeWave daemon, then configure an MCP host to run this repository-local command from the repository root:

```text
node node_modules/tsx/dist/cli.mjs apps/mcp-server/src/bin.ts
```

Set `CODEWAVE_DAEMON_URL` only when the daemon is not on `http://127.0.0.1:4120`. Remote HTTP, embedded credentials, paths, query parameters, and fragments are rejected.

## Validation

Run:

```bash
npm run check:mcp
npm run check:mcp:e2e
```

The deterministic validator covers modern 2026-07-28 and legacy clients, stdout purity, exact scope negotiation, GET-only daemon traffic, restart renegotiation, schema rejection before HTTP, loopback enforcement, redaction, response bounds, and resource/tool discovery. It repeats failure triage, context handoff, and resource inspection 20 times each and reports p95 latency plus maximum projected bytes for the current machine. The E2E validator starts an isolated real daemon, seeds a qualified Freebuff run through a privileged fixture client, observes it through the two-scope adapter, and proves the observer did not add mutation receipts.

## Deferred by design

The observer has no prompts, roots, workspace files, subscriptions, SSE, sampling, elicitation, run creation, steering, cancellation, approvals, provider changes, Git actions, or generic daemon proxy. Roots are informational rather than access control, and several older client features are deprecated in the 2026-07-28 protocol. [Deprecated MCP features](https://modelcontextprotocol.io/specification/2026-07-28/deprecated)

Any mutation phase requires dedicated narrow daemon scopes—not today's broad write scopes—plus host-visible confirmation, stable idempotency mapping, cancellation propagation, normalized audit events, and adversarial tests in one reviewed slice.
