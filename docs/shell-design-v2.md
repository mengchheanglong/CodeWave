# Qwemini Shell — UX/UI Design v2

**Date:** 2026-08-11
**Status:** Design spec (not yet implemented)
**Sources:** `docs/ux-research.md` (harness research digest), live audit of the v1 shell, `docs/architecture.md` design rules.

---

## 1. Why a redesign

The v1 shell is architecturally right — daemon-owned, provider-agnostic, three-column workbench — but operationally unsatisfying. The audit found seven concrete problems, all in the shell layer only:

1. **Session creation is a barrier, not a flow.** The composer is disabled until a session exists, and sessions are created through a setup form tucked in the left rail with defaults silently applied (provider: Qwen, workspace: current repo). Every mainstream harness (Codex, Claude Code, OpenCode) is prompt-first: you just type.
2. **No mode concept.** Trust is expressed as a bare policy dropdown (Manual / Allow / Deny) half-hidden in the run header, plus a "Ask first / Full access / Read only" pill in the composer. There is no Plan mode, no Accept-edits, no graduated spectrum — the single most important control in Claude Code and Codex is missing.
3. **Approvals are disconnected from the transcript.** Pending decisions appear only in a right-rail list with no surrounding context. Codex renders approval cards inside the timeline; Freebuff renders every tool call as an inline card. Qwemini has a superb approval ledger — it renders it like a debug panel.
4. **The transcript is a flat list of messages.** Tool activity, thinking, and final text all interleave without grouping. No collapse, no step structure, no "what happened and what did it produce" narrative.
5. **Header button clutter.** `Recover · Files · Cancel · Review · Verify · Close` float in the run header with no labels or rationale for when they appear.
6. **Provider is locked per session and looks clickable when it isn't.** The "Qwen" pill reads as a dropdown but is a static label; switching providers means creating a new session.
7. **Context is invisible.** No indication of how much context a run is consuming, no compact action, no undo — despite the daemon persisting everything needed for all three.

The design below fixes these in the shell layer first (Phase 1) and only touches the daemon where a capability genuinely requires it (Phases 2–3).

---

## 2. Design principles (v2)

Derived from the research digest and the project's own architecture rules:

1. **Prompt-first, session-lazy.** The composer is always enabled. Session, workspace, provider, and mode are resolved at send time — explicitly if the user picks them, inferably if not. (OpenCode / Claude Code)
2. **Graduated trust, anchored at the input.** The current mode — `Plan → Ask → Accept edits → Auto` — is a menu on the composer, always visible, always changeable. The existing `manual/allow/deny` policy engine maps onto this spectrum; no new governance is invented, only presented. (Claude Code)
3. **Only gate high-downside actions.** Reversible, in-workspace, git-reviewable edits should not ask when the mode says "Accept edits." Asks are reserved for shell commands, network, destructive ops, and anything outside the workspace. (Anthropic auto-mode insight)
4. **Decisions are cards in context.** Approvals render inside the transcript at the point of the tool call, with the full tool input, a risk read, and allow-always. The right rail mirrors them as a queue. (Codex, Freebuff)
5. **A run is a timeline of steps, not a feed of lines.** Messages, tool calls, and results group into collapsible step cards; thinking is a toggleable layer. (Codex, OpenCode)
6. **Context is a managed, visible resource.** A context meter sits by the composer; compact and undo are one keystroke away. (Claude Code, Aider, OpenCode)
7. **Keyboard-first.** Every frequent action has a shortcut; the palette (`Ctrl+K`) is the escape hatch for everything else. (OpenCode)
8. **Status is quiet; decisions are loud.** Telemetry (provider, model, elapsed, health) lives in a slim status strip. Anything that needs the user (approval, error, completion, question) gets color, position, and optional notification. (Anthropic, Freebuff)
9. **Provider-agnostic skin.** No provider-specific UI branches. Capability flags from the daemon (`daemonApprovalMediation`, `resumableSessions`, …) drive what affordances appear. (architecture rule 2/5)
10. **Empty states teach.** First-run and empty states explain the next step in one sentence, with an action. (OpenCode `/init`, Odysseus cookbook)

---

## 3. Information architecture

