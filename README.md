# CodeWave

**The visual workspace for AI coding agents**

CodeWave is an open-source, local-first agent workspace that harnesses **Freebuff**, **OpenCode**, optional paid/BYOK **Qwen Code** and **Gemini CLI**, and future AI coding engines into one unified environment. Instead of using each tool separately in raw terminal flows, CodeWave provides a shared visual workspace for sessions, tools, context, approvals, and orchestration.

CodeWave is designed to be:

- **Open-source & Local-first** — lightweight, privacy-focused, hackable, and community-friendly  
- **Free-first & Provider-flexible** — Freebuff is the product primary, OpenCode/local models are the ready fallback, and paid providers are explicit opt-ins
- **Extensible** — ready for more tools, MCP plugins, and provider engines over time  
- **Practical** — focused on real developer workflows, step inspectors, and diff reviews  

---

## Overview

AI coding CLIs are powerful on their own, but using them separately in terminal tabs feels fragmented. CodeWave creates one control center where free, local, BYOK, and paid agent backends operate behind the same product-owned protocol and daemon.

The goal is not just to wrap CLIs in a thin shell, but to build a real developer environment with:

- shared sessions & history
- shared context
- shared MCP tools
- orchestration across engines
- room for plugins and future providers

---

## Vision

CodeWave starts with **Freebuff** and **OpenCode**, preserves **Qwen** and **Gemini** for users who configure them, and keeps the long-term direction bigger:

- a unified agent workspace
- a shared protocol for tools, approvals, and events
- orchestration across multiple coding agents
- local-first and open by default
- extensible enough to support future engines and plugins

---

## Core Idea

Instead of thinking of AI coding CLIs as separate terminal tools, CodeWave treats them as **engines inside one workspace**.

That workspace provides:

- a common session layer
- a shared tool plane
- orchestration and routing
- persistent state and history
- a visual interface with rich Markdown and diff inspection

---

## Initial Goals

- Integrate **Freebuff**, **OpenCode**, optional Qwen/Gemini, and future structured agent runtimes into one environment
- Provide a shared session and context model
- Support tool integration through a common interface
- Build an orchestration layer for switching or routing work between engines
- Keep the system lightweight, local-first, and easy to extend

---

## Planned Architecture

CodeWave is structured around core layers:

### 1. Provider Adapters
Adapters for each backend engine:

- Freebuff
- OpenCode
- Qwen (opt-in)
- Gemini (opt-in)

### 2. Shared Workspace Layer
A common runtime for:

- session management
- state & checkpoints
- history
- artifacts
- approvals

### 3. Tool / MCP Layer
A shared place to connect tools and external capabilities.

### 4. Orchestration Layer
Logic for deciding how work flows between engines, tools, and future agents.

### 5. UI / Shell
A clean visual environment with Markdown rendering, diff inspection, and approval controls.

---

## Why CodeWave

Because powerful open AI coding tools should not feel isolated.

CodeWave makes open agent tooling feel like a unified environment:
simple, composable, and built for experimentation.

---

## Features

### Daemon & State
- **Local daemon** — HTTP server on `127.0.0.1:4120` serving both REST APIs and the web shell
- **SQLite state** — persistent sessions, runs, events, append-only transcript messages, approvals, checkpoints, tool invocations, and session registry with WAL journaling
- **Shared protocol** — normalized `WorkbenchEvent` stream across providers (run.started, tool.requested, approval.resolved, etc.)
- **Shared structured transport** — Freebuff JSONL, Gemini stream-JSON, and Qwen control records use one ordered, line-bounded transport with plain-text fallback, isolated handler failures, lifecycle traces, bounded cancellation, and exactly-once terminal events; Gemini and OpenCode share an exact-pinned stable ACP v1 runtime with capability-gated continuity and cancellation-aware permissions
- **Scoped client handshake** — web and automation clients negotiate protocol v1, daemon capabilities, granular scopes, connection lifetime, and transport limits before protected API access
- **Cursor-bounded event replay** — monotonic per-run event sequences, SSE resume cursors, and a 500-event replay ceiling keep reconnects ordered without rehydrating unbounded history
- **Durable session memory** — prompts and normalized final messages are atomically recorded in a parent-linked, monotonic transcript chain; snapshots hydrate the latest 100 messages and the transcript API paginates backward up to 200 at a time
- **Durable mutation safety** — protected mutations require an `Idempotency-Key`; strict canonical-JSON receipts survive daemon restarts, replay the original response, and reject key reuse with a different payload
- **Safe workspace files** — bounded UTF-8 preview, create-only writes, compare-and-swap editing, conflict recovery, and explicit binary/truncation states keep the file surface useful without silently overwriting changed or partial content
- **Deterministic run lifecycle** — one active run per session, stale-run fencing for updates, restart reconciliation, capability-proven in-flight steering, and a durable follow-up queue whenever native delivery is unavailable or unacknowledged
- **Reviewed provider policy** — every provider-dependent mutation carries the exact content-addressed provider revision the user reviewed; stale launches fail closed with the current revision and the shell refreshes before retry

