# CodeWave — Architecture v1.1

## 1) Product intent

CodeWave is a local-first multi-engine coding-agent environment.

Its goal is to provide a Codex/Claude-Code-like experience while remaining provider-flexible and tool-pluggable.

The product should:

- run multiple agent backends through one shared environment
- unify session state, approvals, artifacts, and logs
- allow backend-specific strengths without backend-specific lock-in
- support expandable tools through MCP and internal adapters
- support future orchestration modes such as routing, reviewer loops, and research workflows

This is **not** a wrapper around a single CLI.  
This is **not** a VS Code extension first.  
This is **not** a pure terminal-only product.

It is a product-owned environment with its own shell, state, protocol, and orchestration layer.

---

## 2) Design principles

### 2.1 Local-first
Core execution should work on the user’s machine.  
The system should not depend on a hosted control plane for normal use.

### 2.2 Provider-agnostic top layer
The product UI, state, orchestration, and tool registry must not assume a single model vendor.  
Provider-specific behavior belongs behind adapters.

### 2.3 Shared protocol, specialized engines
All engines emit a normalized event stream.  
Each engine may still expose unique capabilities behind optional feature flags.

### 2.4 Tool-pluggable
The product should treat MCP as a first-class integration boundary.  
Internal tools and external MCP servers should appear through one shared tool plane.

### 2.5 Resumable and inspectable
Long-running work must persist state, checkpoints, approvals, artifacts, and errors.  
A run should be recoverable after crashes or interruptions.

### 2.6 Multi-mode growth path
The architecture must support:

- single-agent interactive mode
- delegated role-based workflows
- reviewer/validator loops
- research/study plugins
- future mobile or remote companion clients

### 2.7 Calm, durable interface
The shell uses CodeWave's low-glare monochrome visual system as its canonical theme: a neutral grayscale surface ramp on a lifted dark ground, with no hue in the product chrome and flat surfaces free of accent glow or gradient wash. Depth comes from luminance and border weight only.

Provider identity may appear as a restrained brightness step on the shared neutral accent, but must not introduce hue and must not fragment the product into unrelated provider-owned skins. Semantic state must never depend on hue alone — severity is encoded as brightness, and diffs stay legible through ink weight plus their `+`/`-` signs. Dense agent activity should remain readable and calm during long coding sessions.

### 2.8 Free-first, explicit paid access
Provider economics and authentication are product state, not hidden setup trivia.

- Freebuff is the canonical first provider priority, with its cloud/ad-supported boundary shown plainly.
- OpenCode with local or user-configured models is the enabled automation-ready fallback.
- Qwen Code and Gemini CLI remain supported, but start disabled and require explicit user configuration.
- “Installed,” “enabled,” “authenticated,” and “automation-ready” are separate states.
- Routing may choose only enabled and ready providers. It must never activate a paid provider on the user's behalf.

---

## 3) Product shape

CodeWave has 4 main layers:

1. **Shell layer**  
   The user-facing environment: desktop or local web UI, command palette, conversation panes, run inspector, approval surfaces.

2. **Daemon layer**  
   The local supervisor process that manages sessions, providers, tools, state, streaming, and orchestration.

3. **Engine adapter layer**  
   Provider-specific connectors for Freebuff, OpenCode, optional Qwen/Gemini, and future engines.

4. **Tool + orchestration layer**  
   MCP manager, internal tools, run queues, role routing, checkpoints, archives, and optional research plugins.

---

## 4) Recommended repo structure

```text
codewave/
  apps/
    desktop/
      src/
        main/
        renderer/
      package.json

    daemon/
      src/
        server/
        runners/
        sessions/
      package.json

  packages/
    protocol/
      src/
        events/
        messages/
        approvals/
        runs/
        tasks/

    state/
      src/
        db/
        repos/
        migrations/
        checkpoints/
        archive/

    orchestrator/
      src/
        routing/
        roles/
        queues/
        reviewer/
        planner/
        policies/

    mcp-hub/
      src/
        registry/
        sessions/
        transport/
        adapters/

    providers/
      freebuff/
        src/
          runner/
          capabilities/

      opencode/
        src/
          runner/
          acp/
          parser/

      qwen/
        src/
          runner/
          parser/
          capabilities/
          auth/

      gemini/
        src/
          runner/
          parser/
          capabilities/
          auth/

      codex-ref/
        src/
          experiments/

      local/
        src/
          runner/
          parser/

    plugins/
      notebooklm/
      github/
      filesystem/
      web/

    ui-kit/
      src/
        components/
        stores/
        hooks/

  docs/
    architecture.md
    runtime-contract.md
    plugin-api.md
    orchestration-model.md
    provider-capabilities.md

  vendor/
    notes/
      qwen-code.md
      gemini-cli.md
      codex.md
      switchboard.md
      oh-my-gemini.md
      notebooklm-py.md
```

