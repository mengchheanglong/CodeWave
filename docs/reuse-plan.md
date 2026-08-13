# CodeWave Reuse Plan

Date: 2026-04-02
Scope: first bounded planning slice for a Codex-like local coding-agent environment

## Decision Summary

- Keep CodeWave as a new product-owned repo. Do not fork any donor repo wholesale.
- Use Qwen Code as the first runtime donor, but only by selectively vendoring provider-runtime pieces behind a CodeWave adapter.
- Use Gemini CLI as the second runtime donor behind the same adapter seam. Do not rely on stock `gemini --output-format stream-json` as the long-term integration because it does not give CodeWave daemon-owned approvals.
- Use Codex as the product-shape and daemon-client contract reference, not as the implementation base.
- Defer orchestration-heavy donors like Switchboard and oh-my-gemini to later reference work. They are not the v1 base.

## What Was Verified

- Local repo inspected: `AGENTS.md`, `docs/architecture.md`, `README.md`
- Local repo state: docs-only; no existing `implement.md`; no source packages yet
- Upstream repos verified with `git ls-remote` on 2026-04-02:
  - `QwenLM/qwen-code` HEAD `92f7549bdc684f264ae09dc4a6f8e7398363f53e`
  - `google-gemini/gemini-cli` HEAD `242afd49a1969d31cd03258b7e1df80ea8e7f3a8`
  - `openai/codex` HEAD `e846fed2b1755cab6c1d5a656a49db76b2778e91`
  - `TentacleOpera/switchboard` HEAD `15b8c9ee252b414f877a7633081d496b5d8c3fa7`
  - `jjongguet/oh-my-gemini` HEAD `d645ed2f1a7444a89617151cae4ec44862422992`
- Additional donor repo verified with `git ls-remote` on 2026-04-03:
  - `wygoralves/panes` HEAD `58adc78f50ece0fc0ed827cf3a96fdbe4615f095`

## Upstream Candidates

### 1. Qwen Code

- Repo: `https://github.com/QwenLM/qwen-code`
- Concrete upstream locations inspected:
  - `packages/cli/src/nonInteractive/session.ts`
  - `packages/cli/src/nonInteractive/types.ts`
  - `packages/cli/src/nonInteractive/io/StreamJsonOutputAdapter.ts`
  - `packages/cli/src/nonInteractive/control/`
  - `packages/cli/src/acp-integration/`
  - `packages/core/src/config/config.ts`
  - `packages/core/src/confirmation-bus/`
  - `packages/core/src/tools/`
  - `packages/core/src/mcp/`
  - `packages/core/src/subagents/`
- What it provides:
  - a real headless session loop with JSONL streaming and a control-request channel
  - approval modes, checkpointing hooks, tool registry, MCP plumbing, and subagent support
  - a provider runtime that already expects host interaction for permissions in stream-json mode
- Recommendation: `vendor selectively`
- Why:
  - Qwen is the first live engine CodeWave wants
  - its `nonInteractive` session and control plane are the closest donor for a daemon-owned runtime bridge
  - selective vendoring is lower-risk than a whole-repo fork while CodeWave still has no source tree
- Risks:
  - upstream moves quickly
  - internal assumptions still lean terminal-first
  - the control plane is Qwen-shaped, not provider-agnostic, so CodeWave must translate rather than adopt it as a shared product protocol

### 2. Gemini CLI

- Repo: `https://github.com/google-gemini/gemini-cli`
- Concrete upstream locations inspected:
  - `packages/cli/src/nonInteractiveCli.ts`
  - `packages/core/src/output/types.ts`
  - `packages/core/src/output/stream-json-formatter.ts`
  - `packages/core/src/agent/agent-session.ts`
  - `packages/core/src/agent/types.ts`
  - `packages/core/src/confirmation-bus/`
  - `packages/core/src/tools/`
  - `packages/core/src/mcp/`
  - `packages/cli/src/acp/`
- What it provides:
  - the second provider runtime donor
  - a useful agent event model and stream-json output envelope
  - built-in tool, MCP, checkpointing, confirmation-bus, and ACP surfaces
- Recommendation: `reference now, vendor selectively when the Gemini adapter starts`
- Why:
  - Gemini is the second production adapter, but CodeWave should not build two deep integrations before the first daemon seam is proven
  - the existing `stream-json` output is good for event-shape study and smoke harnesses
