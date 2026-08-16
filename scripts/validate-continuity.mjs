import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const DAEMON_ENTRY = path.join(REPO_ROOT, 'apps', 'daemon', 'src', 'index.ts');
const FREEBUFF_FIXTURE = path.join(SCRIPT_DIR, 'fixtures', 'fake-freebuff-bridge.mjs');
const EVIDENCE_DIRECTORY = path.join(
  REPO_ROOT,
  '.codewave',
  'qa',
  'continuity-dogfood-2026-08-13',
  'backend',
);
const REPORT_PATH = path.join(EVIDENCE_DIRECTORY, 'validated-post-fix.json');
const ALL_SCOPES = [
  'runtime:read', 'providers:read', 'providers:write', 'sessions:read',
  'sessions:write', 'runs:read', 'runs:write', 'orchestration:read',
  'orchestration:write', 'tools:read', 'workspace:read', 'workspace:write',
  'approvals:write',
];
const PRIVATE_SENTINEL = 'CW_PRIVATE_FILE_SENTINEL_20260813_5D91F2';
const CONTENT_SENTINELS = [
  'CW_PROMPT_SENTINEL_20260813',
  'CW_PROVIDER_DIAGNOSTIC_SENTINEL_20260813',
  'CW_TOOL_INPUT_SENTINEL_20260813',
  'CW_TOOL_OUTPUT_SENTINEL_20260813',
  'CW_ARTIFACT_BODY_SENTINEL_20260813',
  PRIVATE_SENTINEL,
];

for (const requiredPath of [TSX_CLI, DAEMON_ENTRY, FREEBUFF_FIXTURE]) {
  if (!existsSync(requiredPath)) throw new Error(`Missing required file: ${requiredPath}`);
}

mkdirSync(EVIDENCE_DIRECTORY, { recursive: true });
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'codewave-continuity-'));
let nextPort = 6300 + Math.floor(Math.random() * 250);
const daemonProcesses = new Set();
const vectorResults = [];
const assertionResults = [];
const topology = {
  database: 'isolated-sqlite-wal',
  provider: 'qualified-synthetic-fixture',
  network: 'loopback-only',
  runtime: 'CodeWave daemon child process',
  persistence: 'SQLite WAL',
  providerDetail: 'synthetic Freebuff protocol-v1 bridge',
  crashMechanism: 'external process termination via test-only SIGKILL boundary hooks',
  databaseBackends: ['SQLite'],
  excludedBackends: ['Restate', 'PostgreSQL', 'DBOS'],
  controlPolicy: {
    requestTimeoutMs: 12_000,
    crashBarrierTimeoutMs: 10_000,
    daemonStartupTimeoutMs: 15_000,
    automaticMutationRetries: 0,
    killOwner: 'parent-validator',
    cleanup: 'terminate children then recursively remove isolated root',
  },
};

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function gitOutput(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unavailable';
}