---

## 5) Core runtime contract

The most important architectural decision is the **normalized runtime contract**.

Every provider adapter must translate provider-specific behavior into a shared stream.

### 5.1 Core concepts

- **Workspace**: a filesystem root and project context
- **Session**: a user-visible conversation/run container
- **Run**: one execution episode inside a session
- **Step**: a unit of work inside a run
- **Artifact**: structured output created during a run
- **Approval**: a requested user decision
- **Checkpoint**: resumable state snapshot
- **Tool invocation**: a normalized record of a tool action

### 5.2 Event schema

Each adapter should emit events such as:

- `run.started`
- `run.output.delta`
- `message.created`
- `tool.requested`
- `tool.started`
- `tool.completed`
- `approval.requested`
- `approval.resolved`
- `artifact.created`
- `checkpoint.saved`
- `run.completed`
- `run.failed`
- `run.cancelled`

### 5.3 Minimal event shape

```ts
export type WorkbenchEvent = {
  id: string;
  sessionId: string;
  runId: string;
  timestamp: string;
  source: "freebuff" | "opencode" | "qwen" | "gemini" | "system" | "plugin";
  type: string;
  payload: Record<string, unknown>;
};
```

### 5.4 Why this matters

Without this normalization, the UI, archive, orchestration, reviewer loops, and plugins become tightly coupled to each provider’s output format.  
That is the biggest anti-goal.

---

## 6) Provider adapter model

Each provider gets a dedicated adapter package.

### 6.1 Adapter responsibilities

A provider adapter must:

- start and stop the underlying engine process
- stream raw output
- parse output into normalized events
- expose provider capabilities
- manage auth/session prerequisites
- surface approvals and tool behavior consistently
- support cancellation and health checks

### 6.2 Adapter interface

```ts
export interface ProviderAdapter {
  id: string;
  displayName: string;
  capabilities(): Promise<ProviderCapabilities>;
  startSession(input: StartSessionInput): Promise<ProviderSessionHandle>;
  sendPrompt(input: SendPromptInput): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  listTools(): Promise<ToolDescriptor[]>;
  healthCheck(): Promise<HealthStatus>;
}
```

### 6.3 Shared provider runtime

Adapters use `packages/providers/runtime` for quote-aware command overrides and process launching. It preserves argument boundaries, resolves Windows executables, invokes `.cmd`/`.bat` shims through an explicitly quoted `cmd.exe` command line, and never combines argument arrays with Node's unsafe `shell: true` mode. `packages/providers/transport` owns ordered line delivery, ceilings, cancellation, tracing, terminal-event ownership, and the shared ACP session/tool/permission state machine. The protocol exposes `unsupported`, `runtime-negotiated`, and `native` steering support plus an optional acknowledged run-handle method; provider-specific record schemas, capability proofs, launch arguments, and tool-requirement overrides remain inside adapters.

### 6.4 v1 adapters

#### Freebuff adapter
Freebuff is the product primary and first registry priority because it offers a genuinely free coding-agent experience. It is cloud-backed and ad-supported, so the UI must never describe it as local or private.

The public upstream CLI currently documents an interactive TUI rather than a stable non-interactive protocol. CodeWave therefore distinguishes installation from automation readiness: the raw CLI may be installed but is not marked ready for daemon runs. A user-configured Freebuff automation bridge may implement the CodeWave JSONL command contract until upstream exposes a machine API. Readiness requires a bounded protocol-v1 descriptor probe, and every run requires a protocol-v1 hello followed by an explicit terminal result. A zero-exit command, unqualified stream, or clean EOF without a result fails closed and can never synthesize success.

Bridge protocol v1 can prove in-flight steering at runtime. The bridge announces `inFlightSteering: true`, receives ID-addressed `steer` records on stdin, and must acknowledge each ID as accepted or rejected. The daemon always persists and emits the queued input before attempting delivery. Only an accepted acknowledgement atomically applies it to the current run; missing negotiation, rejection, timeout, close, or a terminal race retains the durable input for ordered follow-up dispatch.

