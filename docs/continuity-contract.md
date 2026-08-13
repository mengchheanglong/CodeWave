# CodeWave Continuity Contract

**Contract ID:** `codewave-continuity-v1`

**Scope:** one local CodeWave daemon, its SQLite ledger, qualified provider fixtures, and synthetic workspaces
**Status:** normative acceptance target; prose alone is not conformance evidence

## Purpose

CodeWave is a local control plane for coding agents. One foundation of that product is ensuring that a retry, race, restart, or stale client cannot quietly create a second truth. This contract turns that trust requirement into deterministic, product-specific acceptance criteria; it does not replace the wider provider, worktree, review, desktop, or product roadmap.

The contract is a clean-room adaptation of failure-testing ideas inspected in a parked private research repository. CodeWave does not import that repository, its implementation, its fixtures, its domain model, or its infrastructure. This document makes no statement about the other repository's license or production status and does not turn its historical results into CodeWave results.

The executable gate is:

```text
npm run check:continuity
  -> scripts/validate-continuity.mjs
  -> .codewave/qa/continuity-dogfood-2026-08-13/backend/validated-post-fix.json
```

The report is generated under the ignored `.codewave/` QA tree; it is local run evidence, not a checked-in attestation. It is authoritative for a run only when the validator produced it, it identifies the current CodeWave commit or dirty-tree fingerprint, records the contract ID, contains every required vector and supporting assertion, and reports `passed`. Its mere presence, a green unit test, a successful daemon start, or this document by itself is not proof of continuity conformance.

## Canonical boundary

For this contract, **canonical CodeWave state** is the daemon-owned operational ledger in `packages/state`, persisted in one SQLite database with WAL journaling. It includes sessions, runs, normalized events, transcript lineage, approvals, checkpoints, tool invocations, session tool registrations, mutation receipts, and steering inputs.

The boundary is intentionally local-first:

- the UI, MCP adapters, and automation clients mutate state only through daemon APIs;
- provider adapters translate provider records but do not own global CodeWave state;
- SQLite remains the production persistence path for the desktop product;
- the conformance gate uses isolated temporary databases and synthetic workspaces;
- Restate, PostgreSQL, DBOS, Docker, or another durable runtime are not CodeWave runtime dependencies;
- the operating-system user, SQLite file owner, provider service, Git remote, and external MCP servers remain outside the authority proved by this contract.

Provider processes and workspace/Git effects are external consequences. A SQLite transaction cannot make those effects exactly once. CodeWave may claim only the narrower behavior a vector proves: durable intent before launch, a correlated launch acknowledgement where available, safe reconciliation, and no unobserved automatic re-execution after an indeterminate boundary.

## Contract vocabulary

| Term | CodeWave meaning |
|---|---|
| **Mutation** | A daemon API request that may change the ledger, provider policy, workspace, provider execution, approval, or steering state. |
| **Authority snapshot** | The negotiated client protocol and exact route scopes, reviewed provider-policy revision, workspace/session/run target, and any expected-run fence used by a mutation. |
| **Semantic request** | Method, normalized route/query, declared request schema/version, and canonical JSON body; connection IDs, receipt timestamps, logs, and transport diagnostics are excluded. |
| **Receipt** | The durable idempotency record binding one key to one semantic-request hash and one classified outcome. |
| **Canonical position** | A stable ledger position such as run status, event sequence, transcript sequence/parent, receipt outcome, or steering state. |
| **External consequence** | Provider launch/delivery, filesystem write, shell command, network request, Git operation, notification, or other effect outside the SQLite transaction. |
| **Reconciliation** | Deterministic classification of a persisted but interrupted mutation without pretending an unknown external outcome is success or retryable failure. |
| **Minimal audit projection** | Content-limited provenance needed to explain authority, causation, outcome, and versions without duplicating prompt, tool, artifact, or provider payload bytes. |

## Ten invariants

Each invariant is mandatory. The vector references below name the six families in the next section; supporting assertions are part of the gate and cannot be waived because the headline vectors pass.

### I1. Scoped stable identifiers

