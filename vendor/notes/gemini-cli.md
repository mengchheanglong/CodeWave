# Gemini CLI Donor Scout

Date: 2026-04-02

## Inspected upstream

- Repo: `https://github.com/google-gemini/gemini-cli`
- Inspected commit: `44c8b43328df432a6e5925a7762be4d6d91fca0f`
- Validation method: `git ls-remote` plus a sparse local clone and direct file inspection

## Purpose

Pin the concrete Gemini CLI seams that matter if CodeWave wants to move beyond a formatter-only subprocess bridge and eventually support daemon-owned approval mediation.

This note is a scout only. CodeWave does not vendor these files yet.

## Confirmed formatter path used by the current CodeWave adapter

- `packages/cli/src/nonInteractiveCli.ts`
- `packages/core/src/output/types.ts`
- `packages/core/src/output/stream-json-formatter.ts`

These files confirm that Gemini's current `--output-format stream-json` surface is primarily an output formatter. It emits `init`, `message`, `tool_use`, `tool_result`, and `result`, which is enough for transcript and tool visibility but not enough for a host-owned approval loop.

## Confirmed deeper approval and daemon-bridge candidates

- `packages/cli/src/acp/acpClient.ts`
- `packages/core/src/confirmation-bus/message-bus.ts`
- `packages/core/src/agent/types.ts`
- `packages/core/src/agent/agent-session.ts`
- `packages/cli/src/acp/commandHandler.ts`

These files show the stronger donor seam:

- `acpClient.ts` shows that Gemini CLI already exposes a stdio ACP server (`--acp`) and routes permission requests through `requestPermission(...)`.
- `message-bus.ts` owns tool confirmation routing against policy decisions.
- `agent/types.ts` defines a richer event protocol with `tool_request`, `tool_response`, `elicitation_request`, and `agent_start` / `agent_end`.
- `agent-session.ts` wraps that protocol into a replayable stream abstraction.
- `acp/commandHandler.ts` confirms there is already a CLI-side command/agent control path beyond plain stream-json output.

## Current conclusion

- The plain non-interactive `stream-json` path is suitable for the current Gemini adapter and for normalized transcript/tool observation.
- It is not the right donor seam for daemon-owned approvals.
- If CodeWave wants Gemini approvals to become daemon-owned, the likely bounded donor path is the agent protocol / ACP / confirmation-bus stack, not one more formatter import.
- The installed Gemini CLI on this machine already advertises `--acp`, so CodeWave can bridge the existing ACP server before considering any Gemini source vendoring.
- The ACP bridge is now proven for simple prompt turns, daemon-owned approval requests, and Windows shell-command runs through a CodeWave-owned preload patch at `packages/providers/gemini/runtime/win32-node-pty-preload.cjs`.
- That preload patch wraps Gemini CLI's bundled `@lydell/node-pty` Windows modules so `conpty_console_list_agent` falls back instead of crashing and late PTY resizes become no-ops instead of fatal errors.

## Recommended next cut if Gemini approvals become near-term priority

Inspect and pin the smallest closure around:

- `packages/core/src/confirmation-bus/`
- `packages/core/src/agent/`
- `packages/cli/src/acp/`

Do not start by vendoring more formatter files. That would increase protocol drift without moving approval control into the CodeWave daemon.

## Risks

- approval logic is deeper than the current stream-json surface, so a shallow wrapper will keep provider-owned policy hidden
- ACP and agent protocol paths are broader than the current adapter, so the dependency fan-out may be materially larger than the Qwen stream-json/control import
- Gemini's current CLI surface can still evolve quickly, which makes file-level pinning important before any vendoring step
- Gemini ACP resume/load behavior still replays historical output into the next run because Gemini's `loadSession` path streams history asynchronously

## Recommendation

- keep the current Gemini subprocess adapter shape, but prefer ACP as the default path in CodeWave
- keep `stream-json` as an explicit fallback mode rather than the primary path
- prefer an ACP client bridge over formatter vendoring when enabling Gemini daemon-owned approvals
- only start Gemini source vendoring from the agent/confirmation seam if the ACP bridge proves insufficient
