# CodeWave — Architecture v1

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

---

## 3) Product shape

Qwemini has 4 main layers:

1. **Shell layer**  
   The user-facing environment: desktop or local web UI, command palette, conversation panes, run inspector, approval surfaces.

2. **Daemon layer**  
   The local supervisor process that manages sessions, providers, tools, state, streaming, and orchestration.

3. **Engine adapter layer**  
   Provider-specific connectors for Qwen, Gemini, and future engines.

4. **Tool + orchestration layer**  
   MCP manager, internal tools, run queues, role routing, checkpoints, archives, and optional research plugins.

---

## 4) Recommended repo structure

```text
qwemini/
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
  source: "qwen" | "gemini" | "system" | "plugin";
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

### 6.3 v1 adapters

#### Qwen adapter
Use as the first production adapter.

Why first:

- closest to the current use case
- broad provider/tooling direction
- good fit for free usage and experimentation
- strong agentic workflow surface

#### Gemini adapter
Use as the second production adapter.

Why second:

- strong built-in tooling and MCP story
- extension ecosystem and Gemini-native add-ons
- good donor for provider-specific enhancements

#### Codex reference adapter
Do not treat this as production v1.  
Use it only for protocol experiments or future compatibility.

---

## 7) Daemon architecture

The daemon is the heart of the system.  
It supervises engines, holds the authoritative run ledger, and streams events to the UI.

### 7.1 Daemon responsibilities

- session lifecycle
- provider process supervision
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
- plugins
- routes
- archived_runs

### 8.3 Checkpoints

A checkpoint should capture:

- provider id
- session metadata
- active run state
- latest visible transcript offset
- pending approvals
- recent artifacts
- tool execution state
- orchestration context

### 8.4 Why separate archive storage later

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
3. Main delegates implementation to Qwen.
4. Reviewer checks result using Gemini.
5. Verifier runs checks.
6. Archive captures artifacts and final decision.

This is the first real form of a multi-agent environment.

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
- run cancellation
- provider health checks
- tool audit logs
- artifact provenance
- per-workspace policies
- optional restricted mode

### 13.3 Non-goals for v1

- enterprise multi-user auth
- cloud multi-tenant orchestration
- remote sandbox fleet

Keep v1 local and inspectable.

---

## 14) Donor map

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
- Qwen adapter
- Gemini adapter
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

## 16) First implementation slice

### Slice goal

Get to a working single-machine environment where one task can be executed by Qwen or Gemini through one common shell.

### Slice contents

1. create daemon
2. create protocol package
3. create SQLite state package
4. implement Qwen adapter
5. implement Gemini adapter
6. build session UI
7. stream normalized events to UI
8. add approval requests
9. save artifacts and checkpoints
10. allow provider switching per session

### Slice success criteria

- user can open a workspace
- user can choose Qwen or Gemini
- prompt launches a run
- output streams live
- tool activity is visible
- approval requests are actionable
- run can be resumed after restart
- artifacts are stored and inspectable

---

## 17) Phase roadmap

### Phase 1 — Unified single-agent shell

- daemon
- protocol
- state
- Qwen + Gemini
- approvals
- checkpoints

### Phase 2 — Shared tool plane

- MCP manager
- tool registry
- permission policies
- better audit logs

### Phase 3 — Orchestration lite

- planner role
- reviewer role
- verifier role
- board/timeline improvements

### Phase 4 — Research plugins

- NotebookLM plugin
- source bundles
- briefing artifacts

### Phase 5 — Advanced routing

- dynamic engine selection
- cost/speed preference routing
- loop control and reviewer stop conditions

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

---

## 19) Final recommendation

Start with a **new repo**, not a giant fork.

Use:
- **Qwen Code** as the first engine donor "https://github.com/QwenLM/qwen-code.git"
- **Gemini CLI** as the second engine donor "https://github.com/google-gemini/gemini-cli.git"
- **Codex** as the app-server/client-boundary reference "https://github.com/openai/codex.git"
- **Switchboard** as the orchestration donor "https://github.com/TentacleOpera/switchboard.git"
- **oh-my-gemini** as the resumability donor "https://github.com/jjongguet/oh-my-gemini.git"
- **notebooklm-py** as an optional research plugin "https://github.com/teng-lin/notebooklm-py.git"

Build the product around a daemon + normalized protocol + provider adapters + orchestration layer.

That keeps the environment truly yours.