Workspace, session, run, event, transcript message, approval, checkpoint, tool invocation, steering input, and mutation-receipt identifiers are stable within their declared scope. Display titles, provider names, commands, credentials, and client connections are separate mutable attributes. The same child identifier in another workspace or session must not alias the first object.

**Evidence:** CW-CV1 scope-negative cases; CW-CV2 receipt-key namespace cases; CW-CV5 reconstruction manifest; cross-workspace and cross-session collision assertions in the machine report.

### I2. One canonical run truth

A session has at most one non-terminal run. One run cannot occupy conflicting terminal states, receive two terminal events, or move from terminal back to active. Concurrent starts from the same session must linearize to one accepted run and one explicit conflict; a hidden queue or provider-side serialization is not proof.

**Evidence:** CW-CV3 concurrent-start barrier; CW-CV4 restart classification; terminal-event uniqueness and monotonic-state supporting assertions.

### I3. Authorization and target scope

A client may read or mutate only routes granted by its live negotiated connection and only targets admitted by the route's workspace/session/run policy. A stale or restarted connection, missing scope, workspace escape, stale provider revision, or stale run fence fails closed before a canonical mutation or external consequence. If revocation and mutation race, the observed result must follow the transaction's documented linearization order.

**Evidence:** CW-CV1 under-scoped, expired/restarted, path-containment, provider-revision, and run-fence cases; zero-delta ledger and zero-launch counters.

### I4. One daemon-owned commit path

All accepted canonical changes pass through daemon validation and the state package's bounded transaction APIs. The web shell, provider adapter, plugin, and outbound MCP adapter cannot write SQLite directly. Related records that define one accepted fact—for example a run with its prompt transcript record, or a message event with its transcript record—commit atomically.

**Evidence:** CW-CV1 adapter negative cases; CW-CV4 kill-inside-transaction case; direct-store-import/static-boundary assertion; SQL before/after counts and foreign-key integrity check.

### I5. Minimum attributable history

CodeWave retains enough structured history to explain accepted and rejected decisions: target, actor/client class, causation/correlation ID, authority snapshot, provider/adapter identity and version, semantic-request hash/version, resulting canonical position, and machine-readable outcome. Content-bearing stores remain explicitly separate from the minimal audit projection. Retaining an audit fact must not require copying raw prompt, tool input/output, artifact content, provider diagnostics, or credentials into every record.

**Evidence:** CW-CV1 rejection records; CW-CV2 receipt provenance; CW-CV5 reconstruction manifest; CW-CV6 sentinel scan and minimal-projection reconstruction.

### I6. Atomicity, concurrency, and semantic idempotency

Invalid requests change nothing. A durable receipt is reserved before an external consequence. The same key and same semantic request replays one classified outcome; the same key with different meaning is rejected. Concurrent submissions, daemon restart, key reuse, malformed JSON, duplicate object keys, lone surrogates, unsupported values, and serializer-version changes must not create a second run or provider launch.

**Evidence:** CW-CV2 concurrent/restart/mismatch/canonicalization cases; CW-CV3 distinct-key race; CW-CV4 crash boundaries; receipt, run, launch, event, and transcript counts.

### I7. Recovery equivalence and honest uncertainty

After a supported restart, reconstruction yields the same canonical ledger state that would be visible at the corresponding durable boundary without the crash. `completed`, `failed`, `cancelled`, `reconciled`, `indeterminate`, recovery exhausted, and unsupported-version outcomes remain distinct. CodeWave never calls an unknown provider or filesystem outcome successful, and never automatically repeats it merely because the client did not receive an acknowledgement.

**Evidence:** CW-CV4 externally killed daemon cases; CW-CV5 pre/post-restart digest equality; no-late-launch observation window; explicit outcome-code assertions.

### I8. Causal traceability

Every accepted mutation can be followed from idempotency receipt to client class, target workspace/session/run, parent action or orchestration source, provider-policy revision, adapter/protocol version, normalized events, and final ledger position. Rejections have stable reason codes and request provenance but do not fabricate an accepted state-changing event.

**Evidence:** CW-CV1 rejection lineage; CW-CV2 receipt correlation; CW-CV4 recovery lineage; CW-CV5 manifest graph-integrity assertions.

### I9. Explicit time and external input