#### OpenCode adapter
OpenCode is enabled by default as the automation-ready fallback. ACP is preferred; its local Ollama and custom OpenAI-compatible provider support make it the best current no-subscription path.

#### Custom ACP profiles
Provider policy v2 admits runtime-validated lowercase `acp.*` IDs without widening built-in-provider assumptions inside adapters. Each profile is a product-owned display/access descriptor plus an exact executable and argument array for the shared ACP v1 adapter. Creation requires explicit local-command trust and always starts disabled; disabled profiles must never be probed or spawned. Enablement, launch changes, defaults, and run lineage remain protected by the same content-addressed provider revision as built-ins. Credentials are never stored in the policy file.

#### Qwen adapter
Keep the mature stream-JSON/control adapter, approval mediation, resumability, and checkpoints. Qwen OAuth's free tier has ended, so the registry disables Qwen by default. Users may enable it after configuring a Coding Plan, API key, third-party provider, or compatible local/custom endpoint.

Qwen's TUI has a real steering queue, but the current headless stream-JSON session consumes stdin messages as sequential turns. An open input pipe is not sufficient capability evidence, so this adapter declares in-flight steering unsupported until Qwen exposes an acknowledged same-turn machine boundary.

#### Gemini adapter
Keep ACP and stream-JSON paths for enterprise Code Assist and API-key users. Gemini is disabled by default because individual free and consumer subscription accounts are no longer served by Gemini CLI.

#### Next adapter candidates
Prioritize runtimes with structured integration boundaries: goose first (API/ACP/MCP), then Crush when its client/server mode stabilizes. Aider remains useful for local-model compatibility. Do not add a production adapter by scraping an interactive TUI.

---

## 7) Daemon architecture

The daemon is the heart of the system.  
It supervises engines, holds the authoritative run ledger, and streams events to the UI.

### 7.1 Daemon responsibilities

- session lifecycle
- provider process supervision
- shared structured-provider transport and exactly-once terminal ownership
- provider policy, enablement, priority, and health caching
- event normalization
- checkpoint persistence
- approvals routing
- orchestration execution
- tool registry management
- local IPC/WebSocket API for clients

### 7.2 Internal daemon services

```text
SessionManager
RunManager
ProviderSupervisor
ProviderPolicyStore
EventBus
ApprovalService
CheckpointService
ArtifactService
ToolRegistry
McpManager
OrchestratorService
ArchiveService
```

### 7.3 Client transport

Use a local API plus streaming channel:

- HTTP for commands
- WebSocket or SSE for event streaming

This keeps the shell decoupled from engine internals.

---

## 8) State model

### 8.1 Persistence choice

For v1:

- **SQLite** for primary state
- optional **DuckDB** for archives, analytics, and run-history exploration

### 8.2 Tables / domains

Core entities:

- workspaces
- sessions
- runs
- steps
- messages
- events
- approvals
- tool_invocations
- artifacts
- checkpoints
- providers
- projects
- worktree_tasks
- plugins
- routes
- archived_runs

Provider credentials are intentionally not stored in the CodeWave database or `.codewave/providers.json`. The registry stores only enablement, priority, and command overrides; provider CLIs and environment variables own secrets.

### 8.3 Projects and isolated task worktrees

Projects are exact, canonical Git repository roots registered with the daemon. A task begins only from a clean source worktree and receives a readable `codewave/task-*` branch plus a dedicated worktree below the daemon-owned `.codewave/worktrees/` root. The source checkout is never repurposed as an agent sandbox, and CodeWave does not merge the task branch into the project's default branch.

The daemon is the only authority for project/task registration, change snapshots, acceptance, and revert. Change snapshots combine Git porcelain state with a bounded patch and a version derived from the current `HEAD` plus the complete changed-file bytes. Acceptance requires the exact reviewed version, refuses a clean, binary, unexpanded, or truncated review, stages and commits only inside the task worktree, and suppresses repository Git hooks. Revert requires the same freshness check and removes tracked plus non-ignored untracked task changes. A shared task-worktree reservation prevents provider launch and accept/revert preparation from crossing; only one provider run may prepare against a task workspace at a time. Accepted and reverted task workspaces are inspectable but closed to later provider runs, so a completed review cannot silently acquire new agent edits.

