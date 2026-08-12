# Qwemini

**One workspace for Qwen and Gemini**

Qwemini is an open-source agent workspace that brings **Qwen CLI** and **Gemini CLI** into one unified environment. Instead of using each tool separately in raw terminal flows, Qwemini provides a shared workspace for sessions, tools, context, and orchestration, so both engines can work inside the same system with a cleaner developer experience.

Qwemini is designed to be:

- **Open-source** — lightweight, hackable, and community-friendly  
- **Unified** — one place to run and manage both Qwen and Gemini  
- **Extensible** — ready for more tools, plugins, and providers over time  
- **Practical** — focused on real developer workflows, not just chat  

---

## Overview

Today, Qwen CLI and Gemini CLI are powerful on their own, but using them separately can feel fragmented. Qwemini aims to solve that by creating a shared environment where multiple agent backends can operate inside one workspace.

The goal is not just to wrap two CLIs in a thin shell, but to build a real developer environment with:

- shared sessions
- shared context
- shared tools
- orchestration across engines
- room for plugins and future providers

---

## Vision

Qwemini starts with **Qwen** and **Gemini**, but the long-term direction is bigger:

- a unified agent workspace
- a shared protocol for tools and events
- orchestration across multiple coding agents
- local-first and open by default
- extensible enough to support future engines and plugins

---

## Core Idea

Instead of thinking of Qwen CLI and Gemini CLI as separate tools, Qwemini treats them as **engines inside one workspace**.

That workspace can provide:

- a common session layer
- a shared tool plane
- orchestration and routing
- persistent state and history
- a better interface than raw terminal-only workflows

---

## Initial Goals

- Integrate **Qwen CLI** and **Gemini CLI** into one environment
- Provide a shared session and context model
- Support tool integration through a common interface
- Build an orchestration layer for switching or routing work between engines
- Keep the system lightweight, local-first, and easy to extend

---

## Planned Architecture

Qwemini will likely be structured around a few core layers:

### 1. Provider Adapters
Adapters for each backend engine, starting with:

- Qwen
- Gemini

### 2. Shared Workspace Layer
A common runtime for:

- session management
- state
- history
- artifacts
- approvals

### 3. Tool / MCP Layer
A shared place to connect tools and external capabilities.

### 4. Orchestration Layer
Logic for deciding how work flows between engines, tools, and future agents.

### 5. UI / Shell
A cleaner environment than raw terminal usage, while still keeping CLI power.

---

## Why Qwemini

Because powerful open tools should not feel isolated.

Qwemini is about making free and open agent tooling feel like a real environment:
simple, composable, and built for experimentation.

---

## Features

### Daemon & State
- **Local daemon** — HTTP server on `127.0.0.1:4120` serving both REST APIs and the web shell
- **SQLite state** — persistent sessions, runs, events, approvals, checkpoints, tool invocations, and session registry with WAL journaling
- **Shared protocol** — normalized `WorkbenchEvent` stream across providers (run.started, tool.requested, approval.resolved, etc.)

### Providers
- **Qwen CLI adapter** — stream-json SDK with control-path integration, approval mediation, session resume, and checkpoint support
- **Gemini CLI adapter** — ACP default (daemon-mediated permissions) with `QWEMINI_GEMINI_MODE=stream-json` fallback (note: Google shut down Gemini CLI for individual users on 2026-06-18 in favor of Antigravity CLI)
- **OpenCode CLI adapter** — ACP default (daemon-mediated permissions, session resume) with a `QWEMINI_OPENCODE_MODE=run` stream-json fallback; free local/cloud models via Ollama, OpenRouter, and OpenCode Zen/Go
- **Windows fixes** — direct Node entrypoint resolution for both providers; bundled `node-pty` patch for Gemini ACP
- **Health checks** — capability-aware provider probing with visible approval/resume/checkpoint differences

### Orchestration
- **Route Prompt** — orchestrator picks the best provider based on tool requirements, heuristics, and tool-plane signals
- **Review / Verify** — fork completed runs into reviewer or verifier sessions with cross-provider routing
- **Delegate** — spawn planner/researcher/verifier child runs under explicit orchestration roles
- **Handoff** — continue a run in a new main session with prior context preserved
- **Orchestration board** — grouped view of parent and child sessions as inspectable flows

### Tool Plane & MCP
- **Workspace registry** — `.qwemini/mcp.json` or `.mcp.json` defines tool requirements and MCP servers per workspace
- **Provider catalogs** — adapters declare available tools (workspace-read, write, shell, network, MCP)
- **Session registrations** — live tracking of tools observed and reported in active sessions
- **MCP hub** — normalizes tool readiness from provider availability, registry config, and observed history

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
- **Themes** — light/dark toggle (🌙/☀️) in the status strip, persisted in localStorage
- **Events timeline** — normalized event log with tool call/activity evidence
- **Approvals** — inline decision cards in the transcript plus daemon-mediated lists; keyboard approve/deny (`Shift+Enter`/`Shift+A`/`Shift+D`)
- **Tool plane evidence** — provider-enumerated vs event-observed tool registration signals
- **Archive explorer** — per-session run summaries with recovery/lineage metadata
- **Quick open** — grouped command palette with keyboard shortcuts (`Ctrl/Cmd+K`)
- **Checkpoints** — persisted recovery points visible in the inspector

### Validation
- `npm run check` — TypeScript type checking
- `npm run check:shell` — deterministic shell usability tests
- `npm run check:registrations` — E2E tool registration validation across providers
- Fake runtime fixtures for Qwen and Gemini to enable repeatable CI testing

---

## Architecture

Qwemini is structured as an npm monorepo with workspaces:

| Layer | Package | Purpose |
|---|---|---|
| **Daemon** | `apps/daemon` | HTTP server, provider lifecycle, API routing, static file hosting |
| **Web shell** | `apps/web` | React + TypeScript + Vite frontend |
| **Protocol** | `packages/protocol` | Shared types: events, adapters, sessions, tools, orchestration |
| **State** | `packages/state` | SQLite-backed persistence |
| **Orchestrator** | `packages/orchestrator` | Routing, follow-up, delegate, handoff logic |
| **MCP Hub** | `packages/mcp-hub` | Workspace registry, tool-plane snapshots, MCP server status |
| **Qwen provider** | `packages/providers/qwen` | Qwen CLI adapter with stream-json + control-path |
| **Gemini provider** | `packages/providers/gemini` | Gemini CLI adapter with ACP default + stream-json fallback |
| **OpenCode provider** | `packages/providers/opencode` | OpenCode CLI adapter with ACP default + run-JSON fallback |

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
npm run check:shell                      # Shell usability tests
npm run check:registrations              # Tool registration E2E tests
npm run check:registrations:json         # CI-friendly JSON summary
```

---

## Known limitations

- Qwen runs through the external CLI today; the vendor seam is ready for bounded in-repo builds under `vendor/qwen-code/`; the Qwen OAuth free tier ended 2026-04-15, so configure a local (Ollama) or paid model backend through Qwen Code settings
- Gemini defaults to ACP; use `QWEMINI_GEMINI_MODE=stream-json` as fallback if ACP regresses on another machine
- OpenCode defaults to ACP; use `QWEMINI_OPENCODE_MODE=run` as fallback, but note `opencode run` can hang on some Windows environments, and ACP mode requires the workspace path to exist and be a git repository

---

## Name

**Qwemini** = **Qwen + Gemini**

A simple open-source name for a shared workspace built around both.

---

## License

MIT — see [LICENSE](LICENSE) for details.