Semantic request time, daemon receipt time, event/provider time, run start/completion time, and test-control time are distinct fields. Wall-clock arrival, random IDs, provider/model output, health probes, filesystem observations, and network results are not silently treated as deterministic input. Reconstruction uses persisted normalized observations; it does not call a provider again to regenerate history.

**Evidence:** CW-CV2 semantic-hash exclusions; CW-CV4 restart with launch counter; CW-CV5 two-process materialization; timestamp-class and external-input inventory assertions.

### I10. Versioned authority and adapters

Protocol, client scope contract, provider policy, state schema, semantic-request schema, canonical serializer/hash, event schema, provider adapter, bridge/ACP protocol, and reconstruction projection versions are explicit. A material unsupported version fails closed. An adapter may expose an optional capability but cannot silently redefine global run, approval, tool, or terminal semantics.

**Evidence:** CW-CV1 protocol/provider-revision cases; CW-CV2 hash-schema cases; CW-CV5 unsupported-version matrix; CW-CV6 projection-schema assertion.

### Invariant acceptance matrix

The report must make the mapping inspectable rather than relying on prose. `vectors` supplies the behavioral evidence, while `supportingAssertions` contains one aggregate entry with the stable invariant ID shown below. An invariant passes only when all mapped vectors and its aggregate entry pass.

| Invariant | Required vectors | Authoritative report evidence |
|---|---|---|
| `CW-I1` scoped identifiers | CW-CV1, CW-CV2, CW-CV5 | matching vector `status`/`assertions`; `supportingAssertions[id="CW-I1"]` collision and scope checks |
| `CW-I2` one run truth | CW-CV3, CW-CV4 | matching vector `status`/`assertions`; `supportingAssertions[id="CW-I2"]` terminal uniqueness and monotonicity |
| `CW-I3` authorization/scope | CW-CV1 | CW-CV1 zero-delta/zero-launch assertions; `supportingAssertions[id="CW-I3"]` |
| `CW-I4` daemon commit path | CW-CV1, CW-CV4 | transaction rollback and boundary assertions; `supportingAssertions[id="CW-I4"]` |
| `CW-I5` minimum history | CW-CV1, CW-CV2, CW-CV5, CW-CV6 | rejection/receipt/projection assertions; `supportingAssertions[id="CW-I5"]` |
| `CW-I6` atomic idempotency | CW-CV2, CW-CV3, CW-CV4 | receipt/run/launch count assertions; `supportingAssertions[id="CW-I6"]` |
| `CW-I7` recovery equivalence | CW-CV4, CW-CV5 | recovery classification/digest/no-late-effect assertions; `supportingAssertions[id="CW-I7"]` |
| `CW-I8` causal traceability | CW-CV1, CW-CV2, CW-CV4, CW-CV5 | lineage graph assertions; `supportingAssertions[id="CW-I8"]` |
| `CW-I9` explicit inputs/time | CW-CV2, CW-CV4, CW-CV5 | hash-exclusion/restart/materialization assertions; `supportingAssertions[id="CW-I9"]` |
| `CW-I10` versioned authority | CW-CV1, CW-CV2, CW-CV5, CW-CV6 | unsupported-version assertions; `supportingAssertions[id="CW-I10"]` |

## Six conformance-vector families

The fixture values are CodeWave-owned and synthetic. Expected outcomes must be reviewed before implementation changes intended to make them pass. A failing expected outcome is fixed in product code or explicitly re-reviewed as a contract change; the harness is not weakened to fit current behavior.

### CW-CV1 — `authorization_scope`

Run each protected mutation against an isolated daemon using deterministic barriers.

1. A connection without the exact write scope attempts the mutation.
2. A connection from the previous daemon process attempts it after restart.
3. A workspace request attempts `..`, absolute-path, symlink/junction, or case-normalization escape.
4. A provider-policy update commits before a run/steering mutation carrying the prior revision.
5. A terminal/current-run change commits before steering carrying the prior expected run ID.
6. The inverse race lets the reviewed mutation commit first, then changes policy or run state.

**Pass condition:** each race has one documented linearization, stable 401/403/409 reason codes, no out-of-scope data, no unauthorized ledger delta, no provider launch, and no workspace mutation. A mutation that linearized first remains attributable to the authority it actually reviewed; later revocation is not retroactive.

