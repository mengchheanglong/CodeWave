import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const DAEMON_ENTRY = path.join(REPO_ROOT, 'apps', 'daemon', 'src', 'index.ts');
const FREEBUFF_FIXTURE = path.join(
  SCRIPT_DIR,
  'fixtures',
  'fake-freebuff-bridge.mjs',
);

for (const requiredPath of [TSX_CLI, DAEMON_ENTRY, FREEBUFF_FIXTURE]) {
  if (!existsSync(requiredPath)) throw new Error(`Missing required file: ${requiredPath}`);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'codewave-harness-'));
const daemonRoot = path.join(tempRoot, 'daemon-root');
const workspacePath = path.join(tempRoot, 'workspace');
mkdirSync(daemonRoot, { recursive: true });
mkdirSync(workspacePath, { recursive: true });
const legacyDatabaseDirectory = path.join(daemonRoot, '.codewave');
mkdirSync(legacyDatabaseDirectory, { recursive: true });
const legacyDatabase = new DatabaseSync(
  path.join(legacyDatabaseDirectory, 'state.sqlite'),
);
legacyDatabase.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    workspace_path TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    approval_policy TEXT NOT NULL DEFAULT 'manual'
  );
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'execute',
    pre_run_commit TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT
  );
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
  INSERT INTO sessions (
    id, workspace_path, provider_id, created_at, approval_policy
  ) VALUES (
    'legacy-session', '${workspacePath.replaceAll("'", "''")}', 'freebuff',
    '2026-01-01T00:00:00.000Z', 'manual'
  );
  INSERT INTO runs (
    id, session_id, provider_id, prompt, status, mode, created_at,
    started_at, completed_at
  ) VALUES (
    'legacy-run', 'legacy-session', 'freebuff', 'legacy migration',
    'completed', 'execute', '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:02.000Z'
  );
  INSERT INTO events (
    id, session_id, run_id, timestamp, source, type, payload_json
  ) VALUES
    ('legacy-event-a', 'legacy-session', 'legacy-run',
     '2026-01-01T00:00:01.000Z', 'system', 'run.started', '{}'),
    ('legacy-event-message', 'legacy-session', 'legacy-run',
     '2026-01-01T00:00:02.000Z', 'freebuff', 'message.created',
     '{"role":"assistant","content":"legacy answer"}'),
    ('legacy-event-b', 'legacy-session', 'legacy-run',
     '2026-01-01T00:00:03.000Z', 'system', 'run.completed', '{}');
`);
legacyDatabase.close();
const port = 5000 + Math.floor(Math.random() * 700);
const baseUrl = `http://127.0.0.1:${port}`;
const command = `"${process.execPath}" "${FREEBUFF_FIXTURE}"`;
const daemonLogs = [];
let daemon = null;
let connectionId = null;
const ALL_CLIENT_SCOPES = [
  'runtime:read',
  'providers:read',
  'providers:write',
  'sessions:read',
  'sessions:write',
  'runs:read',
  'runs:write',
  'orchestration:read',
  'orchestration:write',
  'tools:read',
  'workspace:read',
  'workspace:write',
  'approvals:write',
];

function startDaemon() {
  const child = spawn(process.execPath, [TSX_CLI, DAEMON_ENTRY], {
    cwd: daemonRoot,
    env: {
      ...process.env,
      CODEWAVE_PORT: String(port),
      CODEWAVE_FREEBUFF_COMMAND: command,
      CODEWAVE_OPENCODE_ENABLED: 'false',
      CODEWAVE_QWEN_ENABLED: 'false',
      CODEWAVE_GEMINI_ENABLED: 'false',
      CODEWAVE_FAKE_FREEBUFF_DELAY_MS: '350',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    daemonLogs.push(`[stdout] ${text.trimEnd()}`);
  });
  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    daemonLogs.push(`[stderr] ${text.trimEnd()}`);
  });
  return child;
}

