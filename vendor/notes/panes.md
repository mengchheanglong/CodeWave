# Panes Frontend Donor Scout

Date: 2026-04-03

## Inspected upstream

- Repo: `https://github.com/wygoralves/panes`
- Inspected commit: `58adc78f50ece0fc0ed827cf3a96fdbe4615f095`
- Validation method: `git ls-remote` plus a shallow local clone and direct file inspection

## Purpose

Pin the concrete frontend-oriented donor paths from Panes that are actually useful to CodeWave without dragging CodeWave into a React/Tauri rewrite.

This note is a scout only. CodeWave does not vendor these files.

## Confirmed frontend stack

- React 19 + Vite
- Zustand stores
- Tailwind 4 plus global design-token CSS
- Tauri desktop shell
- `react-resizable-panels`
- worker-backed markdown parsing

This makes Panes a strong UX reference, but not a direct code donor for the current CodeWave shell.

## Concrete upstream files inspected

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

## What is actually useful to CodeWave

### High-value pattern donors

- `src/lib/commandPalette.ts`
  - small, portable query-mode parsing and scoped search behavior
  - useful if CodeWave adds a command palette to the current shell
- `src/stores/toastStore.ts`
  - simple queued toast model with bounded list and severity-aware durations
  - useful as the behavioral model for replacing the current single-message notice pattern
- `src/components/chat/MarkdownContent.tsx`
  - strong pattern for markdown caching, worker offload, and local-link interception
  - useful if CodeWave upgrades transcript rendering beyond plain text
- `src/globals.css`
  - useful as a visual/token reference for panel spacing, resize affordances, and denser agent-workspace styling
- `src/components/layout/ThreeColumnLayout.tsx`
  - useful as a reference for persisted pane sizing and multi-panel composition

### Medium-value pattern donors

- `src/components/chat/MessageBlocks.tsx`
  - useful for block grouping ideas around actions, diffs, and approvals
  - too coupled to Panes content-block model for direct import
- `src/components/shared/ToastContainer.tsx`
  - useful as a presentational reference if CodeWave adds queued notifications

### Low-value or wrong-shape donors

- `src/App.tsx`
  - too tied to Panes app startup, Tauri runtime, and Zustand store tree
- `src/components/chat/ChatPanel.tsx`
  - too large and too Codex/Claude/thread-centric
- `src/stores/threadStore.ts`
  - useful only as a state-boundary reference, not as reusable code

## Recommended CodeWave action

### Reference only

- `src/App.tsx`
- `src/components/chat/ChatPanel.tsx`
- `src/components/chat/MessageBlocks.tsx`
- `src/components/layout/ThreeColumnLayout.tsx`
- `src/globals.css`

### Adapt manually

- `src/lib/commandPalette.ts`
- `src/stores/toastStore.ts`
- `src/components/chat/MarkdownContent.tsx`
- small presentational ideas from `src/components/shared/ToastContainer.tsx`

### Do not vendor directly

- the React component tree
- the Zustand store tree
- the Tauri IPC/runtime boundary
- terminal, git, and workspace management components

## Why Panes should not become the frontend base

- CodeWave's current shell is a daemon-served web app, not a Tauri desktop renderer
- Panes is organized around workspaces, threads, terminals, and editor tabs, while CodeWave is currently organized around sessions, runs, approvals, artifacts, and tool-plane inspection
- direct reuse would create a mixed frontend architecture before CodeWave has chosen to migrate frontend stacks

## Best extraction order if CodeWave uses Panes ideas

1. Add a queue-based toast system inspired by `src/stores/toastStore.ts`.
2. Add command-palette parsing and scoped search behavior inspired by `src/lib/commandPalette.ts`.
3. Upgrade transcript rendering using the caching/worker strategy from `src/components/chat/MarkdownContent.tsx`.
4. Revisit pane resizing and denser workspace styling using `src/globals.css` and `src/components/layout/ThreeColumnLayout.tsx` as reference only.

## Risks

- importing code directly would pull in React/Tauri/Zustand dependencies that do not match the current shell
- adopting Panes layout wholesale would distract from finishing the current daemon-centered v1
- transplanting thread-centric models into CodeWave would blur the current session/run boundary