### CW-CV2 — `semantic_idempotency`

Use one idempotency key across independent clients and process restarts.

1. Submit the same semantic request concurrently with different JSON whitespace and object-key order.
2. Replay it after restart.
3. Reuse the key with a different route, query value, body, provider revision, or target.
4. Omit the key, then exercise invalid UTF-8, duplicate JSON keys, lone surrogates, non-finite/unsafe numbers, sparse arrays, undeclared properties, unsupported schema versions, and invalid Unicode.
5. Interrupt after receipt reservation and require the classified stored outcome; do not synthesize a retry.

**Pass condition:** equivalent requests return the same stored response and exactly one accepted transition/consequence; a missing key returns `idempotency_key_required`; different requests return `idempotency_key_reused`; malformed or unsupported inputs fail before reservation/effect; an interrupted pending receipt is either safely reconciled or remains explicitly indeterminate with no automatic relaunch.

### CW-CV3 — `single_active_run`

Two distinct idempotency keys and independent connections start runs in the same session against the same reviewed provider revision. A barrier proves both reached the validation boundary before either commits. Do not use a provider queue or concurrency-one fixture as the proof.

**Pass condition:** one request creates the only non-terminal run and launches the provider at most once; the other returns `active_run_conflict`; no second prompt transcript, `run.started`, provider process, or canonical branch appears. The harness uses a bounded watchdog and fails the vector if cleanup, cancellation, or a late effect is unresolved.

### CW-CV4 — `crash_boundary_recovery`

The parent harness terminates the daemon process externally at named, test-only failpoints:

1. before receipt reservation;
2. after receipt reservation but before canonical mutation;
3. after the run/prompt transaction but before provider launch;
4. after provider launch acknowledgement but before response finalization;
5. inside an event/message transaction before commit;
6. after terminal persistence but before client acknowledgement.

**Pass condition:** pre-commit cases leave prior state or a fenced/reconcilable intent; an in-transaction kill leaves no fragment; a persisted terminal result reconstructs exactly once; an acknowledged external launch is never blindly repeated; every pending case becomes one of the contract's explicit recovery outcomes. The report includes before/after row counts, provider-fixture launch IDs, daemon exit evidence, reconciliation result, and a bounded no-late-effect observation.

### CW-CV5 — `deterministic_reconstruction`

Materialize a content-limited canonical projection of sessions, runs, event/transcript positions, approvals, checkpoints, receipts, steering state, and causal/version links. Exclude volatile connection IDs, process IDs, absolute temporary paths, and wall-clock test diagnostics. Serialize with a declared CodeWave canonicalization/digest version.

**Pass condition:** independent processes and restarts produce the exact expected canonical bytes, digest, and position graph from the same database; parent links and sequences have no gaps or forks beyond explicitly documented SQLite allocation behavior; unsupported state, request, projection, serializer, protocol, or adapter versions fail closed. This is **reconstruction**, not event-sourcing or provider replay.

### CW-CV6 — `payload_separation_provenance`

Place distinct synthetic sentinels in a prompt, provider diagnostic, tool input/output, artifact body, and an optional deletable-content fixture. Build the minimal audit projection and perform the contract's supported content-removal/redaction procedure without altering authority, causation, outcome, sequence, or version facts.

**Pass condition:** the minimal projection and its digest remain valid without copying the sentinels; sentinels are absent from mutation receipts, connection/protocol records, policy revisions, recovery metadata, test logs, report diagnostics, and other content-free surfaces; every intentional content-bearing store is enumerated rather than falsely called private. Backup, WAL-frame, filesystem-journal, provider-service, shell-history, and external telemetry erasure remain unproven boundaries.

## Mandatory supporting assertions

The gate must also prove:

- SQLite foreign keys are enabled and `PRAGMA integrity_check` returns `ok` after every crash family;
- related run/prompt and event/message writes are all-or-none;
- event and transcript sequences remain monotonic and parent-linked under concurrency;
- only one terminal run event and one terminal tool outcome survive duplicate or late provider records;
- stale callbacks cannot mutate a different selected/current run;
- direct provider output cannot bypass normalized event acceptance;
- outbound MCP observation creates no mutation receipt or provider launch;
- fixtures contain no real credentials, personal data, workspace source, or provider account material;
- child processes, ports, file handles, temporary databases, and fixture workspaces are cleaned after success and failure;
- the validator records its timeout, retry, kill, and cleanup policy instead of using a caller-only `Promise.race` as proof.