Filesystem APIs hide and reject Git control paths and daemon metadata paths rather than relying on the UI to avoid them. Task paths are canonicalized below the managed root and rebound on every review to the persisted branch, top level, and registered repository common-Git directory. Junction/symlink replacement and identity swaps fail closed, Git subprocesses have bounded output and disabled prompting/signing/hooks, and failed task creation removes only the exact managed worktree/branch it attempted to create.

This baseline intentionally excludes automatic merge/rebase, remote push, pull-request creation, conflict resolution, worktree garbage collection policy, and multi-user authorization. Those are later workflow layers, not implicit side effects of **Accept changes**.

Git remains an external effect outside SQLite's transaction. Durable idempotency prevents an interrupted request from blindly repeating a worktree or commit operation, but this baseline does not claim exactly-once Git effects across an operating-system process kill. An outcome-unknown response requires inspection of the named task branch/worktree before further mutation; durable Git-intent reconciliation is a desktop-alpha hardening item.

### 8.4 Checkpoints

A checkpoint should capture:

- provider id
- session metadata
- active run state
- latest visible transcript offset
- pending approvals
- recent artifacts
- tool execution state
- orchestration context

### 8.5 Why separate archive storage later

As runs grow, analytics and exploration become different workloads from operational storage.  
That is where DuckDB becomes useful.

---

## 9) Orchestration model

Do **not** put orchestration inside provider adapters.  
That creates lock-in and makes cross-provider coordination much harder.

Orchestration belongs above adapters.

### 9.1 v1 orchestration primitives

- **route**: choose provider/role for a task
- **delegate**: assign a subtask to another run
- **review**: send artifact/output to a reviewer role
- **verify**: run validation or checks
- **retry**: retry bounded failed work
- **checkpoint**: persist progress before a boundary
- **handoff**: move results into a new role/run

### 9.2 v1 roles

- `main`
- `planner`
- `reviewer`
- `verifier`
- `researcher`

### 9.3 Example flow

1. Main run receives user task.
2. Planner decomposes it.
3. Main delegates implementation to the highest-ranked ready provider for the required tools.
4. Reviewer uses a different explicitly enabled provider when one is ready.
5. Verifier runs checks.
6. Archive captures artifacts and final decision.

This is the first real form of a multi-agent environment.

Routing order is deterministic:

1. exclude disabled or unhealthy providers
2. prefer complete live tool coverage
3. use recent successful tool evidence
4. honor an explicit session/provider preference when safe
5. break equivalent ties by registry priority (Freebuff, OpenCode, then explicitly enabled paid/BYOK providers by default)

Fallback is selected before a run begins. CodeWave does not silently migrate an in-flight session across providers.

---

## 10) MCP and tool plane

The product needs **one shared tool plane**.

### 10.1 Why

If Gemini and Qwen each own completely separate tool registration and permission logic, the product will feel fragmented and hard to reason about.

### 10.2 Tool categories

- internal built-in tools
- external MCP servers
- provider-native tools
- plugin-exported tools

### 10.3 Shared tool descriptor

```ts
export type ToolDescriptor = {
  id: string;
  name: string;
  provider?: string;
  source: "internal" | "mcp" | "provider" | "plugin";
  permissionModel: "auto" | "ask" | "deny";
  inputSchema?: unknown;
  outputSchema?: unknown;
};
```

### 10.4 Permission policy

Every tool must have an approval policy.  
Do not let provider defaults silently become product defaults.

Recommended policies:

- file read: usually auto inside workspace
- file write: ask or scoped auto
- shell command: ask by default
- network fetch: ask by default
- git commit/push: explicit ask
- external services: explicit ask

### 10.5 Outbound MCP observer

`apps/mcp-server` is an optional local stdio adapter for MCP hosts that need bounded context from CodeWave. It is an HTTP client of the daemon and never reads SQLite, launches providers, accepts arbitrary daemon routes, or replaces `packages/mcp-hub`. The hub remains the inbound workspace tool registry; the observer is a removable outward projection.

The v0 surface is read-only: recent sessions, one session, one run, and bounded transcript pages. It negotiates only `sessions:read` and `runs:read`, accepts only a credential-free loopback daemon origin, keeps the connection lease in memory, propagates cancellation, and retries once after daemon restart. Projections omit absolute workspace paths, provider commands and revisions, raw events, tool input/output, approval payloads, artifact contents, and transcript metadata. No prompt, root, file, subscription, run-launch, steering, approval, provider-policy, or workspace-mutation capability is exposed.

