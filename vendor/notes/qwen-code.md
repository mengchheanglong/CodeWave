# Qwen Code Vendoring Scout

Date: 2026-04-02

## Inspected upstream

- Repo: `https://github.com/QwenLM/qwen-code`
- Inspected commit: `92f7549bdc684f264ae09dc4a6f8e7398363f53e`
- Validation method: `git ls-remote` plus a shallow local clone and direct file inspection

## Purpose

Pin the smallest realistic upstream donor closure for moving CodeWave's Qwen runtime from an external CLI dependency toward bounded in-repo reuse.

This note is a scout only. CodeWave does not vendor these files yet.

## Confirmed non-interactive donor entrypoints

- `packages/cli/src/nonInteractive/session.ts`
- `packages/cli/src/nonInteractive/types.ts`
- `packages/cli/src/nonInteractive/io/StreamJsonInputReader.ts`
- `packages/cli/src/nonInteractive/io/StreamJsonOutputAdapter.ts`
- `packages/cli/src/nonInteractive/control/ControlContext.ts`
- `packages/cli/src/nonInteractive/control/ControlDispatcher.ts`
- `packages/cli/src/nonInteractive/control/ControlService.ts`
- `packages/cli/src/nonInteractive/control/controllers/permissionController.ts`
- `packages/cli/src/nonInteractive/control/controllers/systemController.ts`
- `packages/cli/src/nonInteractive/control/controllers/sdkMcpController.ts`

## Confirmed supporting closure

These are part of the current dependency fan-out for the donor path above and should be treated as the first realistic support set for a bounded import:

- `packages/cli/src/nonInteractiveCli.ts`
- `packages/core/src/core/nonInteractiveToolExecutor.ts`
- `packages/core/src/tools/sdk-control-client-transport.ts`
- `packages/core/src/tools/tool-registry.ts`
- `packages/core/src/tools/tool-names.ts`
- `packages/core/src/confirmation-bus/message-bus.ts`
- `packages/core/src/config/config.ts`

## Why the closure is larger than the earlier assumption

- `session.ts` no longer stands alone; it currently depends on `runNonInteractive`, stream-json IO helpers, control services, and core config.
- Approval behavior is not just a transport concern; `permissionController.ts` contains the current `can_use_tool` decision path.
- The control plane reaches into tool and MCP-facing runtime code through `sdk-control-client-transport.ts` and the tool registry.

## Recommended first vendoring cut

Vendor only the non-interactive Qwen runtime/control slice under `vendor/qwen-code/`, pinned to the commit above.

Do not vendor:

- terminal UI flows
- unrelated package surfaces
- the full monorepo build graph
- provider-agnostic CodeWave state, protocol, or daemon code

## Risks

- upstream path drift: the current donor layout already differs from earlier notes, so file-level pinning matters
- dependency fan-out: the control path can pull more of Qwen core than expected if imports are followed loosely
- build coupling: vendoring TypeScript sources without a bounded build plan will slow future upgrades
- hidden provider ownership: if CodeWave imports too much runtime policy directly, daemon-owned approvals will become harder to preserve

## Recommendation

- keep the external `qwen` binary as the live runtime today
- keep CodeWave's top-level daemon/session/state boundary unchanged
- use this pinned file set as the starting scope for the next actual vendoring slice
- prefer a thin CodeWave-owned adapter around a bounded vendored runtime instead of a repo-wide fork

## Imported into CodeWave so far

These files are now vendored in-repo and consumed by the Qwen provider:

- `vendor/qwen-code/packages/cli/src/nonInteractive/types.ts`
- `vendor/qwen-code/packages/cli/src/nonInteractive/io/StreamJsonInputReader.ts`
- `vendor/qwen-code/packages/cli/src/nonInteractive/io/StreamJsonOutputAdapter.ts`
- `vendor/qwen-code/packages/cli/src/nonInteractive/control/ControlContext.ts`
- `vendor/qwen-code/packages/cli/src/nonInteractive/control/ControlDispatcher.ts`

Current adaptation boundary:

- keep the upstream file paths so donor provenance stays concrete
- trim or localize `qwen-code-core` type dependencies so the vendored slice compiles inside CodeWave
- use the vendored stream-json contract, parse helper, output writer, control context, and control dispatcher shape for provider I/O, while still running the external Qwen CLI binary today
