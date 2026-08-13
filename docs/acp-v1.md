# CodeWave ACP v1 runtime contract

CodeWave acts as an ACP client. ACP agents remain untrusted provider processes behind the daemon-owned `ProviderAdapter` boundary; they never own CodeWave sessions, approvals, normalized events, or terminal state.

## Version boundary

- Production imports only `@agentclientprotocol/sdk` version `1.3.0` from its stable package root.
- The accepted ACP wire version is exactly `1`.
- Experimental ACP v2 is a separate future runtime, not an alias or fallback. Its terminal, replay, tool, and message semantics must not be mixed into this state machine.

## Initialization

The client sends protocol v1, CodeWave implementation metadata, and no enabled client filesystem, terminal, elicitation, or configuration capabilities. The SDK may serialize unsupported capabilities as explicit `false` values; CodeWave never advertises handlers it does not implement.

Initialization is bounded to five seconds by default. A timeout, malformed stream, oversized record, process exit, or any selected protocol other than v1 closes the connection, terminates the child, and fails setup. Agent identity, capabilities, and authentication methods are self-reported diagnostics; initialization alone does not prove credentials are configured.

## Session continuity

For a new CodeWave session, the runtime calls `session/new` with one absolute existing workspace and an empty MCP list, validates the returned provider session ID, and persists it before prompting.

For an existing provider session:

1. use stable `session/resume` only when the agent advertises resume;
2. otherwise use `session/load` only when the agent advertises load;
3. otherwise fail closed and ask the user to start a new CodeWave session.

Load notifications are consumed in protocol order while replay capture is disabled. The load response is the replay boundary; CodeWave does not use a quiet-time timer and does not re-emit historical assistant or tool entries into the current run.

Normal run completion closes the connection/process but does not call `session/close`, because the provider session is intended for a later run.

## Messages, tools, and permissions

Assistant chunks are assembled by ACP message ID in first-seen message order. Tool updates are keyed by tool-call ID, merge omitted fields, and emit at most one normalized terminal outcome.

Permission requests must match the active provider session. CodeWave maps an approval to `allow_once` before `allow_always`, and denial to `reject_once` before `reject_always`. If the agent offers no semantically matching option, CodeWave returns `cancelled` instead of selecting a different permission.

Run cancellation fences new approvals, resolves pending provider permission promises as cancellation, sends `session/cancel`, accepts bounded late updates, and waits briefly for the ACP cancelled stop reason. The daemon's atomic terminal write remains the final exactly-once fence.

## Transport and cleanup

- stdout JSON records are limited to 1 MiB before decoding;
- malformed JSON-RPC and stream errors fail the active non-terminal run;
- zero or non-zero exit before the prompt response is failure;
- prompt success, cancellation, connection failure, and process close race through one terminal publisher;
- success, failure, setup rejection, timeout, and cancellation all close the ACP connection and terminate the child.

The built-in OpenCode and Gemini ACP paths use this runtime today. A profile-driven generic adapter and dynamic `acp.*` registry are a subsequent layer; this document does not claim that arbitrary ACP profiles are configurable yet.

## Executable evidence

`npm run check:acp` exercises the stable runtime with a deterministic app-style ACP fixture and a real daemon cancellation path. `npm run check:transport` retains Gemini/OpenCode normalization parity. Both must pass before changing ACP lifecycle behavior.