MCP tool annotations remain display hints rather than authorization. The daemon's exact scopes, validation, response ceilings, and read-only route allowlist are the enforcement boundary. See [the MCP observer guide](mcp-observer.md).

---

## 11) UI shell

The shell should make the product feel like an environment, not a transcript window.

### 11.1 Main panes

- workspace/session sidebar
- run timeline
- transcript/output pane
- approvals pane
- artifacts pane
- tool activity pane
- orchestration board
- provider inspector
- project/task registry and bounded Changes review

### 11.2 Essential views for v1

- session list
- active run view
- approvals modal/panel
- artifact list
- provider selection and health
- checkpoint/recovery view

### 11.3 Suggested shell technology

Two reasonable paths:

#### Path A: Tauri + web frontend
Pros:

- lighter desktop footprint
- good local app feel
- still web-tech friendly

#### Path B: local web app first
Pros:

- faster to ship
- easiest debugging
- easiest iteration

Recommendation for v1: **local web app first**, then wrap later if needed.

---

## 12) Plugin system

The plugin system should be product-owned, not accidental.

### 12.1 Plugin types

- tool plugins
- workflow plugins
- artifact plugins
- provider enhancer plugins
- research plugins

### 12.2 notebooklm plugin boundary

`notebooklm-py` belongs here.  
Do not let it into the daemon core.

Plugin capabilities may include:

- import sources
- generate synthesized study artifacts
- create briefings
- export research packets

If it breaks, the rest of the environment should continue working.

---

## 13) Security and trust boundaries

This product controls code, shell commands, files, and possibly network calls.  
Trust boundaries matter.

### 13.1 Core trust boundaries

- provider engine process
- daemon supervisor
- local workspace files
- external MCP servers
- plugin processes
- remote APIs

### 13.2 Required controls

- explicit approval hooks
- protocol-version handshake, declared capabilities/limits, and fail-closed per-route client scopes
- run cancellation
- provider health checks
- tool audit logs
- mandatory restart-safe idempotency receipts for protected mutating commands, bound to strict canonical JSON and normalized query semantics
- content-addressed provider-policy revisions on every provider-dependent mutation and persisted session/run lineage
- one-active-run-per-session enforcement and stale-run fencing
- persist-first steering with normalized lifecycle events, capability-proven native acknowledgement, serialized delivery attempts, atomic queued-to-applied transitions, and restart-safe queued fallback
- monotonic per-run event sequences and cursor-bounded stream replay
- append-only per-session transcript messages with monotonic sequence, parent pointer, run provenance, and source-event provenance
- bounded transcript snapshot hydration and backward cursor pagination
- artifact provenance
- per-workspace policies
- optional restricted mode

### 13.3 Continuity conformance boundary

As one trust foundation for the wider coding-agent control plane, CodeWave uses a product-owned continuity contract to test the daemon and existing SQLite state path under retries, races, external process termination, restart, and reconstruction. The contract translates ten runtime invariants into six deterministic vector families without importing a separate runtime or persistence framework. It does not replace the provider, worktree, review, desktop, or product roadmap. See [the CodeWave continuity contract](continuity-contract.md).

The canonical boundary is the daemon-owned SQLite ledger. Provider processes, workspace and Git effects, MCP servers, remote services, and the operating-system user remain outside its transaction. CodeWave therefore persists intent before provider delivery, correlates acknowledgements where a structured protocol can prove them, and represents unresolved crash windows honestly; it does not claim exactly-once external effects.

Workspace files remain outside that ledger and use a deliberately narrow daemon surface: bounded UTF-8 preview, exclusive create, and size-limited compare-and-swap edit. File versions are content digests; stale edits return a conflict instead of overwriting external changes. Truncated previews are never editable, binary data is refused, same-directory temporary files are synced before replacement, and realpath plus no-follow checks fence traversal and link escapes.

Conformance evidence comes from `npm run check:continuity`, an isolated real-daemon harness, qualified synthetic provider fixtures, and its generated machine-readable report at `.codewave/qa/continuity-dogfood-2026-08-13/backend/validated-post-fix.json`. The report lives in the ignored `.codewave/` QA tree and is run evidence, not a checked-in attestation; its mere presence, documentation, and ordinary unit tests are not substitutes for a current validator pass. A passing report applies only to the identified tree and local synthetic topology.