## Evidence report contract

The validator generates `.codewave/qa/continuity-dogfood-2026-08-13/backend/validated-post-fix.json` inside the intentionally ignored `.codewave/` QA tree. It must be machine-readable and contain at least:

```json
{
  "schemaVersion": 1,
  "contractId": "codewave-continuity-v1",
  "generatedAt": "<RFC 3339 UTC timestamp>",
  "command": "npm run check:continuity",
  "source": {
    "commit": "<git commit or null>",
    "treeStatusFingerprint": "<sha256>"
  },
  "topology": {
    "database": "isolated-sqlite-wal",
    "provider": "qualified-synthetic-fixture",
    "network": "loopback-only"
  },
  "vectors": [
    { "id": "CW-CV1", "name": "authorization_scope", "status": "passed", "assertions": [], "detail": "<summary>" }
  ],
  "supportingAssertions": [
    { "id": "CW-I1", "status": "passed", "assertions": [], "detail": "<summary>" }
  ],
  "cleanup": {
    "daemonTerminated": true,
    "tempRootRemoved": true
  },
  "summary": { "passed": 16, "failed": 0, "total": 16 },
  "result": "passed"
}
```

Each assertion records its stable ID, result, decisive observed values, and evidence class. Sensitive fixture content, absolute user paths, raw prompts, raw tool payloads, environment values, and credentials must not appear in the report. Performance timings are local observations, not SLOs.

The aggregate result is `passed` only when CW-CV1–CW-CV6, all ten invariant mappings, every mandatory supporting assertion, integrity checks, cleanup checks, and report self-validation pass in one final run. `not-run`, skipped, timed out, indeterminate test infrastructure, missing evidence, or an unrecognized version makes the aggregate non-passing.

## Completion gates

The continuity slice is complete only when all of the following are true:

1. this contract, the architecture, and implementation history agree on the boundary and non-claims;
2. `npm run check:continuity` exists and runs from a clean install without another database/runtime service;
3. the harness starts an isolated real CodeWave daemon and uses qualified synthetic provider fixtures;
4. CW-CV1–CW-CV6 and every supporting assertion pass without weakening expected outcomes;
5. the evidence report validates against its own schema and identifies the tested tree;
6. the ordinary typecheck, daemon harness, adversarial harness, provider transport, and production build remain green;
7. no test process, provider process, listener, temporary database, or synthetic workspace remains after the run;
8. any production behavior changed to satisfy the contract is documented in `docs/architecture.md` in the same change;
9. the final report distinguishes proven local guarantees from unproven external-effect, security, privacy, and production boundaries.

## Non-claims

Passing this contract does **not** prove:

- exactly-once filesystem, shell, Git, network, provider, notification, or MCP side effects;
- absence of loss after disk/controller failure, WAL corruption, hostile file replacement, or backup/restore mistakes;
- security against another process with the same OS-user authority, database-file ownership, administrator rights, or supply-chain control;
- authentication, multi-user isolation, internet-safe exposure, distributed consensus, high availability, scalability, latency, or recovery SLOs;
- deletion from WAL frames, backups, filesystem journals, provider services, remote logs, shell history, telemetry, or restore media;
- legal compliance, anonymization, credential safety, or safe handling of real personal, medical, biometric, or neural data;
- correctness, truthfulness, determinism, or privacy of model reasoning and provider output;
- that a checkpoint is a complete provider snapshot, or that a failed run can always resume;
- that CodeWave is event-sourced, tamper-evident, or protected against an attacker who can rewrite the database and recompute a digest;
- production readiness, external demand, or product-market fit.

The approved narrow description is:

> CodeWave has a local SQLite conformance harness for selected authorization, idempotency, concurrency, recovery, reconstruction, provenance, and content-separation properties under a synthetic single-daemon topology.

Use that description only after the executable aggregate passes for the tree being described.