- Why not `wrap` as the main production path:
  - the stock stream-json surface exposes events, but not the host-owned approval control loop CodeWave needs
  - approvals still live inside Gemini's scheduler and confirmation bus unless CodeWave integrates deeper
- Risks:
  - simple subprocess wrapping would make CodeWave feel like a provider-owned wrapper
  - selective vendoring later will require careful trimming because the repo is broad and fast-moving

### 3. Codex

- Repo: `https://github.com/openai/codex`
- Concrete upstream locations inspected:
  - `codex-rs/app-server/README.md`
  - `codex-rs/app-server-protocol/src/protocol/common.rs`
  - `codex-rs/app-server-protocol/src/protocol/v2.rs`
  - `codex-rs/protocol/README.md`
  - `codex-rs/state/`
- What it provides:
  - the clearest reference for a local app-server boundary
  - thread/turn/item lifecycle concepts
  - approval request/response surfaces
  - a concrete example of separating protocol, app-server, and state
- Recommendation: `reference only`
- Why:
  - the product shape is the right reference
  - the implementation stack is Rust-heavy and much broader than CodeWave's first slice needs
  - borrowing the shape is useful; inheriting the whole codebase is not
- Risks:
  - copying the full protocol would overbuild CodeWave v1
  - Codex's protocol surface is larger than CodeWave needs for a first executable slice

### 4. Switchboard

- Repo: `https://github.com/TentacleOpera/switchboard`
- Concrete upstream location inspected:
  - `README.md`
- What it provides:
  - ideas for board-oriented routing, archives, and agent-visibility workflows
- Recommendation: `reference only`
- Risks:
  - VS Code-first
  - orchestration by terminal automation, not by a product-owned daemon
  - not suitable as the CodeWave runtime base

### 5. oh-my-gemini

- Repo: `https://github.com/jjongguet/oh-my-gemini`
- Concrete upstream location inspected:
  - `README.md`
- What it provides:
  - resumable team lifecycle ideas
  - tmux-driven multi-worker operational patterns
- Recommendation: `reference only`
- Risks:
  - Gemini-specific
  - tmux-first
  - extension and orchestration tooling, not a provider-agnostic product core

### 6. Panes

- Repo: `https://github.com/wygoralves/panes`
- Concrete upstream locations inspected:
  - `src/App.tsx`
  - `src/globals.css`
  - `src/components/layout/ThreeColumnLayout.tsx`
  - `src/components/chat/ChatPanel.tsx`
  - `src/components/chat/MarkdownContent.tsx`
  - `src/components/chat/MessageBlocks.tsx`
  - `src/components/shared/CommandPalette.tsx`
  - `src/components/shared/ToastContainer.tsx`
  - `src/lib/commandPalette.ts`
  - `src/stores/threadStore.ts`
  - `src/stores/toastStore.ts`
- What it provides:
  - a strong frontend reference for local agent-workspace UX, especially multi-pane layout, command palette flows, toast notifications, markdown rendering, and chat-block presentation
  - concrete React-side solutions for message virtualization, worker-backed markdown parsing, and keyboard-driven workspace navigation
  - design-token and panel-resize patterns that feel closer to an agent workspace than the current minimal CodeWave shell
- Recommendation: `reference now, selectively adapt later`
- Why:
  - Panes is a Tauri + React desktop product, while current CodeWave shell is a daemon-served web app with plain JS modules
  - directly vendoring Panes frontend code would import the wrong product shape, state model, and UI stack
  - selective extraction of interaction patterns is still high value, especially for a future command palette, toast system, richer markdown transcript rendering, and resizable pane UX
- What to adapt first:
  - `src/lib/commandPalette.ts` for prefix/mode logic and search-scoping behavior
  - `src/stores/toastStore.ts` and `src/components/shared/ToastContainer.tsx` as the product pattern for replacing single-slot notices with queue-based notifications
  - `src/components/chat/MarkdownContent.tsx` for caching and worker-backed markdown rendering strategy
  - `src/globals.css` and `src/components/layout/ThreeColumnLayout.tsx` as visual/layout reference only, not as direct imports
- Why not `vendor`:
  - the donor depends on React 19, Zustand, Tailwind, Tauri IPC, and a desktop-first app shell
  - `ChatPanel.tsx`, `threadStore.ts`, and most workspace/git/terminal components are tightly coupled to Panes runtime models rather than CodeWave's daemon APIs