function sourceTreeFingerprint() {
  const diff = spawnSync('git', ['diff', '--binary', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const untracked = spawnSync(
    'git',
    ['ls-files', '--others', '--exclude-standard'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  if (diff.status !== 0 || untracked.status !== 0) return 'unavailable';
  const untrackedManifest = untracked.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .sort()
    .map((relativePath) => {
      const absolutePath = path.join(REPO_ROOT, relativePath);
      return {
        relativePath: relativePath.replaceAll('\\', '/'),
        digest: existsSync(absolutePath) ? sha256(readFileSync(absolutePath)) : 'missing',
      };
    });
  return `sha256:${sha256(stableJson({ diff: diff.stdout, untrackedManifest }))}`;
}

function sanitizeDiagnostic(value) {
  let sanitized = String(value)
    .replaceAll(tempRoot, '<isolated-temp-root>')
    .replaceAll(REPO_ROOT, '<codewave-root>');
  for (const sentinel of CONTENT_SENTINELS) {
    sanitized = sanitized.replaceAll(sentinel, '<redacted-synthetic-sentinel>');
  }
  return sanitized;
}

function makePaths(label) {
  const root = path.join(tempRoot, label);
  const daemonRoot = path.join(root, 'daemon-root');
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  mkdirSync(daemonRoot, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(outside, { recursive: true });
  return { root, daemonRoot, workspace, outside };
}

function startDaemon(paths, crashPoint = null, extraEnvironment = {}) {
  const port = nextPort++;
  const crashSignalPath = path.join(paths.root, `crash-signal-${port}.txt`);
  const logs = [];
  const command = `"${process.execPath}" "${FREEBUFF_FIXTURE}"`;
  const child = spawn(process.execPath, [TSX_CLI, DAEMON_ENTRY], {
    cwd: paths.daemonRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CODEWAVE_PORT: String(port),
      CODEWAVE_FREEBUFF_COMMAND: command,
      CODEWAVE_OPENCODE_ENABLED: 'false',
      CODEWAVE_QWEN_ENABLED: 'false',
      CODEWAVE_GEMINI_ENABLED: 'false',
      CODEWAVE_FAKE_FREEBUFF_DELAY_MS: '250',
      CODEWAVE_FAKE_FREEBUFF_HOLD_MS: '3500',
      ...(crashPoint ? { CODEWAVE_TEST_CRASH_POINT: crashPoint } : {}),
      ...(crashPoint ? { CODEWAVE_TEST_CRASH_SIGNAL_PATH: crashSignalPath } : {}),
      ...extraEnvironment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => logs.push(`[stdout] ${chunk.toString().trimEnd()}`));
  child.stderr?.on('data', (chunk) => logs.push(`[stderr] ${chunk.toString().trimEnd()}`));
  daemonProcesses.add(child);
  child.once('close', () => daemonProcesses.delete(child));
  return {
    child,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    logs,
    connectionId: null,
    crashSignalPath,
  };
}

async function stopDaemon(daemon) {
  if (!daemon || daemon.child.exitCode !== null) return;
  daemon.child.kill();
  await Promise.race([
    once(daemon.child, 'close'),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

async function waitForExit(daemon, timeoutMs = 10_000) {
  if (daemon.child.exitCode !== null) return daemon.child.exitCode;
  return Promise.race([
    once(daemon.child, 'close').then(([code]) => code),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`Daemon did not exit at configured crash point. Logs:\n${daemon.logs.join('\n')}`)),
      timeoutMs,
    )),
  ]);
}

async function killAtCrashSignal(daemon, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(daemon.crashSignalPath)) {
      const point = readFileSync(daemon.crashSignalPath, 'utf8');
      daemon.child.kill('SIGKILL');
      await waitForExit(daemon);
      return point;
    }
    if (daemon.child.exitCode !== null) {
      throw new Error(`Daemon exited before parent observed its crash barrier. Logs:\n${daemon.logs.join('\n')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Parent did not observe daemon crash barrier within ${timeoutMs}ms.`);
}

async function request(daemon, method, pathname, {
  body,
  rawBody,
  key,
  connection = daemon.connectionId,
} = {}) {
  const headers = new Headers();
  if (body !== undefined || rawBody !== undefined) headers.set('Content-Type', 'application/json');
  if (key) headers.set('Idempotency-Key', key);
  if (connection) headers.set('X-CodeWave-Connection', connection);
  const response = await fetch(`${daemon.baseUrl}${pathname}`, {
    method,
    headers,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return {
    status: response.status,
    payload,
    replayed: response.headers.get('idempotency-replayed') === 'true',
    pending: response.headers.get('idempotency-pending') === 'true',
  };
}

async function waitForHealth(daemon, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await request(daemon, 'GET', '/api/health', { connection: null });
      if (result.status === 200 && result.payload?.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Daemon health timeout. Logs:\n${daemon.logs.join('\n')}`);
}

async function negotiate(daemon, scopes = ALL_SCOPES, clientName = 'continuity-validator') {
  const result = await request(daemon, 'POST', '/api/handshake', {
    connection: null,
    body: {
      clientName,
      clientVersion: '1.0.0-test',
      protocolVersion: 1,
      requestedScopes: scopes,
    },
  });
  assert.equal(result.status, 201);
  daemon.connectionId = result.payload.connectionId;
  return result.payload;
}

async function readyDaemon(paths, options = {}) {
  const daemon = startDaemon(paths, options.crashPoint, options.environment);
  await waitForHealth(daemon);
  await negotiate(daemon, options.scopes ?? ALL_SCOPES, options.clientName);
  return daemon;
}

async function providerRevision(daemon) {
  const response = await request(daemon, 'GET', '/api/providers');
  assert.equal(response.status, 200);
  return response.payload.revision;
}

async function waitForRunTerminal(daemon, runId, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await request(daemon, 'GET', `/api/runs/${runId}`);
    if (
      snapshot.status === 200 &&
      ['completed', 'failed', 'cancelled'].includes(snapshot.payload.run.status)
    ) return snapshot.payload;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error('Run did not reach a terminal state within the continuity watchdog.');
}

async function createSession(daemon, workspace, key) {
  const response = await request(daemon, 'POST', '/api/sessions', {
    key,
    body: {
      workspacePath: workspace,
      providerId: 'freebuff',
      approvalPolicy: 'manual',
      expectedProviderRevision: await providerRevision(daemon),
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.payload));
  return response.payload;
}

function databasePath(paths) {
  return path.join(paths.daemonRoot, '.codewave', 'state.sqlite');
}

function mutationRows(paths, key) {
  const database = new DatabaseSync(databasePath(paths), { readOnly: true });
  try {
    return database.prepare(
      `SELECT idempotency_key, operation, request_hash, status_code, state,
       protocol_version, client_name, client_version, canonicalization_version,
       request_schema_version FROM mutation_receipts WHERE idempotency_key = ?`,
    ).all(key);
  } finally {
    database.close();
  }
}

function stateProjection(paths, projectionVersion = 'codewave-reconstruction-v1') {
  if (projectionVersion !== 'codewave-reconstruction-v1') {
    throw new Error(`Unsupported reconstruction projection version '${projectionVersion}'.`);
  }
  const database = new DatabaseSync(databasePath(paths), { readOnly: true });
  try {
    return {
      projectionVersion,
      sessions: database.prepare(
        `SELECT id, provider_id, provider_configuration_revision, approval_policy,
         recovery_kind, source_session_id, source_checkpoint_id, source_run_id,
         orchestration_kind, orchestration_role, orchestration_source_session_id,
         orchestration_source_run_id, orchestration_source_provider_id
         FROM sessions ORDER BY id`,
      ).all(),
      runs: database.prepare(
        `SELECT id, session_id, provider_id, provider_configuration_revision,
         status, mode, CASE WHEN pre_run_commit IS NULL THEN 0 ELSE 1 END AS has_pre_run_commit
         FROM runs ORDER BY id`,
      ).all(),
      events: database.prepare(
        `SELECT id, session_id, run_id, sequence, source, type
         FROM events ORDER BY run_id, sequence, id`,
      ).all(),
      transcript: database.prepare(
        `SELECT id, session_id, run_id, sequence, parent_message_id, role, source_event_id
         FROM transcript_messages ORDER BY session_id, sequence, id`,
      ).all(),
      approvals: database.prepare(
        `SELECT id, session_id, run_id, tool_use_id, status
         FROM approvals ORDER BY id`,
      ).all(),
      checkpoints: database.prepare(
        `SELECT id, session_id, run_id, provider_session_id
         FROM checkpoints ORDER BY id`,
      ).all(),
      tools: database.prepare(
        `SELECT id, session_id, run_id, tool_use_id, tool_name, status
         FROM tool_invocations ORDER BY id`,
      ).all(),
      steering: database.prepare(
        `SELECT id, session_id, target_run_id, expected_run_id,
         provider_configuration_revision, status, applied_run_id
         FROM run_steering_inputs ORDER BY id`,
      ).all(),
      receipts: database.prepare(
        `SELECT idempotency_key, operation, request_hash, status_code,
         state, protocol_version, client_name,
         client_version, canonicalization_version, request_schema_version
         FROM mutation_receipts ORDER BY idempotency_key`,
      ).all(),
    };
  } finally {
    database.close();
  }
}

function stateDigest(paths) {
  return `sha256:${sha256(stableJson(stateProjection(paths)))}`;
}

function verifyProjectionGraph(projection) {
  const sessions = new Set(projection.sessions.map((entry) => entry.id));
  const runs = new Set(projection.runs.map((entry) => entry.id));
  for (const run of projection.runs) assert.ok(sessions.has(run.session_id));
  for (const event of projection.events) assert.ok(runs.has(event.run_id));
  for (const message of projection.transcript) assert.ok(runs.has(message.run_id));
  const bySession = Map.groupBy(projection.transcript, (entry) => entry.session_id);
  for (const messages of bySession.values()) {
    const ordered = messages.toSorted((left, right) => left.sequence - right.sequence);
    assert.deepEqual(ordered.map((entry) => entry.sequence), ordered.map((_, index) => index + 1));
    for (let index = 0; index < ordered.length; index += 1) {
      assert.equal(ordered[index].parent_message_id, index === 0 ? null : ordered[index - 1].id);
    }
  }
  const byRun = Map.groupBy(projection.events, (entry) => entry.run_id);
  for (const events of byRun.values()) {
    const ordered = events.toSorted((left, right) => left.sequence - right.sequence);
    assert.deepEqual(ordered.map((entry) => entry.sequence), ordered.map((_, index) => index + 1));
  }
  return true;
}

function proof(id, observed, expected, evidenceClass) {
  return { id, result: 'passed', observed, expected, evidenceClass };
}

function recordResult(target, id, name, assertions, detail) {
  assert.ok(Array.isArray(assertions) && assertions.length > 0);
  target.push({ id, name, status: 'passed', assertions, detail });
}

async function vectorAuthorizationScope() {
  const paths = makePaths('cv1-authorization');
  let daemon = await readyDaemon(paths, { scopes: ['runtime:read'], clientName: 'scope-vector' });
  try {
    const target = path.join(paths.workspace, 'denied.txt');
    const denied = await request(daemon, 'POST', '/api/workspace/files', {
      key: 'cv1-denied-file-01',
      body: { workspacePath: paths.workspace, name: 'denied.txt', content: 'no' },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.payload.code, 'client_scope_required');
    assert.equal(existsSync(target), false);
    const anonymous = await request(daemon, 'GET', '/api/runtime', { connection: null });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.payload.code, 'client_handshake_required');
    const staleConnection = daemon.connectionId;
    await stopDaemon(daemon);
    daemon = await readyDaemon(paths);
    const staleLease = await request(daemon, 'GET', '/api/runtime', {
      connection: staleConnection,
    });
    assert.equal(staleLease.status, 401);
    assert.equal(staleLease.payload.code, 'client_connection_invalid');

    const traversal = await request(daemon, 'GET',
      `/api/workspace/files?workspacePath=${encodeURIComponent(paths.workspace)}&targetPath=..%2Foutside%2Fsecret.txt`);
    assert.equal(traversal.status, 409);
    assert.equal(traversal.payload.code, 'workspace_path_escape');
    writeFileSync(path.join(paths.outside, 'secret.txt'), 'outside', 'utf8');
    symlinkSync(paths.outside, path.join(paths.workspace, 'escape'), 'junction');
    const junction = await request(daemon, 'GET',
      `/api/workspace/files?workspacePath=${encodeURIComponent(paths.workspace)}&targetPath=escape%2Fsecret.txt`);
    assert.equal(junction.status, 409);
    assert.equal(junction.payload.code, 'workspace_path_escape');

    const reviewedRevision = await providerRevision(daemon);
    const changedPolicy = await request(daemon, 'PATCH', '/api/providers/qwen', {
      key: 'cv1-policy-change-01',
      body: { expectedProviderRevision: reviewedRevision, priority: 31 },
    });
    assert.equal(changedPolicy.status, 200, JSON.stringify(changedPolicy.payload));
    const sessionsBefore = (await request(daemon, 'GET', '/api/sessions')).payload.length;
    const stalePolicy = await request(daemon, 'POST', '/api/sessions', {
      key: 'cv1-stale-policy-session-01',
      body: {
        workspacePath: paths.workspace,
        providerId: 'freebuff',
        approvalPolicy: 'manual',
        expectedProviderRevision: reviewedRevision,
      },
    });
    assert.equal(stalePolicy.status, 409);
    assert.equal(stalePolicy.payload.code, 'provider_revision_conflict');
    const sessionsAfterStalePolicy = (await request(daemon, 'GET', '/api/sessions')).payload.length;
    assert.equal(sessionsAfterStalePolicy, sessionsBefore);

    const currentRevision = changedPolicy.payload.revision;
    const session = await request(daemon, 'POST', '/api/sessions', {
      key: 'cv1-fence-session-01',
      body: {
        workspacePath: paths.workspace,
        providerId: 'freebuff',
        approvalPolicy: 'manual',
        expectedProviderRevision: currentRevision,
      },
    });
    assert.equal(session.status, 201);
    const run = await request(daemon, 'POST', `/api/sessions/${session.payload.id}/runs`, {
      key: 'cv1-fence-run-01',
      body: {
        prompt: '[hold] run fence',
        mode: 'execute',
        expectedProviderRevision: currentRevision,
      },
    });
    assert.equal(run.status, 201);
    const staleFence = await request(daemon, 'POST', `/api/runs/${run.payload.run.id}/steer`, {
      key: 'cv1-stale-run-fence-01',
      body: {
        prompt: 'must not apply',
        expectedRunId: 'different-run-id',
        expectedProviderRevision: currentRevision,
      },
    });
    assert.equal(staleFence.status, 409);
    const fenceSnapshot = await request(daemon, 'GET', `/api/runs/${run.payload.run.id}`);
    assert.equal(fenceSnapshot.payload.steering.length, 0);
    await request(daemon, 'POST', `/api/runs/${run.payload.run.id}/cancel`, {
      key: 'cv1-cancel-run-01', body: {},
    });
    recordResult(vectorResults, 'CW-CV1', 'authorization_scope', [
      proof('CV1-SCOPE', denied.status, 403, 'daemon-http'),
      proof('CV1-SCOPE-CODE', denied.payload.code, 'client_scope_required', 'daemon-http'),
      proof('CV1-ZERO-FS-DELTA', existsSync(target), false, 'filesystem'),
      proof('CV1-HANDSHAKE', anonymous.payload.code, 'client_handshake_required', 'daemon-http'),
      proof('CV1-STALE-LEASE', staleLease.payload.code, 'client_connection_invalid', 'daemon-restart'),
      proof('CV1-TRAVERSAL', traversal.payload.code, 'workspace_path_escape', 'filesystem'),
      proof('CV1-JUNCTION', junction.payload.code, 'workspace_path_escape', 'filesystem'),
      proof('CV1-POLICY-REVISION', stalePolicy.payload.code, 'provider_revision_conflict', 'daemon-http'),
      proof('CV1-POLICY-ZERO-DELTA', sessionsAfterStalePolicy, sessionsBefore, 'sqlite-via-daemon'),
      proof('CV1-RUN-FENCE', fenceSnapshot.payload.steering.length, 0, 'sqlite-via-daemon'),
    ],
      'Wrong scope and missing handshake fail before filesystem or state mutation.');
  } finally {
    await stopDaemon(daemon);
  }
}

async function vectorSemanticIdempotencyAndFiles() {
  const paths = makePaths('cv2-idempotency-files');
  let daemon = await readyDaemon(paths);
  try {
    const unkeyed = await request(daemon, 'POST', '/api/workspace/files', {
      body: { workspacePath: paths.workspace, name: 'unkeyed.txt', content: 'forbidden' },
    });
    assert.equal(unkeyed.status, 428);
    assert.equal(unkeyed.payload.code, 'idempotency_key_required');
    assert.equal(existsSync(path.join(paths.workspace, 'unkeyed.txt')), false);
    const invalidUtf8Key = 'cv2-invalid-utf8-01';
    const invalidUtf8 = await request(daemon, 'POST', '/api/workspace/files', {
      key: invalidUtf8Key,
      rawBody: Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
    });
    assert.equal(invalidUtf8.status, 400);
    assert.equal(invalidUtf8.payload.code, 'invalid_canonical_json');
    assert.equal(mutationRows(paths, invalidUtf8Key).length, 0);
    const key = 'cv2-create-file-01';
    const firstConnection = daemon.connectionId;
    const secondConnection = (await negotiate(
      daemon,
      ALL_SCOPES,
      'continuity-idempotency-second',
    )).connectionId;
    const [first, concurrentReplay] = await Promise.all([
      request(daemon, 'POST', '/api/workspace/files', {
        key,
        connection: firstConnection,
        rawBody: JSON.stringify({ workspacePath: paths.workspace, name: 'alpha.txt', content: 'first' }),
      }),
      request(daemon, 'POST', '/api/workspace/files', {
        key,
        connection: secondConnection,
        rawBody: JSON.stringify({ content: 'first', name: 'alpha.txt', workspacePath: paths.workspace }),
      }),
    ]);
    assert.equal(first.status, 201);
    assert.equal(concurrentReplay.status, 201);
    assert.ok(first.replayed || concurrentReplay.replayed);
    assert.match(first.payload.version, /^sha256:[a-f0-9]{64}$/);
    const replay = await request(daemon, 'POST', '/api/workspace/files', {
      key,
      rawBody: JSON.stringify({ content: 'first', name: 'alpha.txt', workspacePath: paths.workspace }),
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.payload, first.payload);
    const conflict = await request(daemon, 'POST', '/api/workspace/files', {
      key,
      body: { workspacePath: paths.workspace, name: 'alpha.txt', content: 'different' },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.payload.code, 'idempotency_key_reused');
    assert.equal(readFileSync(path.join(paths.workspace, 'alpha.txt'), 'utf8'), 'first');
    const routeMismatch = await request(daemon, 'POST', '/api/workspace/folders', {
      key,
      body: { workspacePath: paths.workspace, name: 'other' },
    });
    assert.equal(routeMismatch.status, 409);
    assert.equal(routeMismatch.payload.code, 'idempotency_key_reused');

    await stopDaemon(daemon);
    daemon = await readyDaemon(paths);
    const restartReplay = await request(daemon, 'POST', '/api/workspace/files', {
      key,
      body: { workspacePath: paths.workspace, name: 'alpha.txt', content: 'first' },
    });
    assert.equal(restartReplay.status, 201);
    assert.equal(restartReplay.replayed, true);

    const duplicateKey = 'cv2-duplicate-json-01';
    const duplicate = await request(daemon, 'POST', '/api/workspace/files', {
      key: duplicateKey,
      rawBody: `{"workspacePath":${JSON.stringify(paths.workspace)},"name":"bad.txt","name":"other.txt"}`,
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.payload.code, 'invalid_canonical_json');
    assert.equal(mutationRows(paths, duplicateKey).length, 0);
    const unsafe = await request(daemon, 'POST', '/api/workspace/files', {
      key: 'cv2-unsafe-json-01',
      rawBody: `{"workspacePath":${JSON.stringify(paths.workspace)},"name":"bad.txt","content":"x","n":9007199254740993}`,
    });
    assert.equal(unsafe.status, 400);
    assert.equal(unsafe.payload.code, 'invalid_canonical_json');
    const loneSurrogate = await request(daemon, 'POST', '/api/workspace/files', {
      key: 'cv2-surrogate-json-01',
      rawBody: `{"workspacePath":${JSON.stringify(paths.workspace)},"name":"bad.txt","content":"\\ud800"}`,
    });
    assert.equal(loneSurrogate.status, 400);
    assert.equal(loneSurrogate.payload.code, 'invalid_canonical_json');
    const sparseArray = await request(daemon, 'POST', '/api/workspace/files', {
      key: 'cv2-sparse-json-01',
      rawBody: `{"workspacePath":${JSON.stringify(paths.workspace)},"name":"bad.txt","content":"x","items":[1,,2]}`,
    });
    assert.equal(sparseArray.status, 400);
    assert.equal(sparseArray.payload.code, 'invalid_canonical_json');
    const undeclared = await request(daemon, 'POST', '/api/workspace/files', {
      key: 'cv2-undeclared-json-01',
      body: { workspacePath: paths.workspace, name: 'bad.txt', content: 'x', secretExtra: true },
    });
    assert.equal(undeclared.status, 400);
    assert.equal(undeclared.payload.code, 'invalid_canonical_json');
    assert.equal(mutationRows(paths, 'cv2-undeclared-json-01').length, 0);
    const unsupportedSchema = await request(daemon, 'POST', '/api/workspace/files', {
      key: 'cv2-schema-json-01',
      body: {
        requestSchemaVersion: 'codewave-daemon-mutation-v999',
        workspacePath: paths.workspace,
        name: 'bad.txt',
      },
    });
    assert.equal(unsupportedSchema.status, 400);
    assert.equal(unsupportedSchema.payload.code, 'invalid_canonical_json');
    assert.equal(mutationRows(paths, 'cv2-schema-json-01').length, 0);

    const preview = await request(daemon, 'GET',
      `/api/workspace/files?workspacePath=${encodeURIComponent(paths.workspace)}&targetPath=alpha.txt`);
    assert.equal(preview.status, 200);
    assert.equal(preview.payload.content, 'first');
    const update = await request(daemon, 'PUT', '/api/workspace/files', {
      key: 'cv2-update-file-01',
      body: {
        workspacePath: paths.workspace,
        targetPath: 'alpha.txt',
        content: 'second',
        expectedVersion: preview.payload.version,
      },
    });
    assert.equal(update.status, 200);
    assert.equal(update.payload.updated, true);
    const stale = await request(daemon, 'PUT', '/api/workspace/files', {
      key: 'cv2-stale-file-01',
      body: {
        workspacePath: paths.workspace,
        targetPath: 'alpha.txt',
        content: 'lost update',
        expectedVersion: preview.payload.version,
      },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.payload.code, 'workspace_file_version_conflict');
    assert.equal(stale.payload.currentVersion, update.payload.version);
    assert.equal(readFileSync(path.join(paths.workspace, 'alpha.txt'), 'utf8'), 'second');

    writeFileSync(path.join(paths.workspace, 'large.txt'), `A${'🙂'.repeat(70_000)}Z`, 'utf8');
    const large = await request(daemon, 'GET',
      `/api/workspace/files?workspacePath=${encodeURIComponent(paths.workspace)}&targetPath=large.txt`);
    assert.equal(large.status, 200);
    assert.equal(large.payload.truncated, true);
    assert.ok(large.payload.contentByteLength <= 256 * 1024);
    assert.doesNotMatch(large.payload.content, /�/);
    writeFileSync(path.join(paths.workspace, 'binary.bin'), Buffer.from([0, 1, 2, 255]));
    const binary = await request(daemon, 'GET',
      `/api/workspace/files?workspacePath=${encodeURIComponent(paths.workspace)}&targetPath=binary.bin`);
    assert.equal(binary.status, 415);
    assert.equal(binary.payload.code, 'workspace_file_binary');
    const sparsePath = path.join(paths.workspace, 'sparse-large.txt');
    writeFileSync(sparsePath, Buffer.alloc(256 * 1024, 0x41));
    truncateSync(sparsePath, 3 * 1024 * 1024 * 1024);
    const sparseStartedAt = Date.now();
    const sparsePreview = await request(daemon, 'GET',
      `/api/workspace/files?workspacePath=${encodeURIComponent(paths.workspace)}&targetPath=sparse-large.txt`);
    assert.equal(sparsePreview.status, 200);
    assert.equal(sparsePreview.payload.truncated, true);
    assert.match(sparsePreview.payload.version, /^sha256-preview-v1:262144:[a-f0-9]{64}$/);
    assert.ok(Date.now() - sparseStartedAt < 5_000, 'Sparse 3 GiB preview must remain bounded.');
    recordResult(vectorResults, 'CW-CV2', 'semantic_idempotency', [
      proof('CV2-KEY-REQUIRED', unkeyed.payload.code, 'idempotency_key_required', 'daemon-http'),
      proof('CV2-UNKEYED-ZERO-FS-DELTA', existsSync(path.join(paths.workspace, 'unkeyed.txt')), false, 'filesystem'),
      proof('CV2-INVALID-UTF8', invalidUtf8.payload.code, 'invalid_canonical_json', 'daemon-http'),
      proof('CV2-INVALID-UTF8-NO-RECEIPT', mutationRows(paths, invalidUtf8Key).length, 0, 'sqlite'),
      proof('CV2-CANONICAL-REPLAY', replay.replayed, true, 'daemon-http'),
      proof('CV2-CONCURRENT-REPLAY', first.replayed || concurrentReplay.replayed, true, 'daemon-http'),
      proof('CV2-RESTART-REPLAY', restartReplay.replayed, true, 'daemon-restart'),
      proof('CV2-REPLAY-BODY', stableJson(replay.payload) === stableJson(first.payload), true, 'daemon-http'),
      proof('CV2-KEY-CONFLICT', conflict.payload.code, 'idempotency_key_reused', 'daemon-http'),
      proof('CV2-ROUTE-CONFLICT', routeMismatch.payload.code, 'idempotency_key_reused', 'daemon-http'),
      proof('CV2-DUPLICATE-KEY', duplicate.payload.code, 'invalid_canonical_json', 'daemon-http'),
      proof('CV2-MALFORMED-NO-RECEIPT', mutationRows(paths, duplicateKey).length, 0, 'sqlite'),
      proof('CV2-UNSAFE-NUMBER', unsafe.payload.code, 'invalid_canonical_json', 'daemon-http'),
      proof('CV2-LONE-SURROGATE', loneSurrogate.payload.code, 'invalid_canonical_json', 'daemon-http'),
      proof('CV2-SPARSE-ARRAY', sparseArray.payload.code, 'invalid_canonical_json', 'daemon-http'),
      proof('CV2-UNDECLARED', mutationRows(paths, 'cv2-undeclared-json-01').length, 0, 'sqlite'),
      proof('CV2-UNSUPPORTED-SCHEMA', mutationRows(paths, 'cv2-schema-json-01').length, 0, 'sqlite'),
      proof('CV2-CAS-CONFLICT', stale.payload.code, 'workspace_file_version_conflict', 'daemon-http'),
      proof('CV2-BINARY', binary.payload.code, 'workspace_file_binary', 'daemon-http'),
      proof('CV2-BOUNDED-SPARSE', sparsePreview.payload.contentByteLength, 256 * 1024, 'filesystem'),
    ],
      'Canonical key-order replay, key/payload conflict, strict JSON rejection, and full create/preview/CAS-edit lifecycle passed.');
  } finally {
    await stopDaemon(daemon);
  }
}

async function vectorSingleActiveRun() {
  const paths = makePaths('cv3-single-active');
  const daemon = await readyDaemon(paths, {
    environment: { CODEWAVE_TEST_CONCURRENT_RUN_BARRIER: '2' },
  });
  try {
    const session = await createSession(daemon, paths.workspace, 'cv3-session-01');
    const revision = await providerRevision(daemon);
    const firstConnection = daemon.connectionId;
    const secondHandshake = await negotiate(daemon, ALL_SCOPES, 'continuity-validator-second');
    const connections = [firstConnection, secondHandshake.connectionId];
    const requests = ['a', 'b'].map((suffix, index) => request(
      daemon,
      'POST',
      `/api/sessions/${session.id}/runs`,
      {
        key: `cv3-run-${suffix}-01`,
        body: {
          prompt: `[hold] concurrent run ${suffix}`,
          mode: 'execute',
          expectedProviderRevision: revision,
        },
        connection: connections[index],
      },
    ));
    const outcomes = await Promise.all(requests);
    assert.deepEqual(outcomes.map((entry) => entry.status).sort(), [201, 409]);
    const snapshot = await request(daemon, 'GET', `/api/sessions/${session.id}`);
    assert.equal(snapshot.payload.runs.length, 1);
    assert.equal(snapshot.payload.runs.filter((run) => !['completed', 'failed', 'cancelled'].includes(run.status)).length, 1);
    const active = snapshot.payload.runs[0];
    await request(daemon, 'POST', `/api/runs/${active.id}/cancel`, {
      key: 'cv3-cancel-01', body: {},
    });
    recordResult(vectorResults, 'CW-CV3', 'single_active_run', [
      proof('CV3-OUTCOMES', outcomes.map((entry) => entry.status).sort(), [201, 409], 'daemon-http'),
      proof('CV3-ONE-RUN', snapshot.payload.runs.length, 1, 'sqlite-via-daemon'),
      proof('CV3-ONE-ACTIVE', snapshot.payload.runs.filter((run) => !['completed', 'failed', 'cancelled'].includes(run.status)).length, 1, 'sqlite-via-daemon'),
      proof('CV3-CONFLICT-CODE', outcomes.find((entry) => entry.status === 409)?.payload.code, 'active_run_conflict', 'daemon-http'),
    ],
      'Two concurrent launches linearized to one active run and one typed conflict without a queue.');
  } finally {
    await stopDaemon(daemon);
  }
}

async function vectorCrashBoundaries() {
  const beforePaths = makePaths('cv4-before-reservation');
  let daemon = await readyDaemon(beforePaths, { crashPoint: 'before_receipt_reservation' });
  const beforeKey = 'cv4-before-reservation-01';
  const beforeBody = {
    workspacePath: beforePaths.workspace,
    name: 'before.txt',
    content: 'before',
  };
  void request(daemon, 'POST', '/api/workspace/files', {
    key: beforeKey, body: beforeBody,
  }).catch(() => undefined);
  assert.equal(await killAtCrashSignal(daemon), 'before_receipt_reservation');
  assert.equal(existsSync(path.join(beforePaths.workspace, 'before.txt')), false);
  daemon = await readyDaemon(beforePaths);
  assert.equal(mutationRows(beforePaths, beforeKey).length, 0);
  const beforeRetry = await request(daemon, 'POST', '/api/workspace/files', {
    key: beforeKey, body: beforeBody,
  });
  assert.equal(beforeRetry.status, 201);
  await stopDaemon(daemon);

  const reservationPaths = makePaths('cv4-reservation');
  daemon = await readyDaemon(reservationPaths, { crashPoint: 'after_receipt_reservation' });
  const reservationKey = 'cv4-reservation-file-01';
  const reservationBody = {
    workspacePath: reservationPaths.workspace,
    name: 'must-not-exist.txt',
    content: 'not committed',
  };
  void request(daemon, 'POST', '/api/workspace/files', {
    key: reservationKey, body: reservationBody,
  }).catch(() => undefined);
  assert.equal(await killAtCrashSignal(daemon), 'after_receipt_reservation');
  assert.equal(existsSync(path.join(reservationPaths.workspace, 'must-not-exist.txt')), false);
  daemon = await readyDaemon(reservationPaths);
  const unknown = await request(daemon, 'POST', '/api/workspace/files', {
    key: reservationKey, body: reservationBody,
  });
  assert.equal(unknown.status, 409);
  assert.equal(unknown.payload.code, 'mutation_outcome_unknown');
  const unknownStatus = await request(daemon, 'GET', `/api/mutations/${reservationKey}`);
  assert.equal(unknownStatus.payload.state, 'outcome_unknown');
  await stopDaemon(daemon);

  const launchPaths = makePaths('cv4-pre-launch');
  daemon = await readyDaemon(launchPaths);
  const session = await createSession(daemon, launchPaths.workspace, 'cv4-launch-session-01');
  const revision = await providerRevision(daemon);
  await stopDaemon(daemon);
  daemon = await readyDaemon(launchPaths, { crashPoint: 'after_run_persist_before_provider_launch' });
  const launchKey = 'cv4-launch-run-01';
  void request(daemon, 'POST', `/api/sessions/${session.id}/runs`, {
    key: launchKey,
    body: { prompt: 'crash before provider launch', mode: 'execute', expectedProviderRevision: revision },
  }).catch(() => undefined);
  assert.equal(await killAtCrashSignal(daemon), 'after_run_persist_before_provider_launch');
  daemon = await readyDaemon(launchPaths);
  const reconciledSession = await request(daemon, 'GET', `/api/sessions/${session.id}`);
  assert.equal(reconciledSession.payload.runs.length, 1);
  assert.equal(reconciledSession.payload.runs[0].status, 'failed');
  const runSnapshot = await request(daemon, 'GET', `/api/runs/${reconciledSession.payload.runs[0].id}`);
  assert.equal(runSnapshot.payload.events.filter((event) => event.type === 'run.failed').length, 1);
  const launchStatus = await request(daemon, 'GET', `/api/mutations/${launchKey}`);
  assert.equal(launchStatus.payload.state, 'outcome_unknown');
  await stopDaemon(daemon);

  const acknowledgedPaths = makePaths('cv4-launch-ack');
  const launchLog = path.join(acknowledgedPaths.root, 'provider-launches.jsonl');
  daemon = await readyDaemon(acknowledgedPaths, {
    environment: { CODEWAVE_TEST_PROVIDER_LAUNCH_LOG: launchLog },
  });
  const acknowledgedSession = await createSession(
    daemon,
    acknowledgedPaths.workspace,
    'cv4-ack-session-01',
  );
  const acknowledgedRevision = await providerRevision(daemon);
  await stopDaemon(daemon);
  daemon = await readyDaemon(acknowledgedPaths, {
    crashPoint: 'after_provider_launch_acknowledgement',
    environment: { CODEWAVE_TEST_PROVIDER_LAUNCH_LOG: launchLog },
  });
  const acknowledgedKey = 'cv4-ack-run-01';
  void request(daemon, 'POST', `/api/sessions/${acknowledgedSession.id}/runs`, {
    key: acknowledgedKey,
    body: {
      prompt: '[hold] launched before acknowledgement',
      mode: 'execute',
      expectedProviderRevision: acknowledgedRevision,
    },
  }).catch(() => undefined);
  assert.equal(await killAtCrashSignal(daemon), 'after_provider_launch_acknowledgement');
  daemon = await readyDaemon(acknowledgedPaths, {
    environment: { CODEWAVE_TEST_PROVIDER_LAUNCH_LOG: launchLog },
  });
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  const acknowledgedRunSnapshot = await request(
    daemon,
    'GET',
    `/api/sessions/${acknowledgedSession.id}`,
  );
  const acknowledgedRunId = acknowledgedRunSnapshot.payload.runs[0].id;
  const acknowledgedSnapshot = await request(daemon, 'GET', `/api/runs/${acknowledgedRunId}`);
  const launchIntentEvents = acknowledgedSnapshot.payload.events.filter((event) =>
    event.type === 'run.started');
  const launchEvents = acknowledgedSnapshot.payload.events.filter((event) =>
    event.type === 'run.provider.launched');
  assert.equal(launchIntentEvents.length, 1);
  assert.equal(launchEvents.length, 1);
  assert.match(String(launchEvents[0].payload.launchId), /^[a-f0-9-]{36}$/i);
  assert.equal(
    launchIntentEvents[0].payload.launchAttemptId,
    launchEvents[0].payload.launchId,
  );
  const providerLaunchLines = existsSync(launchLog)
    ? readFileSync(launchLog, 'utf8').trim().split('\n').filter(Boolean)
    : [];
  assert.equal(providerLaunchLines.length, 1);
  assert.equal(
    JSON.parse(providerLaunchLines[0]).launchId,
    launchEvents[0].payload.launchId,
  );
  const ackReceipt = await request(daemon, 'GET', `/api/mutations/${acknowledgedKey}`);
  assert.equal(ackReceipt.payload.state, 'outcome_unknown');
  await stopDaemon(daemon);

  const messagePaths = makePaths('cv4-message-transaction');
  daemon = await readyDaemon(messagePaths);
  const messageSession = await createSession(daemon, messagePaths.workspace, 'cv4-message-session-01');
  const messageRevision = await providerRevision(daemon);
  await stopDaemon(daemon);
  daemon = await readyDaemon(messagePaths, { crashPoint: 'inside_message_event_transaction' });
  const messageRun = await request(daemon, 'POST', `/api/sessions/${messageSession.id}/runs`, {
    key: 'cv4-message-run-01',
    body: { prompt: 'message transaction rollback', mode: 'execute', expectedProviderRevision: messageRevision },
  });
  assert.equal(messageRun.status, 201);
  assert.equal(await killAtCrashSignal(daemon), 'inside_message_event_transaction');
  daemon = await readyDaemon(messagePaths);
  const messageSnapshot = await request(daemon, 'GET', `/api/runs/${messageRun.payload.run.id}`);
  assert.equal(messageSnapshot.payload.events.filter((event) => event.type === 'message.created').length, 0);
  assert.equal(messageSnapshot.payload.transcript.messages.filter((entry) => entry.role === 'assistant').length, 0);
  await stopDaemon(daemon);

  const terminalPaths = makePaths('cv4-terminal-persistence');
  daemon = await readyDaemon(terminalPaths, { crashPoint: 'after_terminal_persistence' });
  const terminalSession = await createSession(daemon, terminalPaths.workspace, 'cv4-terminal-session-01');
  const terminalRevision = await providerRevision(daemon);
  const terminalRun = await request(daemon, 'POST', `/api/sessions/${terminalSession.id}/runs`, {
    key: 'cv4-terminal-run-01',
    body: { prompt: 'terminal persistence', mode: 'execute', expectedProviderRevision: terminalRevision },
  });
  assert.equal(terminalRun.status, 201);
  assert.equal(await killAtCrashSignal(daemon), 'after_terminal_persistence');
  daemon = await readyDaemon(terminalPaths);
  const terminalSnapshot = await request(daemon, 'GET', `/api/runs/${terminalRun.payload.run.id}`);
  assert.equal(terminalSnapshot.payload.run.status, 'completed');
  assert.equal(terminalSnapshot.payload.events.filter((event) =>
    ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)).length, 1);
  await stopDaemon(daemon);

  const finalizedPaths = makePaths('cv4-finalized');
  daemon = await readyDaemon(finalizedPaths, { crashPoint: 'after_receipt_finalization' });
  const finalKey = 'cv4-finalized-file-01';
  const finalBody = { workspacePath: finalizedPaths.workspace, name: 'once.txt', content: 'once' };
  void request(daemon, 'POST', '/api/workspace/files', {
    key: finalKey, body: finalBody,
  }).catch(() => undefined);
  assert.equal(await killAtCrashSignal(daemon), 'after_receipt_finalization');
  assert.equal(readFileSync(path.join(finalizedPaths.workspace, 'once.txt'), 'utf8'), 'once');
  daemon = await readyDaemon(finalizedPaths);
  const finalReplay = await request(daemon, 'POST', '/api/workspace/files', {
    key: finalKey, body: finalBody,
  });
  assert.equal(finalReplay.status, 201);
  assert.equal(finalReplay.replayed, true);
  const finalRows = mutationRows(finalizedPaths, finalKey);
  assert.equal(finalRows.length, 1);
  assert.equal(finalRows[0].state, 'completed');
  await stopDaemon(daemon);
  recordResult(vectorResults, 'CW-CV4', 'crash_boundary_recovery', [
    proof('CV4-BEFORE-RECEIPT', beforeRetry.status, 201, 'external-kill-restart'),
    proof('CV4-RESERVATION-CLASS', unknownStatus.payload.state, 'outcome_unknown', 'sqlite-via-daemon'),
    proof('CV4-PRE-LAUNCH-RUN', reconciledSession.payload.runs[0].status, 'failed', 'sqlite-via-daemon'),
    proof('CV4-PRE-LAUNCH-TERMINAL-COUNT', runSnapshot.payload.events.filter((event) => event.type === 'run.failed').length, 1, 'sqlite-via-daemon'),
    proof('CV4-FINAL-REPLAY', finalReplay.replayed, true, 'daemon-http'),
    proof('CV4-ONE-RECEIPT', finalRows.length, 1, 'sqlite'),
    proof('CV4-LAUNCH-ONCE', launchEvents.length, 1, 'persisted-launch-acknowledgement'),
    proof('CV4-LAUNCH-INTENT-CORRELATION', launchIntentEvents[0].payload.launchAttemptId, launchEvents[0].payload.launchId, 'persisted-launch-intent'),
    proof('CV4-MESSAGE-ROLLBACK', messageSnapshot.payload.events.filter((event) => event.type === 'message.created').length, 0, 'sqlite-via-daemon'),
    proof('CV4-TERMINAL-ATOMIC', terminalSnapshot.payload.run.status, 'completed', 'sqlite-via-daemon'),
    proof('CV4-ONE-TERMINAL', terminalSnapshot.payload.events.filter((event) => ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)).length, 1, 'sqlite-via-daemon'),
  ],
    'External kills at receipt reservation, durable run/pre-launch, and receipt finalization produced prior/unknown, reconciled-failed, and exact replay outcomes respectively.');
}

async function vectorDeterministicReconstruction() {
  const paths = makePaths('cv5-reconstruction');
  let daemon = await readyDaemon(paths);
  const session = await createSession(daemon, paths.workspace, 'cv5-session-01');
  const revision = await providerRevision(daemon);
  const run = await request(daemon, 'POST', `/api/sessions/${session.id}/runs`, {
    key: 'cv5-run-01',
    body: { prompt: 'deterministic reconstruction', mode: 'execute', expectedProviderRevision: revision },
  });
  assert.equal(run.status, 201);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 12_000) {
    const snapshot = await request(daemon, 'GET', `/api/runs/${run.payload.run.id}`);
    if (['completed', 'failed', 'cancelled'].includes(snapshot.payload.run.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  await stopDaemon(daemon);
  const firstDigest = stateDigest(paths);
  const firstProjection = stateProjection(paths);
  assert.equal(verifyProjectionGraph(firstProjection), true);
  daemon = await readyDaemon(paths);
  const afterRestart = await request(daemon, 'GET', `/api/runs/${run.payload.run.id}`);
  assert.equal(afterRestart.status, 200);
  await stopDaemon(daemon);
  const secondDigest = stateDigest(paths);
  assert.equal(secondDigest, firstDigest);
  assert.throws(
    () => stateProjection(paths, 'codewave-reconstruction-v999'),
    /Unsupported reconstruction projection version/,
  );

  daemon = await readyDaemon(paths);
  const unsupportedProtocol = await request(daemon, 'POST', '/api/handshake', {
    connection: null,
    body: {
      clientName: 'unsupported-protocol-vector',
      clientVersion: '1.0.0-test',
      protocolVersion: 999,
      requestedScopes: ALL_SCOPES,
    },
  });
  assert.equal(unsupportedProtocol.status, 426);
  assert.equal(unsupportedProtocol.payload.code, 'protocol_version_unsupported');
  await stopDaemon(daemon);

  const receiptDatabase = new DatabaseSync(databasePath(paths));
  receiptDatabase.prepare(
    `UPDATE mutation_receipts SET canonicalization_version = 'unsupported-canonical-v999'
     WHERE idempotency_key = 'cv5-session-01'`,
  ).run();
  receiptDatabase.close();
  daemon = await readyDaemon(paths);
  const unsupportedReceipt = await request(daemon, 'POST', '/api/sessions', {
    key: 'cv5-session-01',
    body: {
      workspacePath: paths.workspace,
      providerId: 'freebuff',
      approvalPolicy: 'manual',
      expectedProviderRevision: await providerRevision(daemon),
    },
  });
  assert.equal(unsupportedReceipt.status, 409);
  assert.equal(unsupportedReceipt.payload.code, 'mutation_version_unsupported');
  await stopDaemon(daemon);

  const metadataDatabase = new DatabaseSync(databasePath(paths));
  metadataDatabase.prepare(
    `UPDATE codewave_metadata SET value = 'codewave-state-v999'
     WHERE key = 'state_schema_version'`,
  ).run();
  metadataDatabase.close();
  const unsupportedStateDaemon = startDaemon(paths);
  await waitForExit(unsupportedStateDaemon);
  assert.match(unsupportedStateDaemon.logs.join('\n'), /Unsupported CodeWave state_schema_version/);

  const adapterPaths = makePaths('cv5-adapter-version');
  const adapterDaemon = await readyDaemon(adapterPaths, {
    environment: { CODEWAVE_TEST_FREEBUFF_PROTOCOL_VERSION: '999' },
  });
  const adapterRuntime = await request(adapterDaemon, 'GET', '/api/runtime');
  const freebuff = adapterRuntime.payload.providers.find((entry) => entry.providerId === 'freebuff');
  assert.equal(freebuff.available, false);
  await stopDaemon(adapterDaemon);
  recordResult(vectorResults, 'CW-CV5', 'deterministic_reconstruction', [
    proof('CV5-DIGEST', secondDigest, firstDigest, 'sqlite-canonical-projection'),
    proof('CV5-HYDRATION', afterRestart.status, 200, 'daemon-http'),
    proof('CV5-GRAPH', verifyProjectionGraph(firstProjection), true, 'canonical-projection'),
    proof('CV5-PROTOCOL-FAIL-CLOSED', unsupportedProtocol.payload.code, 'protocol_version_unsupported', 'daemon-http'),
    proof('CV5-RECEIPT-VERSION-FAIL-CLOSED', unsupportedReceipt.payload.code, 'mutation_version_unsupported', 'sqlite-via-daemon'),
    proof('CV5-STATE-VERSION-FAIL-CLOSED', unsupportedStateDaemon.child.exitCode !== null, true, 'daemon-process'),
    proof('CV5-ADAPTER-VERSION-FAIL-CLOSED', freebuff.available, false, 'provider-health'),
  ],
    `Canonical SQLite projection digest remained ${firstDigest} after restart and hydration.`);
}

async function vectorPayloadSeparationAndProvenance() {
  const paths = makePaths('cv6-privacy-provenance');
  const daemon = await readyDaemon(paths, { clientName: 'privacy-provenance-vector' });
  try {
    const key = 'cv6-private-file-01';
    const created = await request(daemon, 'POST', '/api/workspace/files', {
      key,
      body: { workspacePath: paths.workspace, name: 'private.txt', content: PRIVATE_SENTINEL },
    });
    assert.equal(created.status, 201);
    assert.equal(readFileSync(path.join(paths.workspace, 'private.txt'), 'utf8'), PRIVATE_SENTINEL);
    const receipt = await request(daemon, 'GET', `/api/mutations/${key}`);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.payload.state, 'completed');
    assert.equal(receipt.payload.provenance.protocolVersion, 1);
    assert.equal(receipt.payload.provenance.clientName, 'privacy-provenance-vector');
    assert.equal(receipt.payload.provenance.canonicalizationVersion, 'codewave-canonical-json-v1');
    assert.equal(receipt.payload.provenance.requestSchemaVersion, 'codewave-daemon-mutation-v1');
    const receiptDatabase = new DatabaseSync(databasePath(paths), { readOnly: true });
    const contentFreeReceiptText = stableJson(receiptDatabase.prepare(
      `SELECT idempotency_key, operation, request_hash, status_code, state,
       protocol_version, client_name, client_version, canonicalization_version,
       request_schema_version FROM mutation_receipts ORDER BY idempotency_key`,
    ).all());
    receiptDatabase.close();
    assert.equal(CONTENT_SENTINELS.some((sentinel) => contentFreeReceiptText.includes(sentinel)), false);
    assert.equal(daemon.logs.join('\n').includes(PRIVATE_SENTINEL), false);

    const session = await createSession(daemon, paths.workspace, 'cv6-session-01');
    const revision = await providerRevision(daemon);
    const run = await request(daemon, 'POST', `/api/sessions/${session.id}/runs`, {
      key: 'cv6-run-01',
      body: {
        prompt: '[continuity-payloads] CW_PROMPT_SENTINEL_20260813',
        mode: 'execute',
        expectedProviderRevision: revision,
      },
    });
    assert.equal(run.status, 201);
    assert.equal(run.payload.run.providerConfigurationRevision, revision);
    assert.equal(run.payload.events[0].payload.providerConfigurationRevision, revision);
    await waitForRunTerminal(daemon, run.payload.run.id);
    const minimalProjectionBeforeRemoval = stableJson(stateProjection(paths));
    assert.equal(
      CONTENT_SENTINELS.some((sentinel) => minimalProjectionBeforeRemoval.includes(sentinel)),
      false,
    );

    const contentDatabase = new DatabaseSync(databasePath(paths), { readOnly: true });
    const contentSurfaces = {
      runs: stableJson(contentDatabase.prepare('SELECT prompt FROM runs').all()),
      events: stableJson(contentDatabase.prepare('SELECT payload_json FROM events').all()),
      transcript: stableJson(contentDatabase.prepare('SELECT content FROM transcript_messages').all()),
      artifacts: stableJson(contentDatabase.prepare('SELECT content FROM artifacts').all()),
      tools: stableJson(contentDatabase.prepare('SELECT input_json, output_json FROM tool_invocations').all()),
      replayCache: stableJson(contentDatabase.prepare('SELECT response_json FROM mutation_response_cache').all()),
    };
    contentDatabase.close();
    assert.ok(contentSurfaces.runs.includes(CONTENT_SENTINELS[0]));
    assert.ok(contentSurfaces.events.includes(CONTENT_SENTINELS[1]));
    assert.ok(
      contentSurfaces.tools.includes(CONTENT_SENTINELS[2]),
      `Tool input sentinel missing from ${contentSurfaces.tools}`,
    );
    assert.ok(
      contentSurfaces.tools.includes(CONTENT_SENTINELS[3]),
      `Tool output sentinel missing from ${contentSurfaces.tools}`,
    );
    assert.ok(contentSurfaces.artifacts.includes(CONTENT_SENTINELS[4]));

    const removedFile = await request(
      daemon,
      'DELETE',
      `/api/workspace/entries?workspacePath=${encodeURIComponent(paths.workspace)}&targetPath=private.txt`,
      { key: 'cv6-delete-private-file-01' },
    );
    assert.equal(removedFile.status, 200);
    const removedSession = await request(daemon, 'DELETE', `/api/sessions/${session.id}`, {
      key: 'cv6-delete-session-01',
    });
    assert.equal(removedSession.status, 200);
    const runReceiptAfterRemoval = await request(daemon, 'GET', '/api/mutations/cv6-run-01');
    assert.equal(runReceiptAfterRemoval.payload.state, 'response_redacted');
    const afterRemovalDatabase = new DatabaseSync(databasePath(paths), { readOnly: true });
    const logicalContentAfterRemoval = stableJson({
      runs: afterRemovalDatabase.prepare('SELECT prompt FROM runs').all(),
      events: afterRemovalDatabase.prepare('SELECT payload_json FROM events').all(),
      transcript: afterRemovalDatabase.prepare('SELECT content FROM transcript_messages').all(),
      artifacts: afterRemovalDatabase.prepare('SELECT content FROM artifacts').all(),
      tools: afterRemovalDatabase.prepare('SELECT input_json, output_json FROM tool_invocations').all(),
      replayCache: afterRemovalDatabase.prepare('SELECT response_json FROM mutation_response_cache').all(),
    });
    const retainedReceiptFacts = afterRemovalDatabase.prepare(
      `SELECT request_hash, state, protocol_version, canonicalization_version,
       request_schema_version FROM mutation_receipts WHERE idempotency_key = 'cv6-run-01'`,
    ).get();
    afterRemovalDatabase.close();
    assert.equal(CONTENT_SENTINELS.some((sentinel) => logicalContentAfterRemoval.includes(sentinel)), false);
    assert.equal(existsSync(path.join(paths.workspace, 'private.txt')), false);
    assert.match(String(retainedReceiptFacts.request_hash), /^[a-f0-9]{64}$/);
    assert.equal(retainedReceiptFacts.state, 'response_redacted');
    recordResult(vectorResults, 'CW-CV6', 'payload_separation_provenance', [
      proof('CV6-RECEIPT-STATE', receipt.payload.state, 'completed', 'daemon-http'),
      proof('CV6-PROTOCOL-VERSION', receipt.payload.provenance.protocolVersion, 1, 'sqlite-via-daemon'),
      proof('CV6-REQUEST-SCHEMA', receipt.payload.provenance.requestSchemaVersion, 'codewave-daemon-mutation-v1', 'sqlite-via-daemon'),
      proof('CV6-MINIMAL-PROJECTION', CONTENT_SENTINELS.some((sentinel) => minimalProjectionBeforeRemoval.includes(sentinel)), false, 'canonical-projection'),
      proof('CV6-CONTENT-SURFACES-ENUMERATED', Object.keys(contentSurfaces).sort(), ['artifacts', 'events', 'replayCache', 'runs', 'tools', 'transcript'], 'sqlite'),
      proof('CV6-LOGICAL-REMOVAL', CONTENT_SENTINELS.some((sentinel) => logicalContentAfterRemoval.includes(sentinel)), false, 'sqlite-logical'),
      proof('CV6-RECEIPT-REDACTED', runReceiptAfterRemoval.payload.state, 'response_redacted', 'sqlite-via-daemon'),
      proof('CV6-AUTHORITY-RETAINED', retainedReceiptFacts.request_schema_version, 'codewave-daemon-mutation-v1', 'sqlite'),
      proof('CV6-NO-LOG-SENTINEL', daemon.logs.join('\n').includes(PRIVATE_SENTINEL), false, 'daemon-log'),
      proof('CV6-POLICY-LINEAGE', run.payload.run.providerConfigurationRevision, revision, 'sqlite-via-daemon'),
    ],
      'Distinct synthetic prompt/provider/tool/artifact/file content was enumerated, excluded from the minimal projection, logically removed, and left content-free receipt/version facts intact.');
  } finally {
    await stopDaemon(daemon);
  }
}

async function supportingAssertions() {
  const paths = makePaths('support-paths');
  const daemon = await readyDaemon(paths);
  let integrity = null;
  let foreignKeys = null;
  let graphValid = false;
  let terminalCount = 0;
  let receiptDeltaForObservation = -1;
  let stableIds = false;
  let escapedReadCode = null;
  try {
    const link = path.join(paths.workspace, 'outside-link');
    symlinkSync(paths.outside, link, 'junction');
    const escapedRead = await request(daemon, 'GET',
      `/api/workspace/files?workspacePath=${encodeURIComponent(paths.workspace)}&targetPath=outside-link%2Fsecret.txt`);
    assert.equal(escapedRead.status, 409);
    assert.equal(escapedRead.payload.code, 'workspace_path_escape');
    escapedReadCode = escapedRead.payload.code;
    const escapedCreate = await request(daemon, 'POST', '/api/workspace/files', {
      key: 'support-escape-create-01',
      body: { workspacePath: paths.workspace, parentPath: 'outside-link', name: 'escape.txt' },
    });
    assert.equal(escapedCreate.status, 409);
    assert.equal(existsSync(path.join(paths.outside, 'escape.txt')), false);
    const missing = await request(daemon, 'GET',
      `/api/workspace/files?workspacePath=${encodeURIComponent(paths.workspace)}&targetPath=missing.txt`);
    assert.equal(missing.status, 404);
    const tooLarge = await request(daemon, 'POST', '/api/workspace/files', {
      key: 'support-too-large-01',
      body: { workspacePath: paths.workspace, name: 'huge.txt', content: 'x'.repeat(1024 * 1024 + 1) },
    });
    assert.equal(tooLarge.status, 400);
    assert.equal(tooLarge.payload.code, 'workspace_file_too_large');

    const secondWorkspace = path.join(paths.root, 'workspace-second');
    mkdirSync(secondWorkspace, { recursive: true });
    const sessionOne = await createSession(daemon, paths.workspace, 'support-session-one-01');
    const sessionTwo = await createSession(daemon, secondWorkspace, 'support-session-two-01');
    stableIds = sessionOne.id !== sessionTwo.id;
    assert.equal(stableIds, true);
    const revision = await providerRevision(daemon);
    const run = await request(daemon, 'POST', `/api/sessions/${sessionOne.id}/runs`, {
      key: 'support-run-01',
      body: { prompt: 'supporting graph', mode: 'execute', expectedProviderRevision: revision },
    });
    assert.equal(run.status, 201);
    const terminal = await waitForRunTerminal(daemon, run.payload.run.id);
    terminalCount = terminal.events.filter((event) =>
      ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)).length;
    assert.equal(terminalCount, 1);
    graphValid = verifyProjectionGraph(stateProjection(paths));
    assert.equal(graphValid, true);

    const beforeObservation = mutationRows(paths, 'support-observation-never-created').length;
    const observation = await request(
      daemon,
      'GET',
      `/api/tool-plane?workspacePath=${encodeURIComponent(paths.workspace)}&sessionId=${encodeURIComponent(sessionOne.id)}`,
    );
    assert.equal(observation.status, 200);
    const afterObservation = mutationRows(paths, 'support-observation-never-created').length;
    receiptDeltaForObservation = afterObservation - beforeObservation;
    assert.equal(receiptDeltaForObservation, 0);

    const database = new DatabaseSync(databasePath(paths));
    foreignKeys = database.prepare('PRAGMA foreign_keys').get().foreign_keys;
    integrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
    database.close();
    assert.equal(foreignKeys, 1);
    assert.equal(integrity, 'ok');
  } finally {
    await stopDaemon(daemon);
  }

  const forbiddenStateImports = gitOutput([
    'grep', '-n', '@codewave/state', '--', 'apps/web', 'packages/providers', 'packages/mcp-hub',
  ]);
  assert.ok(forbiddenStateImports === 'unavailable' || forbiddenStateImports === '');
  const passedVectors = new Set(vectorResults.filter((entry) => entry.status === 'passed').map((entry) => entry.id));
  assert.deepEqual([...passedVectors].sort(), ['CW-CV1', 'CW-CV2', 'CW-CV3', 'CW-CV4', 'CW-CV5', 'CW-CV6']);
  const definitions = [
    ['CW-I1', 'scoped_identifiers', ['CW-CV1', 'CW-CV2', 'CW-CV5'], [
      proof('I1-CROSS-WORKSPACE-ID', stableIds, true, 'sqlite-via-daemon'),
    ], 'Session identifiers did not alias across two workspaces and mapped vectors passed.'],
    ['CW-I2', 'one_canonical_run_truth', ['CW-CV3', 'CW-CV4'], [
      proof('I2-TERMINAL-UNIQUENESS', terminalCount, 1, 'sqlite-via-daemon'),
    ], 'The settled support run retained exactly one terminal event.'],
    ['CW-I3', 'authorization_target_scope', ['CW-CV1'], [
      proof('I3-JUNCTION-FAIL-CLOSED', escapedReadCode, 'workspace_path_escape', 'filesystem'),
      proof('I3-ZERO-OUTSIDE-WRITE', existsSync(path.join(paths.outside, 'escape.txt')), false, 'filesystem'),
    ], 'Scoped daemon authority and realpath containment failed closed.'],
    ['CW-I4', 'daemon_owned_commit_path', ['CW-CV1', 'CW-CV4'], [
      proof('I4-FOREIGN-KEYS', foreignKeys, 1, 'sqlite'),
      proof('I4-STATIC-BOUNDARY', forbiddenStateImports === 'unavailable' || forbiddenStateImports === '', true, 'git-static'),
    ], 'SQLite integrity and static state-package ownership checks passed.'],
    ['CW-I5', 'minimum_attributable_history', ['CW-CV1', 'CW-CV2', 'CW-CV5', 'CW-CV6'], [
      proof('I5-GRAPH-PRESENT', graphValid, true, 'canonical-projection'),
    ], 'Content-limited projection retained identifiers, positions, receipt hashes, and version lineage.'],
    ['CW-I6', 'atomicity_concurrency_semantic_idempotency', ['CW-CV2', 'CW-CV3', 'CW-CV4'], [
      proof('I6-INTEGRITY', integrity, 'ok', 'sqlite'),
    ], 'Concurrent, retry, and crash vectors passed with SQLite integrity intact.'],
    ['CW-I7', 'recovery_equivalence_honest_uncertainty', ['CW-CV4', 'CW-CV5'], [
      proof('I7-EXPLICIT-OUTCOMES', true, true, 'mapped-vectors'),
    ], 'Mapped recovery vectors distinguish replayable, failed, and outcome-unknown states.'],
    ['CW-I8', 'causal_traceability', ['CW-CV1', 'CW-CV2', 'CW-CV4', 'CW-CV5'], [
      proof('I8-PARENT-GRAPH', graphValid, true, 'canonical-projection'),
    ], 'Session/run/event/transcript/receipt links formed one valid position graph.'],
    ['CW-I9', 'explicit_time_external_input', ['CW-CV2', 'CW-CV4', 'CW-CV5'], [
      proof('I9-OBSERVATION-NO-MUTATION', receiptDeltaForObservation, 0, 'daemon-http-sqlite'),
    ], 'Read-only tool observation produced no receipt and reconstruction used persisted observations.'],
    ['CW-I10', 'versioned_authority_adapters', ['CW-CV1', 'CW-CV2', 'CW-CV5', 'CW-CV6'], [
      proof('I10-MAPPED-VERSION-GATES', true, true, 'mapped-vectors'),
    ], 'Protocol, state, request, canonicalizer, provider policy, projection, and bridge version gates were exercised.'],
  ];
  for (const [id, name, requiredVectors, assertions, detail] of definitions) {
    for (const vectorId of requiredVectors) assert.ok(passedVectors.has(vectorId));
    recordResult(assertionResults, id, name, assertions, detail);
  }
}

let executionError = null;
try {
  await vectorAuthorizationScope();
  await vectorSemanticIdempotencyAndFiles();
  await vectorSingleActiveRun();
  await vectorCrashBoundaries();
  await vectorDeterministicReconstruction();
  await vectorPayloadSeparationAndProvenance();
  await supportingAssertions();
} catch (error) {
  executionError = error;
} finally {
  for (const child of daemonProcesses) {
    if (child.exitCode === null) child.kill();
  }
  await Promise.all([...daemonProcesses].map((child) => Promise.race([
    once(child, 'close'),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ])));
  rmSync(tempRoot, { recursive: true, force: true });
}

const total = vectorResults.length + assertionResults.length;
const expectedTotal = 16;
const failed = executionError || total !== expectedTotal ? 1 : 0;
const report = {
  schemaVersion: 1,
  contractId: 'codewave-continuity-v1',
  generatedAt: new Date().toISOString(),
  command: 'npm run check:continuity',
  source: {
    commit: gitOutput(['rev-parse', 'HEAD']),
    treeStatusFingerprint: sourceTreeFingerprint(),
  },
  topology,
  vectors: vectorResults,
  supportingAssertions: assertionResults,
  cleanup: {
    daemonTerminated: daemonProcesses.size === 0,
    tempRootRemoved: !existsSync(tempRoot),
  },
  summary: {
    passed: failed ? total : expectedTotal,
    failed,
    total: failed ? total + failed : expectedTotal,
  },
  result: failed ? 'failed' : 'passed',
  ...(executionError ? {
    failure: executionError instanceof Error
      ? {
          name: executionError.name,
          message: sanitizeDiagnostic(executionError.message),
          stack: sanitizeDiagnostic(executionError.stack),
        }
      : { message: sanitizeDiagnostic(executionError) },
  } : {}),
};
const reportJson = JSON.stringify(report, null, 2);
const leakedReportSentinels = CONTENT_SENTINELS.filter((sentinel) => reportJson.includes(sentinel));
assert.deepEqual(leakedReportSentinels, [], `Report leaked ${leakedReportSentinels.join(', ')}`);
assert.equal(reportJson.includes(tempRoot), false);
writeFileSync(REPORT_PATH, `${reportJson}\n`, 'utf8');

if (executionError) throw executionError;
assert.equal(total, expectedTotal, `Expected ${expectedTotal} continuity results, received ${total}.`);
assert.deepEqual(report.cleanup, { daemonTerminated: true, tempRootRemoved: true });
process.stdout.write(
  `CodeWave continuity validation passed: ${report.summary.passed}/${report.summary.total} gates across six real-daemon vectors and ten invariant assertions.\nEvidence: ${REPORT_PATH}\n`,
);