Keep the three-column workbench (already built, resizable, persisted) and reorganize what goes in each column.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ STATUS STRIP: workspace · git · provider/model · mode · session · daemon  │
├────────────┬──────────────────────────────────────────────┬───────────────┤
│ LEFT RAIL  │  CENTER — Run workspace                      │ RIGHT RAIL    │
│ · new      │  · Thread tabs (open sessions)               │ · Pending     │
│ · search   │  · Run header: title · phase · actions       │   decisions   │
│ · folders  │  · Timeline (step cards, collapsible):       │ · Activity    │
│   +threads │      plan card · approval cards ·            │   (tools)     │
│ · counts   │      message/tool/result step groups         │ · Artifacts   │
│            │  · Composer: mode · provider · @context ·    │ · Files       │
│            │              context meter · Send            │ · Context     │
├────────────┴──────────────────────────────────────────────┴───────────────┤
│ Command palette (Ctrl+K) · toasts · notifications                         │
└───────────────────────────────────────────────────────────────────────────┘
```

**Column jobs (invariant):**
- **Left rail** = navigation (where are my sessions and folders).
- **Center** = comprehension + action (what is happening now, what needs me).
- **Right rail** = inspection (what happened, what was produced, what will run).

---

## 4. Core surfaces

### 4.1 Status strip (new — replaces the bare header badges)

A 28px strip at the top of the workbench, quiet by default:

```
● daemon · C:\Users\User\projects\test · main · OpenCode (zen/grok-3.2) · Ask · 2m 14s
```

- Left: daemon connection dot (green/live, amber/connecting, red/down) — same signal as today's badge, smaller.
- Middle: active workspace + git branch (from `/api/workspace/entries` + git probes).
- Right: active provider + model (from runtime + session), current mode, run elapsed timer, cancel button when a run is active.

Never scrolls, never flashes; color changes only for decisions/errors.

### 4.2 Session rail (rework of the current rail)

- **Composer stays king**: remove the mandatory session-create form. The rail's top becomes `New thread` + `Add folder` + search, exactly as today.
- **Thread grouping by folder** (already in v1) with expand/collapse; sort by last activity; counts (`Runs · Archived · Agents`) become filter chips that filter the list instead of inert numbers.
- **Right-click / `…` menu** gains: Rename, Archive, Delete, New thread here, Recover.
- Session rows show: title, relative time, status dot (active/idle/failed), provider glyph, and the last run's status chip. One line, dense.
- Empty rail state: "No sessions — type a prompt to start, or open a folder."

### 4.3 Run workspace (center)

#### 4.3.1 Thread tabs
Replace the single active-session view with tabs for open threads (like the current `TabBar` but for sessions): pinned active thread + recent threads, closable. This is the fix for "can only look at one session."

#### 4.3.2 Run header
Tight, contextual:

```
▸ the frontend is messed up right now          ● running · 2m 14s     [■ Cancel]
  Run 170b19de · Ask · OpenCode · C:\Users\...          [⋮ Run menu]
```

- Title, phase chip (Idle / Running / Awaiting approval / Completed / Failed / Cancelled), elapsed.
- Actions that are **only** relevant in context: Cancel (running), Approve-all-pending (awaiting approval), Recover (failed/interrupted), Review / Verify (only when the session has orchestration metadata). Everything else moves into the `⋮ Run menu` (export transcript, mark archived, copy run id, open events).
- Buttons get labels; icons alone are not allowed in the header.

#### 4.3.3 Timeline (the core redesign)

The transcript becomes a **stack of step cards**. A step = one agent turn's unit of work:

```
┌─ 📝 Step 3 · message ─────────────────────────────────────────────────┐
│  "Let me check the Tailwind config."                                  │
└───────────────────────────────────────────────────────────────────────┘
┌─ 🔧 Step 4 · run_shell_command ─────────────────────────── 1.2s · ✓ ─┐
│  $ cat tailwind.config.ts                                            │
│  ▸ output (3 lines)   [copy]                                         │
└───────────────────────────────────────────────────────────────────────┘
```

Rules:
- **Message steps** (user + assistant text) render as today, slightly more compact.
- **Tool steps** render as cards: tool glyph + name, one-line summary (command / file path / read target), duration, status (pending / running / ok / error). Click to expand input + output; outputs collapse to 8 lines with `[copy]`.
- **Thinking/reasoning** renders as a collapsed strip ("⟳ thinking…") expandable inline; a global `/thinking`-style toggle hides it entirely. (OpenCode)
- **Approval cards** insert inline at the point of the tool call (see 4.5).
- **Plan cards** sit at the top of a plan-mode run (see 4.6).
- **Edits** (file writes) render a diff view inline when the tool payload carries before/after content (already in the ledger for Gemini ACP); otherwise a file-path chip linking to the Files tab.
- Collapse-all / expand-all in the run header; scroll position is preserved on refresh.

This maps 1:1 onto existing data: `run.started/output.delta/message.created/tool.started/tool.completed/approval.requested` events are already grouped per run; the timeline is a projection, not new state.

#### 4.3.4 Composer (the anchor of the redesign)

```
┌─────────────────────────────────────────────────────────────────────┐
│ [@ file mention chips …]                                            │
│  Ask Qwemini to work on this workspace…                             │
│ ┌──────────┐ ┌──────────┐ ┌────────────┐              ┌───────────┐ │
│ │ Mode: Ask ▾│ │ OpenCode ▾│ │ ctx 34% ▾ │  Ctrl+Enter │ ▶ Send    │ │
│ └──────────┘ └──────────┘ └────────────┘              └───────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