### Providers
- **Daemon-owned provider registry** — versioned `.codewave/providers.json`, deterministic SHA-256 revisions, atomic updates, access/privacy metadata, explicit enablement, priority routing, environment overrides, and cached health probes
- **Freebuff primary** — first policy priority and clearly labeled free cloud/ad-supported access; because the public Freebuff CLI is interactive-only, CodeWave requires a configured automation bridge before marking daemon runs ready
- **Structured Freebuff bridge** — configured bridges emit JSONL session, output, message, tool, checkpoint, and terminal records; protocol-v1 bridges may also negotiate acknowledged in-flight steering over stdin without weakening the durable queue
- **OpenCode fallback** — enabled by default with ACP, daemon-mediated permissions, session resume, and local models through Ollama or other OpenAI-compatible endpoints
- **Qwen Code opt-in** — ordered stream-JSON control path, approval mediation, explicit cancellation, resume, and checkpoints for users who configure a Coding Plan, API key, or compatible custom/local endpoint
- **Gemini CLI opt-in** — preserved ACP and stream-JSON paths for enterprise Code Assist or API-key users after individual-account service ended on 2026-06-18
- **Windows fixes** — direct Node entrypoint resolution for both providers; bundled `node-pty` patch for Gemini ACP
- **Health checks** — readiness/setup/disabled states, capability metadata, latency, timestamps, and a short probe cache

### Orchestration
- **Route Prompt** — live tool coverage wins, registry priority breaks ties, and disabled paid providers are never selected implicitly
- **Review / Verify** — fork completed runs into reviewer or verifier sessions with cross-provider routing
- **Delegate** — spawn planner/researcher/verifier child runs under explicit orchestration roles
- **Handoff** — continue a run in a new main session with prior context preserved
- **Orchestration board** — grouped view of parent and child sessions as inspectable flows
- **Queue while running** — sending from the composer during an active run records a durable update and launches it automatically when the current run settles

### Tool Plane & MCP
- **Workspace registry** — `.codewave/mcp.json` or `.mcp.json` defines tool requirements and MCP servers per workspace
- **Provider catalogs** — adapters declare available tools (workspace-read, write, shell, network, MCP)
- **Session registrations** — live tracking of tools observed and reported in active sessions
- **MCP hub** — normalizes tool readiness from provider availability, registry config, and observed history
- **Optional MCP observer** — a loopback-only stdio adapter exposes four bounded, redacted, read-only session/run tools without becoming a second control plane; see [the MCP observer guide](docs/mcp-observer.md)

### Shell
- **Three-column layout** — left session rail, center thread/canvas, right inspector/utility panel with resizable columns
- **Step-card timeline** — grouped assistant replies, user prompts, thinking blocks (toggleable), and expandable tool cards with status/duration/output
- **Status strip** — daemon connection, workspace, provider, access mode, and live run phase at a glance
- **Plan mode** — read-only runs that produce a plan card with one-click **Approve & execute**
- **Git undo** — revert a completed run's tracked changes to its pre-run commit
- **Attention notifications** — desktop notifications for approvals and run completion (🔔 toggle in the status strip)
- **Context meter** — approximate context used per run in the composer
- **@-mention picker** — fuzzy file/directory search from the workspace; `@` in the prompt opens the picker and inserts `@path`
- **Compare mode** — run the same prompt on two providers side by side (⚖ Compare button)
- **Monochrome theme** — a flat, hue-free grayscale interface on a lifted neutral dark ground, designed for long, focused coding sessions; light mode inverts the same ramp
- **Events timeline** — normalized event log with tool call/activity evidence
- **Session memory** — recent parent-linked turns appear above the current run, with older history kept bounded and available through cursor pagination
- **Approvals** — inline decision cards in the transcript plus daemon-mediated lists; keyboard approve/deny (`Shift+Enter`/`Shift+A`/`Shift+D`)
- **Tool plane evidence** — provider-enumerated vs event-observed tool registration signals
- **Archive explorer** — per-session run summaries with recovery/lineage metadata
- **Quick open** — grouped command palette with keyboard shortcuts (`Ctrl/Cmd+K`)
- **Checkpoints** — persisted recovery points visible in the inspector

