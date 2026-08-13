# Agent Harness UX Research — Digest

**Date:** 2026-08-11
**Purpose:** Source material for the CodeWave shell redesign (`docs/shell-design-v2.md`).
**Method:** Live web research (docs, engineering blogs, community threads) plus direct observation of the apps running on this machine.

---

## 1. Codex CLI (OpenAI)

**Surface:** Terminal TUI + desktop "Codex App" + IDE extension.

What its UI does well:

- **Plan mode as a first-class toggle** (`/plan`, `Shift+Tab`). Planning mode gathers context, asks clarifying questions, and builds a plan *before* execution; it cannot write files. Best-practice guidance: "plan first for difficult tasks."
- **Graduated approval modes** — from default (ask per action) to "smart approvals" to full auto. Users move along the spectrum as trust builds.
- **Agent sessions with a timeline.** Sub-agents spawn as parallel sessions; each gets its own conversation card. A compact/detail view toggle lets you compress or expand each agent card.
- **Tabs inside a session** (conversation, agents, approvals, notes, follow-ups) instead of one long scroll.
- **Approval shield in the bottom-right** of the Codex App input — full approve is one click next to the mic/input.
- **Resume as a core verb** — sessions persist and are resumable across restarts.

Community signal: the unified app's sidebar floods with one entry per CLI/agent session (openai/codex#22321 asks for an "Agent View" with scoping/folders). Lesson: session lists need grouping, filtering, and archive semantics, or they collapse at volume.

## 2. Claude Code (Anthropic)

**Surface:** Terminal TUI + desktop app + IDE; one `queryLoop` shared across all surfaces. ~512K LOC, 98.4% deterministic infrastructure.

What its UI does well:

- **Mode is the anchor of the input.** The current mode (Ask permissions / Auto accept edits / Plan / Auto / Bypass permissions) is displayed bottom-left of the input field and switchable there. You always know the trust state you're in.
- **Seven permission modes form a graduated trust spectrum:** `plan → default → acceptEdits → auto (ML classifier) → dontAsk → bypassPermissions`. Deny-first: a broad deny always overrides a narrow allow.
- **Approval-fatigue insight (the big one):** users approve 93% of permission prompts anyway. Anthropic's response was *not more warnings* — it was restructuring the boundary (auto mode with a classifier, safe-tool allowlists, in-project edits auto-allowed because they're reviewable via git). Design rule: **only put a human gate where the action has real downside potential.**
- **Plan mode writes a visible plan** (a markdown file) — explore first, plan second, act only after explicit user approval. Plans are artifacts you can read, edit, and approve.
- **Subagent sidechains:** sub-agents (Explore, Plan, Verification, …) run in isolated contexts; only a summary returns to the parent. Parent context is protected.
- **Context is a managed resource:** 5 graduated compaction layers run before every model call; memory is file-based (CLAUDE.md hierarchy), visible and version-controllable, no hidden vector DB.
- **Reversibility-weighted risk:** lighter gates for reversible actions (in-repo edits are reviewable via version control), heavy gates for destructive/irreversible ones.
- **Trust is re-established per session** — permissions are never silently restored on resume.
- **Graduated extensibility:** hooks (zero context) → skills (low) → plugins (medium) → MCP (high) — each extension mechanism costs context differently.

## 3. OpenCode

**Surface:** TUI first, plus desktop app, web UI (`localhost`), IDE extensions. Go-based, open source.

What its UI does well:

- **Prompt-first, zero ceremony.** `opencode` in a directory; you just type. No session creation step. `@` references files (fuzzy search); `!` runs a shell command whose output joins the conversation as a tool result.
- **Slash commands + leader-key keyboard model.** `/help /connect /compact /details /editor /export /init /models /new /redo /sessions /share /themes /thinking /undo`, with `ctrl+x` as the default leader (`ctrl+x m` models, `ctrl+x l` sessions, `ctrl+x u` undo, `ctrl+x c` compact, `ctrl+x n` new, `ctrl+x t` themes, `ctrl+x x` export).
- **Command palette (`ctrl+p`)** for everything else, including UI settings (hide username, themes).
- **Undo/redo as a product feature** — git-backed; `/undo` reverts the last message *and its file changes*.
- **Thinking/reasoning toggle** (`/thinking`, `ctrl+t` cycles model variants) — the model's reasoning is an explicit, toggleable layer of the transcript.
- **Attention system:** optional desktop notifications + sounds for questions, permission requests, errors, and session completion. The UI *asks for your attention only when it needs it*.
- **Theme + keybind + diff-style customization** via `tui.json` — the user can make it theirs.
- **Session list/switch** (`/sessions`, `ctrl+x l`) and **export** (`/export` to Markdown), **share**.

## 4. Freebuff / Codebuff (the host app of this conversation — observed directly)

**Surface:** Desktop app; left thread/session rail, main conversation pane, right inspector, live preview tab, composer with suggestions.

What its UI does well:

- **Conversation = scrollable transcript of tool cards.** Every tool invocation renders as an inline card in the transcript (with a title and expandable detail), so the *narrative* of what the agent did is visible in place — not parked in a side panel.
- **Suggestions as inline clickable cards** in the transcript, at the exact point they make sense — a lightweight way to continue without typing.
- **Composer + attachment affordances** at the bottom, with a visible send affordance.
- **Threads/sessions in the left rail** with search, re-opening the current thread after restart.
- **Live preview tab** — the agent's output is not just text; you can *see* what it produced.
- **Quiet status:** top status bar communicates connection state ("connecting…" → live) without stealing attention.

## 5. Odysseus (PewDiePie — odysseus-dev/odysseus)

**Surface:** Self-hosted web workspace (Docker, port 7000), AGPL, local-first.

What its UI does well — it reframes the category:

- **The workspace, not the transcript.** Chat + agents, deep research, a writing-first documents editor, email triage, notes/tasks/calendar, and model comparison all live in *one* local workspace with shared memory/skills/MCP.
- **"Compare": blind side-by-side model testing** — run the same prompt on two models and synthesize. (CodeWave has the architecture for exactly this: multi-provider adapters.)
- **"Cookbook": hardware-aware model recommendations** — it guides you to the right local model for your machine, lowering the setup barrier.
- **Mobile/PWA-first thinking** (a chunk of it was built from a phone) — sessions and reminders usable anywhere.
- **Data ownership as the pitch** — everything local, privacy-first, self-hosted.

Relevance: CodeWave is already a multi-engine workspace; the research phase (deep research) and model-comparison features are natural, differentiated surfaces for a multi-provider shell.

## 6. Aider

**Surface:** Terminal chat.

What its UI does well:

- **Repo map** — a tree-sitter-generated symbol map of the repo is sent with each request; `/map` shows it. Context is *deliberately chosen* rather than dumped.
- **Git-native by design** — diffs, undo, and commits are the core loop: "use familiar git tools to easily diff, manage and undo AI changes."

## 7. Gemini CLI (Google)

**Surface:** Terminal, with a rebuilt "GUI-like" rendering layer (Dec 2025), plus third-party web UIs.

What its UI does well:

- **Multimodal input at the prompt** — images, PDFs, hand-drawn sketches can be dropped into the conversation (relevant: CodeWave's Gemini adapter is ACP-based and could carry image parts).
- **Interactive commands in the loop** — the agent can run interactive terminal programs (vim, top) inside the session.
- **Third-party web shells** converged on the same shape CodeWave already has: interactive chat + integrated terminal + file explorer with live editing + git integration + session management (e.g. cruzyjapan/Gemini-CLI-UI).

## 8. Cross-system survey: "Dive into Claude Code" (VILA-Lab)

A source-level analysis of Claude Code plus a general agent-design survey. Key framing:

- **98.4% of a harness is infrastructure, 1.6% is AI.** The agent loop is a simple while-loop; the product value is the permission gates, context management, tool routing, and recovery logic around it.
- **13 design principles** (the ones most relevant to UX):
  - *Deny-first with human escalation* — unrecognized actions are blocked and escalated, not run.
  - *Graduated trust spectrum* — a fixed permission level vs. a spectrum users traverse over time.
  - *Context as a scarce resource* — single-pass truncation vs. a graduated pipeline (CodeWave should treat context budget as a first-class meter).
  - *Append-only durable state* — auditability over query power.
  - *Reversibility-weighted risk* — lighter oversight for reversible actions.
  - *Values over rules* — contextual judgment with deterministic guardrails.
  - *Graceful recovery* — fail softly and recover, don't fail hard.
- **Humans become managers and verifiers:** agent products should support goals, plans, approvals, interrupts, reviewable diffs, escalation, and constrained write authority. These need to be *visible surfaces*, not hidden internals.
- **Extensibility should be graduated** (cheap → expensive), and **execution boundary is the safety boundary**.

---

## 9. Synthesis: patterns → CodeWave

| Pattern | Where it lives | CodeWave application |
|---|---|---|
| Prompt-first, session-lazy | OpenCode, Claude | Composer enabled always; session/workspace resolved at send |
| Mode as input anchor (graduated trust) | Claude, Codex | Mode menu at composer: Plan → Ask → Accept edits → Auto |
| Plan mode = visible plan artifact | Codex, Claude | Plan card with steps; read-only run phase; approve-to-execute |
| Inline approval cards, not a side list | Codex, Freebuff | Approval card inside the transcript with risk framing + allow-always |
| Gate only high-downside actions | Anthropic | Reversible in-repo edits auto-accepted under "Accept edits"; asks reserved for shell/network/destructive ops |
| Run = grouped timeline of steps | Codex, Freebuff | Transcript groups message + tool calls + results into collapsible step cards |
| Tool call as inspectable card | Freebuff | Expandable tool card: input, output, status, duration, diff view |
| Context as a visible meter | Claude, Aider | Context meter + compact action + visible memory/AGENTS files |
| Keyboard-first: leader key + palette + slash | OpenCode, CodeWave(partial) | Full keymap, Ctrl+K palette, `/` commands |
| Undo/redo via git | OpenCode, Aider | Git-backed undo of message + file changes |
| Attention only when needed | OpenCode | Notifications/sound for questions, permissions, completion |
| Session list needs scoping | Codex community | Folders, filters, archive; collapse long lists |
| Empty states teach | OpenCode `/init`, Odysseus cookbook | First-run wizard: pick provider, model, workspace; AGENTS init |
| Status quiet, decisions loud | Anthropic, Freebuff | Status strip for telemetry; decisions get color/attention |
| Multi-surface (TUI/web/desktop/IDE) | All | Daemon-served shell is already the web surface; keep one contract |
| Workspace > transcript | Odysseus | Research/compare/orchestration surfaces on top of sessions |

---

## 10. Source index

- Anthropic engineering — "How we built Claude Code auto mode" (approval fatigue, 93% rate, classifier design)
- VILA-Lab — "Dive into Claude Code" (GitHub, arXiv) — design space, 13 principles, cross-system comparison
- OpenCode docs — TUI (slash commands, leader keys, attention, customization)
- OpenAI Codex community threads — agent sessions flooding sidebar, Agent View request
- openai/codex#22321 — unified agent/session view request
- odysseus-dev/odysseus — README + HN/Reddit threads
- Gemini CLI — Google blog (GUI rebuild, interactivity), cruzyjapan/Gemini-CLI-UI
- Aider docs — repo map
- Direct observation: Freebuff (this conversation's host app), CodeWave v1 shell running locally