- **Mode menu (left):** `Plan · Ask · Accept edits · Auto` — the graduated spectrum (section 5). The current mode is always visible on the left of the composer, like Claude Code's bottom-left mode.
- **Provider menu:** the session's provider if set (with a 🔒 "session" note), or a picker (Qwen / Gemini / OpenCode) when the thread is unbound. Changing provider on an unbound thread re-binds it; on a bound thread it offers "new session with this provider" (no silent rebind of history).
- **@-mention context:** `@` opens a fuzzy file/AGENTS/workspace picker (v1 already has workspace entries; add fuzzy search). Chips appear above the textarea.
- **Context meter:** `ctx 34%` — a compact progress bar + label built from run event volume and char budget (daemon can expose a run's approximate context share; v2.1 spec below). Click → compact action, with an explicit "Compacted · 12k tokens freed" toast.
- **Send affordance:** `Ctrl+Enter` hint, disabled only when the prompt is empty or the daemon is down — **never** because "no session exists."
- **Attachments** (capability-gated): image/paste appears only for providers whose capability flags allow multimodal (Gemini ACP already carries image parts upstream).

Composer states:
- No thread → "Start a new thread" placeholder; typing + Send auto-creates a session with chosen provider/mode (POST `/api/sessions` + start run in one gesture).
- Thread selected, run complete → "Ask for follow-up changes…" (as today).
- Run running → prompt still accepted → queued as follow-up or new run per thread setting (today: new run in same session — keep).
- Awaiting approval → composer shows a highlighted hint: "1 approval pending — see the card in the timeline" with an Approve-all shortcut.

### 4.4 Right rail (inspection)

Rework from raw tab dump to **"what's happening now → what was produced"**:

| Tab | Content | v1 source |
|---|---|---|
| **Pending** | Approval queue with inline allow-always; empty state: "No decisions need you right now." | `ApprovalListPanel` |
| **Activity** | Tool invocation ledger, newest first, with status + duration; filter by provider/source. | `ToolActivityList` + `ToolRegistrationEvidenceList` |
| **Artifacts** | Artifact list with open/copy/download. | `ArtifactListPanel` |
| **Files** | Workspace file panel (unchanged) + changed-files diff summary. | `WorkspaceFilePanel` |
| **Context** | Session summary: provider, session id, recovery lineage, checkpoints, memory/AGENTS files, context meter. | Context inspector |

Tab badges show counts only where useful: Pending (number of open approvals, colored when >0), Activity (live spinner while a run streams).

### 4.5 Approval card (inline, the "loud decision")

```
┌─ 🔧 run_shell_command · bash ─────────────── [pending · needs you] ──┐
│  $ rm -rf build && npm run deploy                                    │
│  📍 Outside workspace · Destructive · Network                        │
│  From: "deploy the app" (Run 170b19de, step 4)                       │
│  [ ✓ Approve (⇧A) ]  [ ✕ Deny (⇧D) ]  [ ↻ Allow always for session ]│
└──────────────────────────────────────────────────────────────────────┘
```

- Renders **inline in the timeline** at the tool call, plus mirrored at the top of the Pending tab.
- **Risk chips** derived from the tool name + input (shell / write / network / outside-workspace / destructive) — pure client heuristics over the payload, no new daemon contract.
- **Allow-always** writes a per-session tool-pattern allow rule (daemon already persists `session_tool_registry`; v2 maps it to the policy engine).
- Keyboard: `⇧A` / `⇧D` approve/deny the focused pending card; `⇧Enter` approves all.
- When the session policy auto-resolves (allow/deny), the card shows the resolution inline with the auto reason (today's `approval.resolved` payload already carries the reason string).

### 4.6 Plan mode surface (Phase 2)

`Mode: Plan` flips a run into read-only exploration (daemon enforces: no mutating tool execution; provider adapters already gate `can_use_tool`). The run's final message becomes a **Plan card**:

```
┌─ 📋 Plan · 4 steps ─────────────────────────── [Approve & execute] ──┐
│  1. Explore repo structure and Tailwind config                       │
│  2. Recreate tailwind.config.ts + postcss.config.js                  │
│  3. Install autoprefixer                                             │
│  4. Restart dev server and verify build                              │
│  [ Edit plan ]  [ Discard ]                                          │
└──────────────────────────────────────────────────────────────────────┘
```

- Approve → run proceeds in the session's execution mode (default: Ask).
- Steps tick as corresponding tool activity lands in the timeline (best-effort matching: file paths from tool payloads vs plan step text).
- Plan content persists as an artifact (protocol already has `artifact.created`; v2 adds a plan artifact type).

### 4.7 Command palette + keymap (Phase 2 polish, skeleton in Phase 1)

`Ctrl+K` palette (already exists) gains grouped commands: **Navigate** (sessions, folders, runs, tabs), **Run** (new thread, route, delegate, review, verify, recover, cancel, compact, undo), **Composer** (toggle mode, attach, send), **View** (tabs, rail visibility, theme).

Keymap (leader `Ctrl+;` or `Ctrl+Space`; documented in palette):

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Command palette |
| `Ctrl+Enter` | Send |
| `⇧A` / `⇧D` | Approve / deny focused approval |
| `⇧Enter` | Approve all pending |
| `Ctrl+P` | Toggle Plan mode |
| `Ctrl+Z` | Undo last message + file changes (git-backed) |
| `Ctrl+Space` | Cycle mode (Plan → Ask → Accept → Auto) |
| `Ctrl+T` | Toggle thinking visibility |
| `Ctrl+S` | Session list / switcher |
| `Ctrl+.` | Compact context |

---

## 5. Mode spectrum ↔ existing policy engine

No new governance model — the daemon's per-session policy (`manual`/`allow`/`deny`, enforced at the API boundary, gated by `daemonApprovalMediation`) becomes the enforcement layer of a user-facing spectrum:

| UI mode | Daemon policy | Tool behavior | v1 equivalent |
|---|---|---|---|
| **Plan** | (new phase flag) | read-only; plan card; approve-to-execute | — |
| **Ask** | `manual` | every mutating tool → inline card | Manual |
| **Accept edits** | `manual` + auto-approve in-workspace edit tools | file writes inside workspace auto-approve; shell/network ask | Allow (narrowed) |
| **Auto** | `allow` (v1) / classifier (v2.2) | safe tools auto; classifier gates the rest | Allow |

- The composer mode menu and the run header both reflect the **same session policy** — one source of truth (PATCH `/api/sessions/:id` already exists).
- Providers without `daemonApprovalMediation` (none today) fall back to their native prompts with a notice.
- Mode changes are logged as events (`session.policy.changed` — already emitted today) and re-echoed in the status strip.

---

## 6. Onboarding / empty states (Phase 1)

- **First run:** centered card — "Welcome to Qwemini" with three steps: (1) open a folder, (2) pick a provider — Qwen, Gemini, or **OpenCode** with its free models, (3) type anything. Provider health from `/api/runtime` shown as ready/unready with a one-line fix hint ("run `opencode auth login`").
- **Empty timeline:** "Send a message to start. Ctrl+Enter to send."
- **No approvals:** "Tool approvals will appear here — inline in the conversation, or queued here."
- **Provider note text** (already in v1, `sessionProviderNote`) stays, rendered under the composer provider menu.

---

## 7. Component inventory

**New components** (all under `apps/web/src/components/`):
- `StatusStrip.tsx` — the top strip (daemon, workspace, git, provider/model, mode, elapsed).
- `ComposerModeMenu.tsx` — graduated trust menu (wraps existing policy state).
- `ComposerProviderMenu.tsx` — provider picker / lock note (replaces the static pill).
- `ContextMeter.tsx` — budget bar + compact action.
- `StepCard.tsx` — generic collapsible step card.
- `ToolStepCard.tsx` — tool invocation card (input/output/duration/status/copy/diff).
- `ApprovalCard.tsx` — inline approval decision card (reuses `ApprovalListPanel` data).
- `PlanCard.tsx` — plan artifact + approve/edit (Phase 2).
- `ThreadTabs.tsx` — session tabs in the center column (wraps existing `TabBar`).
- `RunMenu.tsx` — overflow menu replacing header button clutter.

**Reworked**: `RecentSessionList` (grouping + filters), `ApprovalListPanel` → Pending, run header in `App.tsx`, composer in `App.tsx` (state already exists in `shell-controls-state.ts` / `shell-summary-state.ts`).

**Untouched**: daemon routes, protocol events, state schema, provider adapters.

---

## 8. Phased roadmap

### Phase 1 — Shell-only redesign (no daemon/contract changes) — ✅ implemented
- Prompt-first composer (auto-create session on send) — requires only reusing `POST /api/sessions` + start-run flow in `controller-run-action-flows.ts`.
- Inline approval cards + Pending queue; keyboard approve/deny.
- Step-card timeline (grouping + collapse) over existing events.
- Status strip; run-header cleanup (contextual actions + `⋮` menu); thread tabs *(implemented in the v2 visual pass — see below)*.
- Empty states + onboarding card; session rail filters.
- **Validation:** `npm run build:web`, `npm run check`, live daemon smoke (all three providers), keyboard + click through the flows in the Preview.

### Phase 1b — Shell v2 visual pass (2026-08-12) — ✅ implemented
Applied the approved prototype (`docs/prototype/shell-v2.html`) to the real shell, not just the features:
- **Slim status strip** — the fat `app-menu-bar` (brand + connecting badge) was merged into a single 30px quiet strip: brand mark · `● daemon` · workspace · provider · mode · run phase · theme · bell (prototype §4.1).
- **Run header decluttered** — the seven-button toolbar (`Cancel · Recover · Files · Review · Verify · Undo · Close`) collapsed into a row-2 meta line (`Run id · mode · provider · path`) plus **⊞ Expand all**, **■ Cancel**, and a **⋮ Run menu** (Files / Review / Verify / Recover / Undo / Hide controls) (prototype §4.3.2). Expand-all is wired to the timeline's step-card expansion via a signal prop.
- **Thread tabs** — a session tab strip above the run header (top 8 recent sessions, provider dot, `＋ new`), switching via existing session-selection (prototype §4.3.1; this was the deferred Phase 1 item).
- **Composer box** — the composer is now a bordered, focus-highlighted box with the mode/provider/ctx-meter/send controls inside; mode indicator is a colored dot (amber=ask, green=allow, gray=deny, orange=plan) (prototype §4.3.4).
- **Hint bar** — the `terminal-status-bar` footer was replaced with the prototype's keyboard-shortcut hint bar (`Ctrl+K palette · Ctrl+Enter send · ⇧A/⇧D approve/deny · …`), workspace path on the right.
- **Dense rail rows** — session rows show provider dot + title + `PROVIDER · POLICY` meta line (prototype §4.2).
- Light-theme overrides added for every new surface; `npm run check` + `npm run build:web` green; live smoke: real opencode run rendered its tool step card with the new header, Expand all / Collapse all both worked, thread tabs switched sessions.

### Phase 1c — Prototype design language (2026-08-12) — ✅ implemented
The v2 pass fixed structure but the app still wore the old panes skin (near-black `#0a0a0a`, red accent `#ff6b6b`, 22px radius). This pass replaced the *design tokens* with the prototype's palette (`docs/prototype/shell-v2.html`):
- **Palette**: body/background `#0c1014`, raised panels `#121920`, cards `#18212b → #141b24` gradient, borders `rgba(140,160,180,…)`, text `#e8eef4` / muted `#8fa0b3` / dim `#5c6b7d`; accent switched from red to **orange `#ff8a3d`**; card radius 10px; status colors green `#4ade80` / amber `#fbbf24` / red `#ff6b6b`.
- **Legacy overrides hunted down**: several high-specificity `!important` rules from the old panes skin (`background: transparent !important` on rail rows, `#121212` sidebar, red-tinted New-thread button, blue `#7db7ff` active indicator) were replaced with navy/orange equivalents.
- Verified via computed styles: body `rgb(12,16,20)`, strip/sidebar/composer/hintbar/utility all navy, session cards render the `#18212b→#141b24` gradient, active item solid `#1f2a36` with orange inset bar, New-thread button orange-tinted. `npm run check` + `npm run build:web` green; no console errors.
- **Old-skin purge (v3b)**: a global sweep replaced every remaining legacy accent — teal `#36cfc9`/`rgba(54,207,201,…)` → orange `#ff8a3d`, blue active indicators `#7db7ff`/`#8bbdff` → orange, and the red Send button / run-tab underline / sidebar indicator → orange. Status colors restored to the prototype's semantics (running/completed = green `#4ade80`, awaiting = amber, failed = red `#ff6b6b`); event chips re-balanced so text matches its chip background; legacy 22px radii normalized to 10px. Final scan: 0 teal, 0 blue-indicator references; the only remaining red is intentional danger/error/status usage.

### Phase 1d — Product polish pass (2026-08-12) — ✅ implemented
A codex/opencode-grade polish pass on top of the palette work:
- **Emoji → inline SVG icon set** (`components/icons.tsx`, 20+ icons). Every UI emoji was replaced with crisp stroke icons: status strip (🌙/🔕 → Moon/Sun/Bell), run header (⊞/■/⋮ → Expand/Collapse/X/More), run menu (🔍/✔/⟲ → Search/Check/Refresh, plus FileText/Undo), composer (+) / sidebar (✎/＋ → Plus/Folder), header actions (search/inspector), compare panel (⚖/✓/✕ → Scale/Check/X), plan card (📋/✓ → List/Check), approvals (🔧 → Wrench), mention picker (📁/📄 → Folder/FileText), workspace files (📁/📄 → Folder/FileText), session rail (⌂/▾/… → Home/ChevronDown/More), orchestration roles (📋🔬👁✅🟢 → text labels).
- **Tool-step card system built from scratch** — the transcript's step cards previously had *no CSS at all*. Now: navy card with 10px radius and border, header row (rotating chevron SVG, orange wrench, mono tool name, ellipsized input summary, status pill with colored dot: green=completed / amber=running / red=failed / gray=requested+denied), collapsible body (input/output pre blocks) with hover states and a 140ms entrance animation (respects `prefers-reduced-motion`).
- **Typography**: the body font stack declared `Sora` which was never loaded — replaced with a clean system stack (`ui-sans-serif, -apple-system, Segoe UI, IBM Plex Sans, Roboto`).
- **Interaction polish**: global orange `:focus-visible` ring; 120ms transitions on buttons/inputs/selects; icon alignment (inline-flex + gap) on every toolbar/menu/composer control; thread-tab and session-item hover states; header icon buttons tint orange on hover/active.
- **Bug fixed**: `PlusIcon` was used in `App.tsx` but never imported (the root `tsc --noEmit` doesn't cover `apps/web/src`, so it slipped through and crashed the app at runtime — now imported).
- Verified live: app mounts clean, no console errors, tool-step cards render the navy card system with working expand/collapse (both per-card and Expand-all), and a source scan finds zero emoji glyphs remaining in the UI components.

### Phase 1e — Left-rail polish (2026-08-12) — ✅ implemented
- **Brand block**: replaced the plain `QWEMINI` text with the app mark + letterspaced wordmark; the pin/settings button was still wearing the old red skin (`rgba(70,22,24,0.32)` bg, `#f08a8a` icon) — now navy with an orange active state.
- **Add-folder button**: was a bare text row (transparent, `border: none`, radius 0, plus a legacy `#` pseudo-element glyph). Now a proper secondary button — navy surface, bordered, 10px radius — and both sidebar buttons got width:100% + left-aligned icons; the legacy `/` and `#` `::before` glyphs are gone.
- **Section header**: now shows a count chip (`Threads · 2`) alongside the label; Setup/Back action unchanged.
- **Filter row**: added an inline search icon inside the filter input (input now pads left 30px to clear it).
- **Bottom nav**: the other-view switcher rows (Runs / Archived / Agents) now carry per-view icons (list/archive/workflow/home) that tint orange on hover, with a subtle row hover background.
- **Session setup submit**: the compact dock's Create Session button had a broken contrast bug (near-black text on a near-transparent `rgba(255,255,255,0.06)` background from a legacy `!important` rule) — restored to solid orange.
- **Light theme**: dedicated overrides for the pin, Add-folder, and section-count chips so the white-transparency surfaces stay legible on the light background.
- Verified live in both themes: brand mark + wordmark render, count chip shows, search icon present, nav icons tint on hover, active session row solid `#1f2a36` with orange inset bar while inactive rows keep the navy gradient, Create Session button orange with dark text, session setup opens/closes via the pin, zero console errors.

### Phase 1f — Right-rail (inspector) polish (2026-08-12) — ✅ implemented
The right rail still wore the old panes skin — flat divider-row lists, near-black `#151515` header, a CSS-glyph collapse button — and two surfaces had no styling at all. This pass rebuilt it:
- **TabBar icon support**: added an optional `icon` to tab items; the utility tabs (Pending / Activity / Files / Artifacts / Context) now carry Scale / Wrench / Folder / FileText / Brain icons. Active tab is an orange-tinted pill (`rgba(255,138,61,0.12)` bg, orange border + text, 999px radius); inactive tabs muted with hover.
- **Inspector header**: was `Context` on near-black `rgb(21,21,21)` — now `Inspector` with an orange brain icon, provider chip (capitalized provider name), and mono session-id note on the navy `#121920` panel; the CSS-drawn collapse glyph is now a real `PanelRightIcon` SVG that tints orange on hover.
- **Cards, not dividers**: killed the legacy flat-list override (`border-radius: 0; background: transparent; border: none; border-bottom: divider`) — approvals, artifacts, tool activity, evidence, and checkpoint cards are now proper navy `#18212b` cards with 10px radius, navy borders, hover border highlight, and 0.7rem spacing. Preview/body blocks switched from `#111111`/`#0b0b0b` to navy `rgba(8,13,18,0.5)` with 8px radius.
- **Session context card** (checkpoints view): had zero styles — now a navy card with label/value rows (Provider, Mode, Session, Workspace, Context), mono values, divider lines, orange-free muted labels.
- **Empty states**: the `Waiting for activity` states are now centered dashed-border cards (10px radius, 22px padding) with a clear title + muted message.
- **Collapsed mini-stack**: pill buttons polished (10px radius, navy border, hover state); section headings and the tool-plane subsection title switched to the muted palette.
- **Light theme**: overrides for the header, tab bar, cards, context card, and empty states (`#f7f9fb` header/tabs, white cards).
- Verified live in both themes: navy `#121920` header with SVG brain + panel icon, all five tabs iconized with orange active pill, context card renders its rows, empty states render as dashed cards, collapse/expand round-trips through the mini stack, Files panel shows 21 rows with SVG icons, zero console errors.

### Phase 2 — Context + plan + undo (small daemon additions) — ✅ implemented (2026-08-11)
- Context meter: daemon computes `contextChars` on `RunSnapshot` (sum of event payload sizes); shell prefers it, falls back to local estimate. No schema break.
- Plan mode: `RunMode` (`execute` | `plan`) on `WorkbenchRun` + `StartRunRequest.mode`; daemon approval gate auto-denies tools during plan runs (read-only); `plan` artifact kind captured from the final assistant message on completion; shell renders a **Plan card** with an **Approve & execute** button that re-runs the plan text as an execute-mode run.
- Git-backed undo: `pre_run_commit` captured at run start; `POST /api/runs/:id/undo` reverts tracked changes via `git reset --hard`; `run.undo` event; Undo button in the run toolbar (enabled only for terminal runs in git repos). **Caveat:** undo reverts tracked workspace changes to the pre-run commit — test in a scratch repo, never in a repo with uncommitted work you care about.
- Attention notifications: browser Notification API on `approval.requested` / `run.completed` / `run.failed` (only when the tab is hidden); 🔔/🔕 toggle in the status strip.

### Phase 3 — Rich input + orchestration surfaces — ✅ implemented (2026-08-11)
- `@`-mention context picker (`MentionPicker.tsx`) with fuzzy search over `GET /api/workspace/entries`; inserts `@<relativePath>` into the prompt; `@`-token regex detected in the composer.
- Orchestration swimlanes (`OrchestrationSwimlanes.tsx`): the orchestration board renders as a horizontal route → delegate → review → verify flow instead of a list (replaces the board view in the right rail).
- Compare surface: daemon `POST /api/runs/compare` starts the same prompt on two providers (two sessions) and returns both run snapshots; `ComparePanel.tsx` streams both transcripts side by side; ⚖ Compare button next to Send. Also hardened `startRun` to convert non-Error throws (e.g. gemini ACP SDK) into proper error messages.
- Themes: `data-theme` attribute + light-theme CSS variable overrides; 🌙/☀️ toggle in the status strip, persisted in localStorage.
- *(Custom keybinds deferred — keymap exists via QuickOpen; per-user rebinding is a follow-up.)*
- **Validation:** `npm run build:web`, `npm run check`, live smoke: compare endpoint created two lanes (opencode ran, qwen failed cleanly on the known-flaky bootstrap), @-mention picker filtered and inserted `@apps`, theme flipped light/dark and persisted across reload.

---

## 9. Success criteria

The redesign is done when a fresh user can, without reading docs:

1. Open the app, type a prompt, and get an answer — no setup form first.
2. Tell at a glance *what mode they're in*, *what the agent is doing*, and *what needs their decision*.
3. Approve/deny a tool from the transcript without switching views, and understand the risk before deciding.
4. See exactly what a run changed (tool cards, diffs, artifacts) and undo it if needed.
5. Switch provider per thread and know why they might (capability notes, free-model hints).
6. Do everything in #1–#5 with the keyboard.

And the architecture rules hold: UI ↔ daemon only, no provider-specific branches, no schema breaks in Phase 1, every meaningful action still emits a normalized event.

---

## 10. Massive frontend refactor (2026-08-12) — ✅ implemented

The shell had been built up as incremental patches: the v1 panes layout, three stacked "donor-alignment" override skins, and six polish passes on top — `App.tsx` reached 2,344 lines and `styles.css` 8,854 lines with dozens of legacy `!important` rules fighting each other. This pass replaced the frontend architecture, not the visuals:

**Componentized shell** — `App.tsx` is now a thin orchestrator (971 lines): it owns the state subscriptions, derived slices, global keyboard shortcuts, and composition. Every UI region moved into a focused component under `apps/web/src/components/shell/`:

| Component | Owns |
|---|---|
| `StatusStrip.tsx` | brand · daemon · workspace · provider · mode · phase · theme · bell |
| `Sidebar.tsx` | brand block, New thread / Add folder, session setup dock, rail filter, the four rail views, bottom nav |
| `ThreadTabs.tsx` | open-thread tab strip + new-thread trigger |
| `ConversationHeader.tsx` | breadcrumbs, phase chip, quick-open + rail toggles |
| `RunToolbar.tsx` | run meta row, Expand/Cancel, ⋮ run menu, compact toggle |
| `RunSurface.tsx` | Thread/Events tabs, transcript + timeline, empty/onboarding state |
| `Composer.tsx` | mention picker, provider/mode menus, context meter, send actions |
| `HintBar.tsx` | keyboard-shortcut hint bar |
| `Inspector.tsx` | right-rail header, utility tabs, all five panels, mini-stack |

**Shared shell helpers** — `lib/shell-format.tsx` centralizes the label/icon/parse helpers (`renderProviderLabel`, `renderAccessLabel`, `MODE_DESCRIPTIONS`, `getRailSectionLabel`, `railViewIcon`, parse fns) so they're no longer trapped inside the App monolith. Components import controller request functions directly from `app-controller` (they're global singletons), so only state slices + small UI callbacks are prop-drilled — no 40-prop god-components.

**Verified end-to-end live**: every region renders, session selection, run tabs (Thread/Events), utility tab switching (Files shows 21 rows), mention picker opens/filters/dismisses, Compare panel opens/closes, QuickOpen opens with 21 items, rail collapse/restore round-trips, composer Clear works, zero console errors. `npm run check` ✅, web `tsc` clean for `App.tsx` + `shell/*` (remaining errors are pre-existing test-file typing), build ✅, daemon serves the exact built bundle at `http://127.0.0.1:4120`.

**Outstanding (documented debt):** `styles.css` is still the accumulated 8,854-line stack — the visual result is correct (the polish passes won every cascade fight), but the stylesheet itself is the next consolidation target: one token-first design system replacing the legacy layers.

---

## 11. Phase 1 + 6 landed: design system & ui-kit (`@qwemini/ui-kit`)

The research plan's foundation phases shipped: a real design-token system and a shared component library package.

**`packages/ui-kit/`** — new workspace package (`file:` linked, `exports` → `./src/index.ts` + `./tokens.css`):

- **Tokens** (`src/tokens/`): semantic color palette (GitHub-dark family: `--surface-0..3`, ink hierarchy, status colors, diff colors, borders), typography scale + `--font-sans`/`--font-mono`, 4px spacing scale, reduced radius scale (`4/8/12/16px` — the playful 22px is gone), shadow elevation, motion durations. Dark + light (`html[data-theme='light']`).
- **Provider-aware accent** — the biggest new behavior: `--accent-active` is driven by `[data-accent='qwen'|'gemini'|'opencode']` on `<html>` (amber `#ff8a3d` / blue `#4285f4` / emerald `#10b981`). `App.tsx` sets the attribute from the active provider; `styles.css` now routes `--accent`/`--signal` (and every former hardcoded `#ff8a3d` usage) through `var(--accent-active)`. Switch sessions and the whole app recolors per provider — verified live (OpenCode session → emerald tabs/chips).
- **Components** (`src/components/`, CSS modules): `Badge` (7 tones), `Spinner`, `ContextMeter` (token bar w/ warn/critical tiers), `ToolCard` (icon + name header, caret, status dot/spinner + duration, collapsible input/output body), `ThinkingBlock` (collapsible italic thinking, streaming label), `DiffCard` (unified-diff parser → green/red/hunk lines, +N/−N stats, "show more"), `ApprovalCard` (amber glow pulse on pending, approve/deny, kbd hint).

**Wired into the app:**

- `Composer` context meter → ui-kit `ContextMeter`
- `StatusStrip` → ui-kit `ContextMeter` (right side) + accent `Badge` for the mode chip; new `contextUsagePercent` prop
- `InlineApprovalCards` → rewritten on ui-kit `ApprovalCard`
- `StepTimeline` → tool steps render as `ToolCard` (diff-shaped output becomes inline `DiffCard`), thinking steps as `ThinkingBlock`; old custom card CSS retained as dead fallback
- `main.tsx` imports `@qwemini/ui-kit/tokens.css` before `styles.css`; `apps/web/package.json` depends on the package

**Verified:** root `npm run check` ✅, web `tsc` clean for all changed sources (157 remaining errors are pre-existing test-file typing, unchanged), `npm run build:web` ✅ (CSS modules + tokens bundled), daemon serves the exact built bundle at `http://127.0.0.1:4120`. Live: status strip shows `… · Ask first (accent badge) · Idle · ctx N%`; OpenCode session renders a `read` ToolCard (`Success · 48ms`, expandable input/output); light theme flips tokens correctly; zero console errors. (`check:shell`'s one failure is pre-existing — the run-mode payload fields added in earlier uncommitted phase work, unrelated to this UI pass.)

**Remaining from the plan:** the full Phase 6 stylesheet consolidation (styles.css still holds legacy layers beneath the token layer — the token system is now the source of truth for colors/radius/fonts), plus Phase 4 extras (per-chunk accept/reject in DiffCard, approval "always allow"), Phase 5 keyboard hook (`useKeyboardShortcuts`), and the `NavigationRail`/`AuxiliaryDock` renames.