### Validation
- `npm run check` — TypeScript type checking
- `npm test -w @codewave/web` — React interaction and property suite
- `npm run check:shell` — deterministic shell usability tests
- `npm run check:registrations` — E2E tool registration validation across providers
- `npm run check:runtime` — lossless command arguments and shell-safe provider process launching
- `npm run check:transport` — ordered JSONL delivery, malformed/plain-text fallback, line ceilings, handler isolation, cancellation, acknowledged Freebuff steering, Freebuff/Gemini/Qwen normalization parity, shared Gemini/OpenCode ACP permissions and idempotent tool lifecycles, and Qwen completion/cancellation traces
- `npm run check:harness` — scoped handshake/version negotiation, restart renegotiation, parent-linked transcript migration/pagination, restart-safe idempotency, provider-policy revision fencing, overlap rejection, native/rejected/unacknowledged/queued steering, cursor-bounded SSE replay, Freebuff bridge normalization, legacy migration, and restart recovery
- Fake runtime fixtures for Qwen and Gemini to enable repeatable CI testing

The normative [CodeWave continuity contract](docs/continuity-contract.md) defines the stronger acceptance boundary for authorization races, semantic idempotency, one-active-run concurrency, externally killed daemon recovery, deterministic reconstruction, causal provenance, and content-limited audit evidence. It is a conformance target rather than a guarantee: only a current, passing `npm run check:continuity` report may promote those claims.

---

## Architecture

CodeWave is structured as an npm monorepo with workspaces:

| Layer | Package | Purpose |
|---|---|---|
| **Daemon** | `apps/daemon` | HTTP server, provider lifecycle, API routing, static file hosting |
| **Web shell** | `apps/web` | React + TypeScript + Vite frontend |
| **Protocol** | `packages/protocol` | Shared types: events, adapters, sessions, tools, orchestration |
| **State** | `packages/state` | SQLite-backed persistence |
| **Orchestrator** | `packages/orchestrator` | Routing, follow-up, delegate, handoff logic |
| **MCP Hub** | `packages/mcp-hub` | Workspace registry, tool-plane snapshots, MCP server status |
| **Provider runtime** | `packages/providers/runtime` | Shared quote-aware command parsing and shell-safe process launching |
| **Provider transport** | `packages/providers/transport` | Ordered JSONL/control delivery, terminal/cancellation ownership, process lifecycle traces, and shared serialized ACP session/tool/permission mapping |
| **Freebuff provider** | `packages/providers/freebuff` | Primary-policy adapter with an explicit automation-bridge seam |
| **OpenCode provider** | `packages/providers/opencode` | Enabled ACP/local-model fallback with run-JSON compatibility |
| **Qwen provider** | `packages/providers/qwen` | Qwen CLI adapter with ordered stream-JSON + control-path |
| **Gemini provider** | `packages/providers/gemini` | Gemini CLI adapter with ACP default + stream-json fallback |

### Design rules
1. **UI must NOT talk to provider CLIs directly** — only to the daemon
2. **Daemon owns the authoritative run/session/state ledger**
3. **Orchestration lives ABOVE adapters, never inside them**

---

## Development

```bash
npm install
npm run build:web
npm run dev
```

`npm run dev` builds the web shell and starts the daemon at `http://127.0.0.1:4120`.

Frontend-only iteration:

```bash
npm run dev:web
```

Validation:

```bash
npm run check                           # TypeScript
npm run check:acp                       # Stable ACP v1 protocol/lifecycle/permission E2E
npm test -w @codewave/web                # React interaction/property suite
npm run check:shell                      # Shell usability tests
npm run check:providers                  # Provider policy and routing tests
npm run check:harness                    # Daemon lifecycle/idempotency/steering E2E
npm run check:adversarial                # Daemon boundary and hostile-input regression suite
npm run check:continuity                 # Crash/replay/reconstruction conformance suite
npm run check:registrations              # Tool registration E2E tests
npm run check:registrations:json         # CI-friendly JSON summary
```

### Provider configuration

Open **Providers** in the left rail or edit `.codewave/providers.json`. CodeWave stores enablement, priority, and optional command overrides there—never API keys. Provider credentials remain in the provider CLI or environment.

Environment overrides take precedence:

```bash
CODEWAVE_DEFAULT_PROVIDER=freebuff
CODEWAVE_QWEN_ENABLED=true
CODEWAVE_QWEN_COMMAND=/path/to/qwen
CODEWAVE_GEMINI_ENABLED=true
CODEWAVE_GEMINI_COMMAND=/path/to/gemini
```