async function stopDaemon() {
  if (!daemon || daemon.exitCode !== null) return;
  daemon.kill();
  await Promise.race([
    once(daemon, 'close'),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);
}

async function request(
  method,
  pathname,
  { body, key, skipConnection = false, connectionIdOverride } = {},
) {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (key) headers.set('Idempotency-Key', key);
  const requestConnectionId =
    connectionIdOverride === undefined ? connectionId : connectionIdOverride;
  if (!skipConnection && requestConnectionId) {
    headers.set('X-CodeWave-Connection', requestConnectionId);
  }
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    replayed: response.headers.get('idempotency-replayed') === 'true',
    pending: response.headers.get('idempotency-pending') === 'true',
    payload: text ? JSON.parse(text) : null,
  };
}

async function negotiateClient(requestedScopes = ALL_CLIENT_SCOPES) {
  const handshake = await request('POST', '/api/handshake', {
    skipConnection: true,
    body: {
      clientName: 'daemon-harness',
      clientVersion: '1.0.0-test',
      protocolVersion: 1,
      requestedScopes,
    },
  });
  assert.equal(handshake.status, 201);
  connectionId = handshake.payload.connectionId;
  return handshake.payload;
}

async function readSseEvents(pathname, expectedCount, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      signal: controller.signal,
      headers: connectionId
        ? { 'X-CodeWave-Connection': connectionId }
        : undefined,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-codewave-replay-limit'), '500');
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events = [];
    let buffer = '';

    while (events.length < expectedCount) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true }).replaceAll('\r\n', '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const id = frame
          .split('\n')
          .find((line) => line.startsWith('id: '))
          ?.slice(4);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n');
        if (data) events.push({ id, event: JSON.parse(data) });
        boundary = buffer.indexOf('\n\n');
      }
    }

    await reader.cancel();
    assert.equal(events.length, expectedCount);
    return events;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function waitForHealth(timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await request('GET', '/api/health');
      if (result.status === 200 && result.payload?.ok === true) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Daemon health check did not succeed within ${timeoutMs}ms.`);
}

async function waitForSteeredRuns(sessionId, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const session = await request('GET', `/api/sessions/${sessionId}`);
    if (
      session.status === 200 &&
      session.payload.runs.length === 2 &&
      session.payload.runs.every((run) => run.status === 'completed')
    ) {
      return session.payload.runs;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Queued steering did not create and complete its follow-up run.');
}

async function waitForSingleTerminalRun(sessionId, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const session = await request('GET', `/api/sessions/${sessionId}`);
    if (
      session.status === 200 &&
      session.payload.runs.length === 1 &&
      ['completed', 'failed', 'cancelled'].includes(
        session.payload.runs[0].status,
      )
    ) {
      return session.payload.runs[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Concurrent launch winner did not settle in time.');
}

async function waitForTerminalRunCount(sessionId, expectedCount, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const session = await request('GET', `/api/sessions/${sessionId}`);
    if (
      session.status === 200 &&
      session.payload.runs.length === expectedCount &&
      session.payload.runs.every((run) =>
        ['completed', 'failed', 'cancelled'].includes(run.status),
      )
    ) {
      return session.payload.runs;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Session ${sessionId} did not settle ${expectedCount} runs within ${timeoutMs}ms.`,
  );
}

