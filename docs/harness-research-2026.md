# CodeWave harness research — 2026 provider reset

Date: 2026-08-13

This note records the primary-source research behind CodeWave's free-first provider policy and the next harness milestones. It is a decision record, not an endorsement list.

## Provider reality

| Runtime | Current fit | CodeWave decision |
|---|---|---|
| Freebuff | Free, cloud-backed, and ad-supported. The public CLI documents an interactive terminal flow, history, file/agent mentions, bash, and web research, but no daemon-safe non-interactive protocol. | Product primary and first policy priority. Keep the adapter honest: raw interactive Freebuff is not marked run-ready; a configured automation bridge can make it ready. Label the cloud/ad boundary in the UI. |
| OpenCode | Open-source CLI with ACP support, 75+ model providers, custom endpoints, and local Ollama models. | Enabled by default as the first automation-ready local/BYOK fallback. This is the strongest existing fit for users who want no subscription. |
| Qwen Code | Qwen OAuth's free tier ended on 2026-04-15. Current supported paths include Alibaba Coding Plan, API keys, third-party providers, and custom/local compatible endpoints. | Preserve the mature adapter, but disable it by default. Users explicitly enable it after configuring paid, BYOK, or local access. |
| Gemini CLI | Individual free/AI Pro/AI Ultra service stopped on 2026-06-18; enterprise Code Assist and API-key authentication remain supported. | Preserve ACP and stream-JSON adapters, but disable them by default. Users explicitly enable Gemini after setup. |
| goose | Open-source CLI/desktop/API with Ollama, ACP, MCP, recipes, subagents, and security controls. | Highest-priority new adapter candidate. Its API/ACP surfaces are a much better integration boundary than terminal scraping. |
| Crush | Open-source multi-model CLI with local OpenAI-compatible endpoints, MCP, LSP context, sessions, permissions, and an experimental client/server mode. | Strong second candidate after goose. Reassess when the client/server protocol stabilizes. |
| Aider | Mature open-source coding CLI with local Ollama support. | Useful compatibility adapter candidate, especially for local models, but less aligned with CodeWave's structured event and approval protocol than ACP-first runtimes. |
| OpenClaude | Model-neutral CLI with tools, MCP, skills, structured streaming, budgets, persistent/branchable sessions, and worktree isolation. | Watch as an adapter and protocol donor. Validate project maturity and stable machine interfaces before production integration. |