Setting a provider command also enables that provider unless its `CODEWAVE_<PROVIDER>_ENABLED` override explicitly disables it. For Freebuff, `CODEWAVE_FREEBUFF_COMMAND` must identify a protocol-qualified automation bridge—not the raw interactive TUI. The bridge must answer `--codewave-bridge-info` with `{"name":"codewave-freebuff-bridge","protocolVersion":1}`, then echo the supplied launch-attempt ID in its first `bridge.hello` record. It receives `--cwd`, `--prompt`, `--output-format jsonl`, `--launch-attempt-id`, and optional `--resume` arguments. Each later stdout line may be a JSON object with `type` set to `session`, `output`, `message`, `tool`, `checkpoint`, or `result`; CodeWave converts those records into shared events, session metadata, checkpoints, artifacts, and terminal state. A run succeeds only after an explicit valid `result` record—clean process exit alone fails closed. See [the Freebuff bridge contract](docs/freebuff-bridge.md).

A bridge can opt into live updates by first emitting `{"type":"capabilities","protocolVersion":1,"inFlightSteering":true}`. CodeWave then sends newline-delimited `steer` commands on stdin with `steeringId`, `prompt`, and `createdAt`. The bridge must answer with a matching `{"type":"steering","steeringId":"…","status":"accepted"}` before CodeWave marks the input applied to the active run. Rejection, timeout, process close, or missing negotiation leaves the already-persisted input queued for the next run.

Protected mutating daemon endpoints require an `Idempotency-Key` header; missing keys fail with HTTP 428 before state, provider, or workspace effects. CodeWave's web client sends one automatically. A retry with the same method, normalized path/query, and strict canonical JSON body receives the persisted original response; invalid UTF-8, duplicate keys, unsafe numeric values, undeclared fields, and unsupported schema versions fail before receipt reservation. Reusing a key for a different payload fails closed with HTTP 409. If the daemon stops after reserving a key but before persisting a response, that key remains fenced and returns an outcome-unknown 409 instead of risking a duplicate side effect.

Provider-dependent mutations also carry `expectedProviderRevision`, taken from the registry's deterministic SHA-256 revision. Sessions, runs, and queued steering persist the accepted revision for auditability. If enablement, command, priority, or the default changes before submission, the daemon returns HTTP 409 with `code: "provider_revision_conflict"` and `currentProviderRevision`; the shell refreshes the registry so the user can review and retry against current policy.

Except for `/api/health` and `/api/handshake`, daemon APIs require a negotiated in-memory client connection. Protocol v1 advertises supported capabilities and ceilings, then grants only requested scopes such as `runs:read`, `runs:write`, `providers:write`, or `workspace:read`. Missing, expired, restarted, or under-scoped connections fail closed with machine-readable 401/403 responses. The web shell transparently renegotiates once after restart; connection IDs expire after twelve hours and are never persisted as credentials.

`GET /api/sessions/:sessionId/transcript` returns a bounded newest-first window normalized back into ascending order. `before=<sequence>` pages backward exclusively and `limit=<count>` is capped at the daemon-advertised 200-message ceiling. Run snapshots use the same store and hydrate a 100-message window ending at the selected run, so inspecting an older run never leaks later conversation turns into its context.

---

## Known limitations

- Freebuff's public CLI currently documents an interactive TUI, not a stable non-interactive machine protocol. CodeWave will not scrape the TUI or claim it is daemon-ready; configure an automation bridge or use the OpenCode/local fallback for now
- Qwen runs through the external CLI today; the Qwen OAuth free tier ended 2026-04-15, so explicitly enable it only after configuring a local/custom or paid model backend
- Qwen's current headless stream-JSON input processes additional messages as ordered turns rather than proving same-turn steering. CodeWave therefore keeps Qwen steering on the durable follow-up path until its machine protocol exposes an acknowledged in-flight boundary
- Gemini defaults to ACP; use `CODEWAVE_GEMINI_MODE=stream-json` as fallback if ACP regresses on another machine
- OpenCode defaults to ACP; use `CODEWAVE_OPENCODE_MODE=run` as fallback, but note `opencode run` can hang on some Windows environments, and ACP mode requires the workspace path to exist and be a git repository

See [the 2026 harness research note](docs/harness-research-2026.md) for provider evidence, donor analysis, and the next backend milestones.

---

## Brand

**CodeWave** is named for the flow of code, tools, and collaborating agents moving through one calm workspace. Its visual identity is deliberately monochrome and low-glare: a neutral grayscale surface ramp, no hue anywhere in the product chrome, flat surfaces with no accent glow or gradient wash, and a wave mark that combines an open **C** with a flowing **W**.

Hierarchy is carried by luminance and border weight rather than color. Severity reads as brightness — the louder the state, the whiter the ink in dark mode, the darker in light mode — and diffs distinguish additions from deletions by ink weight plus their `+`/`-` signs. Provider identity is a brightness step, not a tint, so switching engines never repaints the product into a provider-owned skin.

---

## License

MIT — see [LICENSE](LICENSE) for details.