This boundary preserves the local-first architecture: SQLite remains the production store, and Restate, PostgreSQL, DBOS, Docker, or another durable runtime are not required. It also preserves content boundaries: prompts, tool payloads, and artifacts may intentionally live in content-bearing tables, while authority and audit projections should remain useful without duplicating those bytes.

### 13.4 Non-goals for v1

- enterprise multi-user auth
- cloud multi-tenant orchestration
- remote sandbox fleet

Keep v1 local and inspectable.

---

## 14) Donor map

### Current harness references

- **Codex**: app-server separation, explicit thread/turn lifecycle, approvals, streamed items, steering, and per-turn policy.
- **OpenClaw**: authoritative gateway, versioned handshake, scopes, idempotency, event sequencing, payload limits, append-only transcript trees, and compaction discipline.
- **Hermes Agent and goose**: provider-neutral tools, skills, memory, MCP, recipes, structured API/ACP boundaries, and explicit security controls.
- **Grok Build**: inspectable context assembly/tool dispatch plus local configuration for skills, plugins, hooks, MCP, and subagents.
- **Odysseus**: a self-hosted workspace above local/API models with product-owned research, comparison, documents, memory, and scheduled workflows.

See [the 2026 harness research note](harness-research-2026.md) for primary sources and adopted versus deferred decisions.

### 14.1 Qwen Code donates

- core engine ideas
- agentic workflow concepts
- provider-facing runtime behavior
- skills/subagent thinking

### 14.2 Gemini CLI donates

- built-in tools philosophy
- MCP-first extension approach
- Gemini-native extension path

### 14.3 Codex donates

- app-server style separation between engine runtime and rich client
- event-stream-oriented integration shape
- approval-aware client/server design

### 14.4 Switchboard donates

- board-oriented orchestration ideas
- routing and role coordination
- archive thinking
- agent workflow visibility

### 14.5 oh-my-gemini donates

- resumable team-run ideas
- persistent coordination state
- lifecycle utilities for long-running work

### 14.6 notebooklm-py donates

- research/study plugin concepts
- source ingestion and synthesis workflows

---

## 15) v1 scope

### Must have

- local daemon
- shared event protocol
- SQLite state
- daemon-owned provider registry
- Freebuff primary policy plus automation-bridge seam
- OpenCode ACP/local fallback
- opt-in Qwen and Gemini adapters
- session view
- active run view
- approvals flow
- basic tool registry
- MCP support
- checkpoints
- artifact capture

### Should have

- orchestration board lite
- reviewer role
- verification role
- archive explorer

### Not now

- remote cloud sync
- full marketplace
- enterprise permission matrix
- complex multi-user collaboration
- many providers at once

---

## 16) Current implementation slice

### Slice goal

Turn CodeWave from a session viewer into a safe local project workspace: each coding task gets an isolated Git branch/worktree and every accept or discard decision is explicit, review-fenced, and daemon-owned.

### Slice contents

1. register only an exact canonical Git root and require a clean source worktree
2. create readable task branches in daemon-managed isolated worktrees
3. expose a bounded changed-file/patch snapshot with a full-state review version
4. commit accepted changes only to the task branch and never merge implicitly
5. make revert explicit and destructive, with stale-review and active-run fencing
6. hide and reject `.git`/daemon metadata through the workspace API
7. validate hooks, traversal/junction escape, bounded output, branch preservation, and browser keyboard/compact behavior deterministically

### Slice success criteria

- user can register the current clean Git root and create a named isolated task
- opening a task switches the shell to that worktree without changing the source checkout
- Changes renders a bounded review and calls out incomplete review explicitly
- stale acceptance/revert, active provider runs, protected paths, and junction escapes fail closed
- acceptance creates a task-branch commit while the project default branch stays unchanged
- revert cleans the task worktree while the project checkout stays unchanged
- destructive dialogs support Escape, cancel, confirmation, and focus restoration
- desktop and compact layouts remain usable without horizontal page overflow

---

## 17) Phase roadmap

### Phase 1 — Unified single-agent shell (implemented)

- daemon
- protocol
- state
- Freebuff, OpenCode, Qwen, and Gemini adapter seams
- approvals
- checkpoints

### Phase 2 — Shared tool plane (implemented, hardening)

- MCP manager
- tool registry
- permission policies
- better audit logs

### Phase 3 — Orchestration lite (implemented, hardening)

- planner role
- reviewer role
- verifier role
- board/timeline improvements

### Phase 4 — Structured harness protocol