Primary sources: [Freebuff](https://github.com/CodebuffAI/freebuff), [OpenCode providers](https://dev.opencode.ai/docs/providers), [Qwen authentication](https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/auth.md), [Gemini CLI service announcement](https://github.com/google-gemini/gemini-cli/discussions/28017), [goose](https://github.com/aaif-goose/goose), [Crush](https://github.com/charmbracelet/crush), [Aider with Ollama](https://aider.chat/docs/llms/ollama.html), [OpenClaude](https://github.com/Gitlawb/openclaude).

## Harness patterns worth adopting

### Codex

Codex's app-server is a rich-client boundary rather than a UI subprocess wrapper. It exposes explicit thread lifecycle, resumable turns, streamed items, approvals, per-turn policy, steering, and persisted goal state. CodeWave already follows the daemon/client boundary and now has persist-first, acknowledged steering; the next parity targets are stronger per-turn policy overrides, compaction hooks, and task-level trace evaluation.

Sources: [Codex app-server](https://developers.openai.com/codex/app-server), [Codex approvals and security](https://developers.openai.com/codex/agent-approvals-security).

### OpenClaw

OpenClaw makes one gateway authoritative for session state, protocol policy, scopes, payload limits, and event sequencing. Its session design separates mutable session rows from append-only, tree-structured transcript events and performs bounded reads/compaction. CodeWave should adopt protocol handshakes, idempotency keys for mutations, capability/scopes negotiation, configuration revision hashes, and bounded transcript hydration.

Sources: [OpenClaw gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md), [OpenClaw session management and compaction](https://github.com/openclaw/openclaw/blob/main/docs/reference/session-management-compaction.md).

### Hermes Agent

Hermes keeps providers, tools/toolsets, skills, memory, gateways, and security as separate surfaces. It supports provider selection, configurable toolsets, persistent memory, MCP, command approval, and container isolation. CodeWave should keep skills and memory above provider adapters and eventually support portable imports without importing provider-owned secrets indiscriminately.

Source: [Hermes Agent](https://github.com/NousResearch/hermes-agent).

### Grok Build

The open-source Grok Build harness exposes the loop, context assembly, tool dispatch, TUI, plan review, diffs, skills, plugins, hooks, MCP, and subagents, and can target local inference from `config.toml`. The transferable lesson is that extension discovery and execution must be explicit and inspectable, not hidden inside a monolithic provider adapter.

Sources: [Grok Build open-source announcement](https://x.ai/news/grok-build-open-source), [Grok Build source](https://github.com/xai-org/grok-build).

### Odysseus

Odysseus treats the product as a self-hosted workspace above models: chat/agents, research, comparison, documents, memory, scheduled tasks, MCP, and local/API models share one environment. CodeWave should borrow the workspace-level product thinking while keeping its own coding-specific daemon, approval, and provenance rules.

Source: [Odysseus](https://github.com/odysseus-dev/odysseus).

## Implemented in this slice

- A versioned daemon-owned provider registry at `.codewave/providers.json`.
- Freebuff as the canonical first priority; OpenCode as the enabled local/BYOK fallback.
- Qwen and Gemini retained but disabled until explicitly configured.
- Environment overrides for automation and CI: `CODEWAVE_DEFAULT_PROVIDER`, `CODEWAVE_<PROVIDER>_ENABLED`, and `CODEWAVE_<PROVIDER>_COMMAND`.
- Atomic provider-policy persistence without storing provider API keys.
- Provider access/data-boundary metadata and a shell settings surface.
- Health status, probe latency, last-check time, ten-second health caching, and setup-aware states.
- Policy-aware routing: live tool coverage wins; provider priority breaks ties; paid providers never become available through routing alone.
- An honest Freebuff boundary: the raw interactive TUI is detected but not represented as daemon-run capable. A configured automation bridge may provide the documented CodeWave JSONL command contract.
- Restart-safe mutation receipts keyed by canonical request content, overlap rejection, stale-run fencing, and durable queued steering events.
- Startup reconciliation that turns orphaned non-terminal rows into explicit `daemon_restart` failures instead of leaving the ledger permanently busy.
- Structured Freebuff bridge normalization for session, output, message, tool, checkpoint, and result JSONL records.
- Monotonic per-run event sequences, legacy-ledger migration, SSE `Last-Event-ID`/`after` cursors, and replay capped to the latest 500 events.
- Deterministic SHA-256 provider-policy revisions, compare-and-set configuration updates, stale-policy conflicts, automatic shell refresh, and accepted-revision lineage on sessions, runs, and queued steering.
- Protocol-v1 client negotiation with advertised capabilities and ceilings, granular read/write scopes, fail-closed 401/403 responses, bounded in-memory connection leases, scoped SSE URLs, and automatic web renegotiation after daemon restart.
- Append-only, parent-linked session transcripts with atomic run/event writes, legacy-ledger backfill, bounded run-relative hydration, backward pagination, and restart persistence.
- A provider-neutral structured transport with globally ordered stdout/stderr handling, JSONL/plain-text discrimination, per-line ceilings, isolated record failures, lifecycle traces, bounded cancellation, and exactly-once terminal ownership. Freebuff, Gemini stream-JSON, and Qwen control records use it directly. Gemini and OpenCode now share one serialized ACP session/tool/permission state machine with idempotent tool terminals and bounded process cleanup.
- A normalized steering contract with explicit `unsupported`, `runtime-negotiated`, and `native` capability states plus optional acknowledged delivery on a live provider handle.
- Persist-first native steering for Freebuff automation bridges: protocol-v1 capability announcement, ID-correlated stdin commands and accept/reject acknowledgements, serialized per-run attempts, atomic queued-to-applied transitions, and durable fallback across rejection, timeout, close, terminal races, and daemon restart.
- An explicit Qwen non-capability decision. Current headless stream-JSON accepts more stdin messages, but its non-interactive session drains them as sequential turns; CodeWave does not reinterpret an open pipe as same-turn steering.

### Steering evidence and decision

Qwen's July 2026 update documents true next-sampling-boundary steering in the interactive TUI, while the headless documentation describes bidirectional stream-JSON input. Inspection of the current official non-interactive session implementation shows a `userMessageQueue` whose next message is processed only after the active `processingPromise` finishes. CodeWave therefore treats extra headless input as a later turn, not as proven in-flight steering. This is an inference from the official behavior and source, and it deliberately keeps Qwen on the durable follow-up path.

Sources: [Qwen weekly steering update](https://qwenlm.github.io/qwen-code-docs/en/blog/updates/weekly-update-2026-07-23/), [Qwen headless mode](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/), [Qwen non-interactive session source](https://github.com/QwenLM/qwen-code/blob/main/packages/cli/src/nonInteractive/session.ts), [Qwen TypeScript SDK](https://qwenlm.github.io/qwen-code-docs/en/developers/sdk-typescript/).

## Next backend slices

1. Extend the implemented append-only transcript and bounded hydration base with explicit compaction checkpoints and pre-compaction memory hooks.
2. Expand trace-based harness evaluations beyond transport parity: task fixtures, event/provenance assertions, routing outcomes, recovery drills, and keep/discard iteration based on measurable results.
3. Extend the implemented handshake with optional future restricted-mode scope policy and protocol compatibility fixtures when protocol v2 is proposed.
4. Add native steering to another provider only after its machine protocol exposes a capability proof and correlated delivery acknowledgement; do not emulate it through terminal input timing.

## Guardrails

- “Free” must never be presented as “local” or “private.”
- A CLI being installed does not mean it is automatable or authenticated.
- CodeWave never stores provider API keys in `providers.json`; provider CLIs or environment variables own credentials.
- No provider is silently enabled by routing.
- No cross-provider fallback happens after a run begins; failover is a pre-run routing decision so session ownership remains explicit.