try {
  daemon = startDaemon();
  await waitForHealth();

  const unauthorizedRuntime = await request('GET', '/api/runtime', {
    skipConnection: true,
  });
  assert.equal(unauthorizedRuntime.status, 401);
  assert.equal(unauthorizedRuntime.payload.code, 'client_handshake_required');
  assert.equal(unauthorizedRuntime.payload.requiredScope, 'runtime:read');
  const incompatibleHandshake = await request('POST', '/api/handshake', {
    skipConnection: true,
    body: {
      clientName: 'future-client',
      clientVersion: '99.0.0',
      protocolVersion: 99,
      requestedScopes: ['runtime:read'],
    },
  });
  assert.equal(incompatibleHandshake.status, 426);
  assert.equal(
    incompatibleHandshake.payload.code,
    'protocol_version_unsupported',
  );
  assert.deepEqual(incompatibleHandshake.payload.supportedProtocolVersions, [1]);
  const handshake = await negotiateClient();
  assert.equal(handshake.protocolVersion, 1);
  assert.ok(handshake.capabilities.includes('scoped-handshake'));
  assert.ok(handshake.capabilities.includes('append-only-transcripts'));
  assert.deepEqual(handshake.grantedScopes, ALL_CLIENT_SCOPES);
  assert.equal(handshake.limits.maxRequestBytes, 2 * 1024 * 1024);
  assert.equal(handshake.limits.maxSseReplayEvents, 500);
  assert.equal(handshake.limits.defaultTranscriptMessages, 100);
  assert.equal(handshake.limits.maxTranscriptMessages, 200);
  const initialRuntime = await request('GET', '/api/runtime');
  assert.equal(initialRuntime.status, 200);
  assert.equal(
    initialRuntime.payload.providers.find(
      (provider) => provider.providerId === 'freebuff',
    )?.capabilities.inFlightSteering,
    'runtime-negotiated',
  );

  const readOnlyHandshake = await request('POST', '/api/handshake', {
    skipConnection: true,
    body: {
      clientName: 'read-only-harness',
      clientVersion: '1.0.0-test',
      protocolVersion: 1,
      requestedScopes: ['runtime:read'],
    },
  });
  assert.equal(readOnlyHandshake.status, 201);
  const deniedProviderRead = await request('GET', '/api/providers', {
    connectionIdOverride: readOnlyHandshake.payload.connectionId,
  });
  assert.equal(deniedProviderRead.status, 403);
  assert.equal(deniedProviderRead.payload.code, 'client_scope_required');
  assert.equal(deniedProviderRead.payload.requiredScope, 'providers:read');

  const migratedLegacyRun = await request('GET', '/api/runs/legacy-run');
  assert.equal(migratedLegacyRun.status, 200);
  assert.equal(
    migratedLegacyRun.payload.run.providerConfigurationRevision,
    'legacy-unversioned',
  );
  const migratedLegacySession = await request(
    'GET',
    '/api/sessions/legacy-session',
  );
  assert.equal(
    migratedLegacySession.payload.session.providerConfigurationRevision,
    'legacy-unversioned',
  );
  assert.deepEqual(
    migratedLegacyRun.payload.events.map((event) => event.sequence),
    [1, 2, 3],
  );
  assert.deepEqual(
    migratedLegacyRun.payload.transcript.messages.map((message) => ({
      sequence: message.sequence,
      parentMessageId: message.parentMessageId,
      role: message.role,
      content: message.content,
      sourceEventId: message.sourceEventId,
    })),
    [
      {
        sequence: 1,
        parentMessageId: null,
        role: 'user',
        content: 'legacy migration',
        sourceEventId: null,
      },
      {
        sequence: 2,
        parentMessageId: 'transcript:run:legacy-run:prompt',
        role: 'assistant',
        content: 'legacy answer',
        sourceEventId: 'legacy-event-message',
      },
    ],
  );

  const initialProviders = await request('GET', '/api/providers');
  assert.equal(initialProviders.status, 200);
  assert.match(initialProviders.payload.revision, /^sha256:[a-f0-9]{64}$/);
  const initialProviderRevision = initialProviders.payload.revision;
  const sessionKey = 'session-create-0001';
  const sessionBody = {
    workspacePath,
    providerId: 'freebuff',
    expectedProviderRevision: initialProviderRevision,
    approvalPolicy: 'manual',
  };
  const createdSession = await request('POST', '/api/sessions', {
    key: sessionKey,
    body: sessionBody,
  });
  assert.equal(createdSession.status, 201);
  const replayedSession = await request('POST', '/api/sessions', {
    key: sessionKey,
    body: {
      approvalPolicy: 'manual',
      providerId: 'freebuff',
      expectedProviderRevision: initialProviderRevision,
      workspacePath,
    },
  });
  assert.equal(replayedSession.status, 201);
  assert.equal(replayedSession.replayed, true);
  assert.equal(replayedSession.payload.id, createdSession.payload.id);

  const conflictingMutation = await request('POST', '/api/sessions', {
    key: sessionKey,
    body: { ...sessionBody, workspacePath: `${workspacePath}-different` },
  });
  assert.equal(conflictingMutation.status, 409);
  assert.equal(
    createdSession.payload.providerConfigurationRevision,
    initialProviderRevision,
  );

  const runKey = 'run-start-00000001';
  const startedRun = await request(
    'POST',
    `/api/sessions/${createdSession.payload.id}/runs`,
    {
      key: runKey,
      body: {
        prompt: 'first task',
        mode: 'execute',
        expectedProviderRevision: initialProviderRevision,
      },
    },
  );
  assert.equal(startedRun.status, 201);
  const runId = startedRun.payload.run.id;
  const replayedRun = await request(
    'POST',
    `/api/sessions/${createdSession.payload.id}/runs`,
    {
      key: runKey,
      body: {
        mode: 'execute',
        prompt: 'first task',
        expectedProviderRevision: initialProviderRevision,
      },
    },
  );
  assert.equal(replayedRun.status, 201);
  assert.equal(replayedRun.replayed, true);
  assert.equal(replayedRun.payload.run.id, runId);

  const overlappingRun = await request(
    'POST',
    `/api/sessions/${createdSession.payload.id}/runs`,
    {
      key: 'run-overlap-00001',
      body: {
        prompt: 'must not overlap',
        mode: 'execute',
        expectedProviderRevision: initialProviderRevision,
      },
    },
  );
  assert.equal(overlappingRun.status, 409);

  const steeringKey = 'run-steer-00000001';
  const steering = await request('POST', `/api/runs/${runId}/steer`, {
    key: steeringKey,
    body: {
      prompt: 'apply this queued update',
      expectedRunId: runId,
      expectedProviderRevision: initialProviderRevision,
    },
  });
  assert.equal(steering.status, 202);
  assert.equal(steering.payload.delivery, 'queued');
  const replayedSteering = await request('POST', `/api/runs/${runId}/steer`, {
    key: steeringKey,
    body: {
      expectedRunId: runId,
      prompt: 'apply this queued update',
      expectedProviderRevision: initialProviderRevision,
    },
  });
  assert.equal(replayedSteering.status, 202);
  assert.equal(replayedSteering.replayed, true);
  assert.equal(replayedSteering.payload.steering.id, steering.payload.steering.id);

  const orderedSteering = await request('POST', `/api/runs/${runId}/steer`, {
    key: 'run-steer-00000002',
    body: {
      prompt: 'and preserve ordering',
      expectedRunId: runId,
      expectedProviderRevision: initialProviderRevision,
    },
  });
  assert.equal(orderedSteering.status, 202);
  assert.equal(orderedSteering.payload.delivery, 'queued');

  const runs = await waitForSteeredRuns(createdSession.payload.id);
  const followUpRun = runs.find((run) => run.id !== runId);
  const expectedFollowUpPrompt =
    'apply this queued update\n\nand preserve ordering';
  assert.equal(followUpRun?.prompt, expectedFollowUpPrompt);
  assert.equal(
    followUpRun?.providerConfigurationRevision,
    initialProviderRevision,
  );
  const followUpSnapshot = await request('GET', `/api/runs/${followUpRun.id}`);
  assert.ok(
    followUpSnapshot.payload.artifacts.some((artifact) =>
      artifact.content.includes(expectedFollowUpPrompt),
    ),
  );
  const updatedSession = await request(
    'GET',
    `/api/sessions/${createdSession.payload.id}`,
  );
  assert.equal(updatedSession.payload.session.providerSessionId, 'fake-freebuff-session');
  const completedTarget = await request('GET', `/api/runs/${runId}`);
  assert.equal(completedTarget.payload.steering.length, 2);
  assert.deepEqual(
    completedTarget.payload.steering.map((input) => input.prompt),
    ['apply this queued update', 'and preserve ordering'],
  );
  assert.ok(
    completedTarget.payload.steering.every(
      (input) =>
        input.status === 'applied' && input.appliedRunId === followUpRun.id,
    ),
  );
  assert.ok(
    completedTarget.payload.events.some(
      (event) => event.type === 'run.steering.applied',
    ),
  );
  assert.ok(
    completedTarget.payload.events.some(
      (event) => event.type === 'tool.completed',
    ),
  );
  assert.deepEqual(
    completedTarget.payload.events.map((event) => event.sequence),
    completedTarget.payload.events.map((_, index) => index + 1),
  );
  assert.deepEqual(
    followUpSnapshot.payload.events.map((event) => event.sequence),
    followUpSnapshot.payload.events.map((_, index) => index + 1),
  );
  const transcriptPage = await request(
    'GET',
    `/api/sessions/${createdSession.payload.id}/transcript?limit=3`,
  );
  assert.equal(transcriptPage.status, 200);
  assert.equal(transcriptPage.payload.totalCount, 4);
  assert.equal(transcriptPage.payload.hasMoreBefore, true);
  assert.deepEqual(
    transcriptPage.payload.messages.map((message) => message.sequence),
    [2, 3, 4],
  );
  assert.equal(
    transcriptPage.payload.messages[0].parentMessageId,
    `transcript:run:${runId}:prompt`,
  );
  assert.deepEqual(
    transcriptPage.payload.messages.map((message) => message.role),
    ['assistant', 'user', 'assistant'],
  );
  const olderTranscriptPage = await request(
    'GET',
    `/api/sessions/${createdSession.payload.id}/transcript?before=2&limit=3`,
  );
  assert.equal(olderTranscriptPage.status, 200);
  assert.equal(olderTranscriptPage.payload.hasMoreBefore, false);
  assert.deepEqual(
    olderTranscriptPage.payload.messages.map((message) => message.sequence),
    [1],
  );
  assert.equal(
    olderTranscriptPage.payload.messages[0].content,
    'first task',
  );
  assert.equal(followUpSnapshot.payload.transcript.totalCount, 4);
  const invalidTranscriptCursor = await request(
    'GET',
    `/api/sessions/${createdSession.payload.id}/transcript?before=zero`,
  );
  assert.equal(invalidTranscriptCursor.status, 400);
  const lastTargetEvent = completedTarget.payload.events.at(-1);
  const replayedEvents = await readSseEvents(
    `/api/runs/${runId}/stream?after=${lastTargetEvent.sequence - 1}`,
    1,
  );
  assert.equal(replayedEvents[0].id, String(lastTargetEvent.sequence));
  assert.equal(replayedEvents[0].event.id, lastTargetEvent.id);
  assert.equal(replayedEvents[0].event.sequence, lastTargetEvent.sequence);
  const invalidCursor = await request(
    'GET',
    `/api/runs/${runId}/stream?after=not-a-sequence`,
  );
  assert.equal(invalidCursor.status, 400);
  assert.equal(completedTarget.payload.checkpoints.length, 1);
  assert.ok(completedTarget.payload.artifacts.length >= 1);

  const nativeSession = await request('POST', '/api/sessions', {
    key: 'native-steering-session-01',
    body: sessionBody,
  });
  assert.equal(nativeSession.status, 201);
  const nativeRun = await request(
    'POST',
    `/api/sessions/${nativeSession.payload.id}/runs`,
    {
      key: 'native-steering-run-0001',
      body: {
        prompt: '[native-steering] capability-proven run',
        mode: 'execute',
        expectedProviderRevision: initialProviderRevision,
      },
    },
  );
  assert.equal(nativeRun.status, 201);
  const nativeRunId = nativeRun.payload.run.id;
  const nativeSteeringBody = {
    prompt: 'apply this at the next safe model boundary',
    expectedRunId: nativeRunId,
    expectedProviderRevision: initialProviderRevision,
  };
  const nativeSteering = await request(
    'POST',
    `/api/runs/${nativeRunId}/steer`,
    {
      key: 'native-steering-input-01',
      body: nativeSteeringBody,
    },
  );
  assert.equal(nativeSteering.status, 202);
  assert.equal(nativeSteering.payload.delivery, 'native');
  assert.equal(nativeSteering.payload.steering.status, 'applied');
  assert.equal(nativeSteering.payload.steering.appliedRunId, nativeRunId);
  const replayedNativeSteering = await request(
    'POST',
    `/api/runs/${nativeRunId}/steer`,
    {
      key: 'native-steering-input-01',
      body: nativeSteeringBody,
    },
  );
  assert.equal(replayedNativeSteering.replayed, true);
  assert.equal(replayedNativeSteering.payload.delivery, 'native');
  await waitForTerminalRunCount(nativeSession.payload.id, 1);
  const nativeSnapshot = await request('GET', `/api/runs/${nativeRunId}`);
  assert.ok(
    nativeSnapshot.payload.events.some(
      (event) =>
        event.type === 'run.steering.applied' &&
        event.payload.delivery === 'native' &&
        event.payload.appliedRunId === nativeRunId,
    ),
  );
  assert.ok(
    nativeSnapshot.payload.artifacts.some((artifact) =>
      artifact.content.includes('steered: apply this at the next safe model boundary'),
    ),
  );

  const rejectedSession = await request('POST', '/api/sessions', {
    key: 'rejected-steering-session-01',
    body: sessionBody,
  });
  const rejectedRun = await request(
    'POST',
    `/api/sessions/${rejectedSession.payload.id}/runs`,
    {
      key: 'rejected-steering-run-01',
      body: {
        prompt: '[native-steering] rejection fallback run',
        mode: 'execute',
        expectedProviderRevision: initialProviderRevision,
      },
    },
  );
  const rejectedRunId = rejectedRun.payload.run.id;
  const rejectedSteering = await request(
    'POST',
    `/api/runs/${rejectedRunId}/steer`,
    {
      key: 'rejected-steering-input-01',
      body: {
        prompt: '[reject] preserve this as a follow-up',
        expectedRunId: rejectedRunId,
        expectedProviderRevision: initialProviderRevision,
      },
    },
  );
  assert.equal(rejectedSteering.payload.delivery, 'queued');
  const rejectedRuns = await waitForTerminalRunCount(rejectedSession.payload.id, 2);
  const rejectedFollowUp = rejectedRuns.find((run) => run.id !== rejectedRunId);
  const rejectedSnapshot = await request('GET', `/api/runs/${rejectedRunId}`);
  assert.equal(rejectedSnapshot.payload.steering[0].status, 'applied');
  assert.equal(
    rejectedSnapshot.payload.steering[0].appliedRunId,
    rejectedFollowUp.id,
  );

  const terminalRaceSession = await request('POST', '/api/sessions', {
    key: 'terminal-race-session-0001',
    body: sessionBody,
  });
  const terminalRaceRun = await request(
    'POST',
    `/api/sessions/${terminalRaceSession.payload.id}/runs`,
    {
      key: 'terminal-race-run-0001',
      body: {
        prompt: '[native-steering] [terminal-before-ack] terminal race run',
        mode: 'execute',
        expectedProviderRevision: initialProviderRevision,
      },
    },
  );
  const terminalRaceRunId = terminalRaceRun.payload.run.id;
  const terminalRaceSteering = await request(
    'POST',
    `/api/runs/${terminalRaceRunId}/steer`,
    {
      key: 'terminal-race-steering-01',
      body: {
        prompt: 'recover this unacknowledged update',
        expectedRunId: terminalRaceRunId,
        expectedProviderRevision: initialProviderRevision,
      },
    },
  );
  assert.equal(terminalRaceSteering.payload.delivery, 'queued');
  const terminalRaceRuns = await waitForTerminalRunCount(
    terminalRaceSession.payload.id,
    2,
  );
  const terminalRaceFollowUp = terminalRaceRuns.find(
    (run) => run.id !== terminalRaceRunId,
  );
  const terminalRaceSnapshot = await request(
    'GET',
    `/api/runs/${terminalRaceRunId}`,
  );
  assert.equal(
    terminalRaceSnapshot.payload.steering[0].appliedRunId,
    terminalRaceFollowUp.id,
  );

  const changedPolicy = await request('PATCH', '/api/providers/qwen', {
    key: 'provider-policy-change-01',
    body: {
      priority: 31,
      expectedProviderRevision: initialProviderRevision,
    },
  });
  assert.equal(changedPolicy.status, 200);
  assert.notEqual(changedPolicy.payload.revision, initialProviderRevision);
  const currentProviderRevision = changedPolicy.payload.revision;
  const staleSession = await request('POST', '/api/sessions', {
    key: 'stale-session-create-01',
    body: {
      ...sessionBody,
      workspacePath: `${workspacePath}-stale-policy`,
    },
  });
  assert.equal(staleSession.status, 409);
  assert.equal(staleSession.payload.code, 'provider_revision_conflict');
  assert.equal(
    staleSession.payload.currentProviderRevision,
    currentProviderRevision,
  );

  const raceSession = await request('POST', '/api/sessions', {
    key: 'race-session-create-01',
    body: {
      ...sessionBody,
      expectedProviderRevision: currentProviderRevision,
    },
  });
  assert.equal(raceSession.status, 201);
  const concurrentLaunches = await Promise.all([
    request('POST', `/api/sessions/${raceSession.payload.id}/runs`, {
      key: 'race-run-launch-0001',
      body: {
        prompt: 'concurrent launch alpha',
        mode: 'execute',
        expectedProviderRevision: currentProviderRevision,
      },
    }),
    request('POST', `/api/sessions/${raceSession.payload.id}/runs`, {
      key: 'race-run-launch-0002',
      body: {
        prompt: 'concurrent launch beta',
        mode: 'execute',
        expectedProviderRevision: currentProviderRevision,
      },
    }),
  ]);
  assert.deepEqual(
    concurrentLaunches.map((result) => result.status).sort(),
    [201, 409],
  );
  await waitForSingleTerminalRun(raceSession.payload.id);

  const heldSession = await request('POST', '/api/sessions', {
    key: 'held-session-0001',
    body: {
      ...sessionBody,
      expectedProviderRevision: currentProviderRevision,
    },
  });
  const heldRun = await request(
    'POST',
    `/api/sessions/${heldSession.payload.id}/runs`,
    {
      key: 'held-run-start-01',
      body: {
        prompt: '[hold] survive restart audit',
        mode: 'execute',
        expectedProviderRevision: currentProviderRevision,
      },
    },
  );
  assert.equal(heldRun.status, 201);
  const restartQueuedSteering = await request(
    'POST',
    `/api/runs/${heldRun.payload.run.id}/steer`,
    {
      key: 'restart-steering-input-01',
      body: {
        prompt: 'resume this durable update after restart',
        expectedRunId: heldRun.payload.run.id,
        expectedProviderRevision: currentProviderRevision,
      },
    },
  );
  assert.equal(restartQueuedSteering.payload.delivery, 'queued');
  await stopDaemon();

  daemon = startDaemon();
  await waitForHealth();
  const invalidatedConnection = await request('GET', '/api/runtime');
  assert.equal(invalidatedConnection.status, 401);
  assert.equal(invalidatedConnection.payload.code, 'client_connection_invalid');
  await negotiateClient();
  const restartedProviders = await request('GET', '/api/providers');
  assert.equal(restartedProviders.payload.revision, currentProviderRevision);
  const interrupted = await request('GET', `/api/runs/${heldRun.payload.run.id}`);
  assert.equal(interrupted.payload.run.status, 'failed');
  assert.equal(interrupted.payload.run.errorMessage, 'Interrupted by daemon restart.');
  assert.ok(
    interrupted.payload.events.some(
      (event) =>
        event.type === 'run.failed' && event.payload?.code === 'daemon_restart',
    ),
  );
  const restartRecoveredRuns = await waitForTerminalRunCount(
    heldSession.payload.id,
    2,
  );
  const restartFollowUp = restartRecoveredRuns.find(
    (run) => run.id !== heldRun.payload.run.id,
  );
  const restartTarget = await request(
    'GET',
    `/api/runs/${heldRun.payload.run.id}`,
  );
  assert.equal(restartTarget.payload.steering[0].status, 'applied');
  assert.equal(
    restartTarget.payload.steering[0].appliedRunId,
    restartFollowUp.id,
  );
  const restartedTranscript = await request(
    'GET',
    `/api/sessions/${createdSession.payload.id}/transcript`,
  );
  assert.equal(restartedTranscript.payload.totalCount, 4);
  assert.deepEqual(
    restartedTranscript.payload.messages.map((message) => message.sequence),
    [1, 2, 3, 4],
  );

  const durableReplay = await request('POST', '/api/sessions', {
    key: sessionKey,
    body: sessionBody,
  });
  assert.equal(durableReplay.status, 201);
  assert.equal(durableReplay.replayed, true);
  assert.equal(durableReplay.payload.id, createdSession.payload.id);

  await stopDaemon();
  const pendingKey = 'pending-reservation-01';
  const operation = 'POST /api/sessions';
  const requestHash = createHash('sha256')
    .update(operation)
    .update('\0')
    .update(stableJson(sessionBody))
    .digest('hex');
  const database = new DatabaseSync(
    path.join(daemonRoot, '.codewave', 'state.sqlite'),
  );
  database
    .prepare(
      `INSERT INTO mutation_receipts (idempotency_key, operation, request_hash, status_code, response_json, created_at)
       VALUES (?, ?, ?, 0, '', ?)`,
    )
    .run(pendingKey, operation, requestHash, new Date().toISOString());
  database.close();

  daemon = startDaemon();
  await waitForHealth();
  await negotiateClient();
  const pendingReplay = await request('POST', '/api/sessions', {
    key: pendingKey,
    body: sessionBody,
  });
  assert.equal(pendingReplay.status, 409);
  assert.equal(pendingReplay.pending, true);
  assert.match(pendingReplay.payload.error, /will not execute it again/);
  assert.ok(
    !daemonLogs.some((entry) => entry.includes('[DEP0190]')),
    'Freebuff bridge launch should not route quoted executable arguments through a shell.',
  );

  process.stdout.write(
    'Daemon harness validation passed: versioned scoped handshakes, restart renegotiation, capability/limit discovery, append-only parent-linked transcript migration/pagination/restart hydration, durable idempotency reservations/replay, provider-policy revision fencing, stable policy revisions, concurrent single-active-run enforcement, capability-proven native steering, rejection and terminal-race fallback, ordered queued steering, cursor-bounded SSE replay, and restart recovery.\n',
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${message}\n\nDaemon log tail:\n${daemonLogs.slice(-80).join('\n')}`);
} finally {
  await stopDaemon();
  rmSync(tempRoot, { recursive: true, force: true });
}
