# AGENTS.md

Project: **CodeWave**  
Tagline: **The visual workspace for AI coding agents**

CodeWave is an open-source, local-first agent workspace that harnesses **Qwen**, **Gemini**, **OpenCode**, **Freebuff**, and future AI coding CLIs into one unified environment. The product feels like a real coding-agent workspace, not a thin wrapper around one CLI.

## Read this first

For any significant product, runtime, orchestration, provider, protocol, or state change, read:

1. `README.md`
2. `docs/architecture.md`

If an `implement.md`, `backlog.md`, or other active planning file exists, read that after the architecture doc.

## What this repo is building

CodeWave is building a provider-flexible coding-agent environment with:

- a product-owned shell
- a local daemon as the control center
- provider adapters for Qwen, Gemini, and future engines
- a shared protocol for events, approvals, artifacts, and tool activity
- a shared state layer
- a shared tool / MCP plane
- orchestration above the engine adapters

## Non-goals

Do not drift into these shapes unless the user explicitly decides to change direction:

- not a wrapper around a single provider
- not a VS Code extension first
- not a pure terminal-only product
- not a provider-owned UI
- not orchestration hidden inside provider adapters

## Core architectural rules

1. The UI must not talk directly to provider CLIs. It talks to the daemon.
2. The daemon owns the authoritative run/session/state ledger.
3. Provider-specific behavior belongs behind provider adapters.
4. Orchestration belongs above adapters, not inside them.
5. The top layer must remain provider-agnostic.
6. Plugins must be removable without breaking core product behavior.
7. Tool behavior must be inspectable and governed by explicit approval rules.
8. Important actions should emit normalized events.
9. Resumability and checkpointing are first-class concerns.
10. Avoid backend lock-in in shared packages.

## Working style for Codex

- Prefer small, bounded slices over sweeping rewrites.
- Once the repo has a stable scaffold, prefer bundled loops of 2-3 compatible changes with one validation pass instead of stopping after every micro-step.
- Preserve clear package boundaries.
- When adding a shared abstraction, prove that it is needed by more than one provider or subsystem.
- Do not invent product capabilities that are not in `docs/architecture.md` without updating the docs.
- When architecture changes materially, update `docs/architecture.md` in the same task.
- When repeated operational guidance emerges, update this `AGENTS.md` so the guidance persists.

## Package intent

Use these boundaries unless the repo structure is intentionally changed:

- `apps/` → user-facing shell(s) and daemon app(s)
- `packages/protocol/` → normalized runtime contracts and event schemas
- `packages/state/` → persistence, migrations, checkpoints, archive support
- `packages/providers/` → provider adapters only
- `packages/orchestrator/` → routing, roles, review/verify flows, handoffs
- `packages/mcp-hub/` → shared tool and MCP integration plane
- `packages/plugins/` → optional extensions that can fail without breaking core
- `docs/` → architectural and product truth

## Validation expectations

- Prefer real repo checks over guesswork.
- Do not claim a command passed unless it was actually run.
- Do not invent test/build commands that do not exist yet.
- If scaffolding is incomplete, state what was validated and what is still missing.

## Documentation expectations

- Keep `AGENTS.md` concise and durable.
- Keep detailed architecture in `docs/architecture.md`.
- Keep active task planning in implementation-focused docs, not in `AGENTS.md`.
- If a folder later needs local instructions, add a deeper `AGENTS.md` rather than bloating this root file.

## Current implementation posture

Until the repo says otherwise, treat CodeWave as:

- local-first
- daemon-centered
- provider-flexible
- Freebuff-first at the product-policy level, with its cloud/ad-supported boundary labeled clearly
- OpenCode/local-model paths as the enabled automation-ready fallback
- Qwen and Gemini retained as explicit paid/BYOK opt-ins, never silently enabled by routing
- MCP/tool-pluggable
- orchestration-capable, but with phased rollout

For daemon lifecycle work, preserve these runtime invariants:

- reserve durable idempotency receipts before mutating state or launching providers
- require a negotiated protocol connection and exact route scope for every protected daemon API; keep only health and handshake public
- require the exact reviewed provider-policy revision for provider-dependent mutations and persist the accepted revision on session/run lineage
- allow at most one non-terminal run per session
- fence run updates with the expected run ID and queue steering instead of starting implicit concurrent work
- persist steering before provider delivery; require an explicit provider capability and matching acknowledgement before applying it to the active run, otherwise retain the restart-safe queued fallback
- keep session transcripts append-only and parent-linked; persist prompts/messages atomically with their owning run/event and hydrate them through bounded windows
- route structured provider stdout/stderr through `packages/providers/transport`; keep provider record schemas in adapters, but keep delivery ordering, line ceilings, cancellation, traces, and exactly-once terminal ownership shared; ACP session/tool/permission normalization also stays shared and serializes notifications before emitting events
- keep outbound MCP adapters narrow and daemon-backed; never expose raw routes, direct state/provider access, or mutations without dedicated least-privilege scopes plus confirmation, idempotency, cancellation, and audit semantics