- shared shell-safe provider process launcher, ordered line-bounded JSONL/Qwen control transport, exactly-once terminal ownership, and serialized ACP session/tool/permission mapping (implemented)
- client handshake, protocol version, capabilities, limits, and fail-closed scopes (implemented)
- queued steering with expected-run fencing plus runtime-negotiated Freebuff bridge steering and safe rejection/timeout/terminal/restart fallback (implemented)
- mandatory durable idempotency keys, strict canonical mutation schemas, and configuration revision hashes (implemented)
- monotonic event sequences and cursor-bounded SSE replay (implemented)
- append-only parent-linked transcripts and bounded hydration (implemented); explicit compaction checkpoints and pre-compaction memory hooks
- exact-pinned stable ACP v1 app runtime with strict protocol negotiation, bounded framing, capability-gated resume/load, replay suppression, permission cancellation ordering, message identity, and one terminal owner (implemented for built-in and custom ACP paths)
- profile-driven ACP v1 adapter with coalesced initialize probes, capability-derived resumability, bounded diagnostics/process cleanup, OpenCode as the reference descriptor, and durable provider-policy-v2 `acp.*` profiles (implemented)

### Phase 5 — Isolated project tasks (implemented baseline)

- daemon-owned project and task registry
- clean-base, managed Git worktrees and readable task branches
- bounded, versioned Changes review with stale-review fencing
- explicit task-branch commit or destructive revert; no implicit merge
- protected Git/daemon control paths, disabled hooks, active-run fences, and junction containment

### Phase 6 — Desktop alpha

- signed Electron shell supervising the local daemon on an ephemeral loopback port
- secure product protocol, minimal typed IPC, lifecycle recovery, crash diagnostics, and native workspace selection
- offline/install/upgrade/provider-PATH acceptance matrix before public binaries

### Phase 7 — Research plugins

- NotebookLM plugin
- source bundles
- briefing artifacts

### Phase 8 — Advanced routing and evals

- dynamic engine selection
- cost/speed preference routing
- loop control and reviewer stop conditions
- trace fixtures, recovery drills, and measurable harness evaluations

---

## 18) Key architectural rules

1. The UI never talks directly to provider CLIs. It talks to the daemon.
2. Providers never own global state. The daemon does.
3. Orchestration never lives inside provider adapters.
4. Provider-specific features must be surfaced as optional capabilities, not global assumptions.
5. Plugins must be removable without breaking the core.
6. Every meaningful action should produce normalized events.
7. Every run should be resumable or explicitly marked unrecoverable.
8. Every tool action should be attributable and inspectable.
9. Provider installation, enablement, authentication, and automation readiness are distinct states.
10. Routing never enables a provider or migrates an in-flight session implicitly.
11. Provider-dependent mutations must name the reviewed provider-policy revision and fail closed when it is stale.
12. Protected daemon routes require a live negotiated client connection with the exact route scope; health and handshake are the only public API surfaces.
13. Session transcripts are append-only, parent-linked daemon state. Run prompts and normalized messages must commit atomically with their owning run/event, and snapshot hydration must remain bounded.
14. ACP notifications must be serialized before normalization, and each tool invocation may emit at most one terminal tool outcome even when a provider repeats terminal updates.
15. Steering is persist-first and acknowledgement-based. A writable provider stdin is not capability proof; unacknowledged inputs must remain queued and restart-recoverable.
16. Outbound MCP adapters must remain narrow daemon clients, never raw daemon proxies or alternate state/provider control planes. Mutations require a separately reviewed scope, confirmation, idempotency, cancellation, and audit design.
17. Project tasks begin from an exact clean Git root, live only in daemon-managed worktrees, and require a complete version-matched review before task-branch acceptance. CodeWave never exposes Git control paths or merges the project branch implicitly.

---

## 19) Final recommendation

Keep CodeWave product-owned: daemon + normalized protocol + state + adapters + orchestration. Integrate providers through stable machine boundaries, prefer ACP/API/structured streams, and reject terminal scraping as a production architecture.

The current provider order is Freebuff first, OpenCode/local second, and explicitly enabled paid/BYOK providers after that. With shared structured transport and capability-proven Freebuff bridge steering in place, the next major backend investments are explicit transcript compaction/memory hooks, task-level trace evaluation, and additional native steering adapters only where their machine protocols can acknowledge delivery, as described in [the 2026 harness research note](harness-research-2026.md).
