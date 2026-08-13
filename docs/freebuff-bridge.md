# Freebuff automation bridge contract v1

CodeWave does not scrape or automate Freebuff's interactive TUI. A configured `CODEWAVE_FREEBUFF_COMMAND` is treated as a separate automation bridge and must prove this contract before it is marked ready or launched.

## Qualification

CodeWave performs two bounded probes:

1. `COMMAND --version` must exit successfully.
2. `COMMAND --codewave-bridge-info` must exit successfully and emit exactly one JSON descriptor:

```json
{"name":"codewave-freebuff-bridge","protocolVersion":1}
```

Each probe has a five-second timeout and a 64 KiB aggregate output ceiling. A raw CLI, version-only command, malformed descriptor, unsupported version, timeout, or oversized response is setup-required—not automation-ready.

## Run lifecycle

CodeWave launches a qualified bridge with:

```text
--cwd <absolute workspace> --prompt <prompt> --output-format jsonl
```

When provider session metadata exists, it also supplies `--resume <providerSessionId>`. Capability flags still declare Freebuff recovery unsupported in v1; the argument is reserved for compatible bridges and is not proof of resumability.

Stdout is newline-delimited JSON. The first record must be:

```json
{"type":"bridge.hello","protocolVersion":1}
```

Later records may be `capabilities`, `session`, `output`, `message`, `tool`, `checkpoint`, `steering`, or `result`. Unknown/plain records are diagnostic output only after the hello. Individual lines use the shared 1 MiB ceiling and aggregate transcript output is capped at 4 MiB.

A run terminates only through an explicit result:

```json
{"type":"result","status":"completed","result":"Done"}
```

Valid statuses are `completed`, `failed`, and `cancelled`. Clean EOF without a valid result fails; it never fabricates an assistant answer or successful run. A result-only bridge receives one normalized assistant message before completion.

## In-flight steering

A bridge may announce:

```json
{"type":"capabilities","protocolVersion":1,"inFlightSteering":true}
```

CodeWave can then send newline-delimited `steer` commands on stdin. The bridge must answer with the same `steeringId` and an `accepted` or `rejected` status. Missing negotiation, rejection, timeout, process close, or a terminal race leaves the already-persisted input on CodeWave's durable follow-up path.

## Security posture

- The bridge runs with the user's local privileges inside the selected workspace.
- The command is configuration, not a credential store; secrets belong in provider-owned authentication or the environment.
- `bridge.hello` is capability qualification, not identity or sandboxing.
- Tool approvals are not yet mediated through this bridge contract. Bridges that can write or execute commands therefore remain manual-policy integrations until an ID-correlated approval extension is specified and tested.