- Risks:
  - importing Panes UI wholesale would pull CodeWave toward a new desktop/React rewrite instead of finishing the current daemon-owned shell
  - Panes is thread-centric and Codex/Claude-oriented, which does not map cleanly onto CodeWave's current session/run inspector model
  - direct reuse of styling or components without stack alignment would create a mixed frontend architecture that is harder to maintain than the current shell

## What Should Be Reused vs Built

### Reuse Directly

- Upstream auth and config locations for installed CLIs
  - Qwen stays on its native config/auth conventions
  - Gemini stays on its native config/auth conventions
- Upstream binary install and health-check flows for developer setup and diagnostics

### Wrap

- Installed upstream CLIs for `doctor`-style detection, auth bootstrap, and temporary smoke harnesses
- Gemini's stock `stream-json` mode for short-lived investigation harnesses only

### Vendor

- Qwen Code provider-runtime pieces first:
  - `packages/cli/src/nonInteractive/`
  - `packages/cli/src/acp-integration/` only if needed by the first adapter seam
  - `packages/core/src/confirmation-bus/`
  - `packages/core/src/tools/`
  - `packages/core/src/mcp/`
  - minimal config/checkpoint dependencies required to run the provider bridge
- Gemini CLI provider-runtime pieces second:
  - `packages/core/src/agent/`
  - `packages/core/src/confirmation-bus/`
  - `packages/core/src/tools/`
  - `packages/core/src/mcp/`
  - `packages/cli/src/nonInteractiveCli.ts` and adjacent output pieces only after the Qwen seam is stable

### Fork

- None in the first bounded slice
- If a vendored provider subtree starts diverging materially, promote that provider subtree into its own maintained fork later

### Reimplement Minimally

- CodeWave daemon
- CodeWave normalized runtime protocol
- SQLite run/session/event ledger
- product-owned web shell
- provider adapter interface and event translators
- approval store, artifact store, and checkpoint metadata store
- shell UX primitives that should stay CodeWave-owned even when informed by Panes:
  - session/run inspector composition
  - provider-health and tool-plane panels
  - follow-up/delegate/handoff orchestration surfaces

## Frontend Donor Strategy

- Use Panes as a frontend pattern donor, not as a frontend base.
- Keep the current daemon-served shell architecture unchanged.
- Borrow ideas and small algorithms before borrowing components.
- Highest-value Panes-derived candidates for CodeWave:
  - command palette query-mode parsing and scoped search behavior
  - toast queue behavior instead of a single global notice slot
  - worker-backed markdown transcript rendering and caching
  - resizable panel persistence and layout token patterns
- Do not import Panes chat/workspace/git/terminal component trees directly unless CodeWave intentionally migrates to a React-based shell later.

## Recommended Starting Base

- Product base: this repo stays a new CodeWave codebase with its own daemon, shell, state, and protocol.
- First runtime base: selective Qwen Code vendoring behind `packages/providers/qwen`.
- Second runtime base: selective Gemini vendoring behind `packages/providers/gemini` after the first adapter seam is proven.
- Product-shape reference: Codex app-server thread/turn/item and approval lifecycle, adapted into CodeWave's own smaller v1 protocol.

This is the smallest path that still preserves the non-goals:

- not a thin single-provider wrapper
- not a terminal-only shell
- not a provider-owned UI
- not orchestration hidden inside adapters

## Minimal Codex-like Behavior Targeted First

CodeWave v1 should first prove this behavior:

1. A product-owned local web shell talks only to a local daemon.
2. The daemon creates sessions and runs, persists them in SQLite, and streams normalized events.
3. A live Qwen-backed run executes through a CodeWave adapter, not by handing the UI to the Qwen CLI.
4. Tool activity is visible as normalized events, with daemon-owned approval records.
5. Transcript output, tool calls, approvals, and artifacts are stored and reloadable after restart.
6. The adapter seam is explicitly provider-keyed so Gemini can be added next without changing the shell contract.

## What Not To Build In The Next Slice

- a full marketplace or plugin framework
- a desktop wrapper
- multi-agent orchestration boards
- advanced reviewer loops
- a giant shared abstraction before both Qwen and Gemini require it
- a whole-repo fork of any donor
