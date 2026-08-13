import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
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
const OBSERVE_ONLY = process.argv.includes('--observe');
const EVIDENCE_DIRECTORY = process.env.CODEWAVE_QA_EVIDENCE_DIRECTORY
  ? path.resolve(process.env.CODEWAVE_QA_EVIDENCE_DIRECTORY)
  : path.join(REPO_ROOT, '.codewave', 'qa', 'daemon-adversarial');

for (const requiredPath of [TSX_CLI, DAEMON_ENTRY, FREEBUFF_FIXTURE]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Missing required file: ${requiredPath}`);
  }
}

mkdirSync(EVIDENCE_DIRECTORY, { recursive: true });
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'codewave-adversarial-'));
const daemonRoot = path.join(tempRoot, 'daemon-root');
const workspacePath = path.join(tempRoot, 'workspace');
const outsidePath = path.join(tempRoot, 'outside');
mkdirSync(daemonRoot, { recursive: true });
mkdirSync(workspacePath, { recursive: true });
mkdirSync(outsidePath, { recursive: true });

const port = 5700 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;
const command = `"${process.execPath}" "${FREEBUFF_FIXTURE}"`;
const daemonLogs = [];
const observations = [];
let daemon = null;
let connectionId = null;
let providerRevision = null;

const ALL_SCOPES = [
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

function record(name, expected, actual, detail = null) {
  const passed = typeof expected === 'function' ? expected(actual) : actual === expected;
  observations.push({ name, passed, expected: String(expected), actual, detail });
  if (!OBSERVE_ONLY) {
    assert.equal(passed, true, `${name}: expected ${String(expected)}, received ${JSON.stringify(actual)}`);
  }
}

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
      CODEWAVE_FAKE_FREEBUFF_DELAY_MS: '120',
      CODEWAVE_FAKE_FREEBUFF_HOLD_MS: '3500',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => daemonLogs.push(`[stdout] ${chunk.toString().trimEnd()}`));
  child.stderr?.on('data', (chunk) => daemonLogs.push(`[stderr] ${chunk.toString().trimEnd()}`));
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

async function rawRequest(
  method,
  pathname,
  { body, rawBody, key, connection = connectionId, headers: extraHeaders = {} } = {},
) {
  const headers = new Headers(extraHeaders);
  if (body !== undefined || rawBody !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (key) headers.set('Idempotency-Key', key);
  if (connection) headers.set('X-CodeWave-Connection', connection);
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    replayed: response.headers.get('idempotency-replayed') === 'true',
    pending: response.headers.get('idempotency-pending') === 'true',
    payload,
  };
}

async function requestWithHost(pathname, host) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method: 'GET',
        headers: { Host: host },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({ status: response.statusCode, body });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

async function requestWithoutHost(pathname) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method: 'GET',
        setHost: false,
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve({ status: response.statusCode }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

async function waitForHealth(timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await rawRequest('GET', '/api/health', { connection: null });
      if (result.status === 200 && result.payload?.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error('Daemon did not become healthy.');
}

async function negotiate(scopes = ALL_SCOPES) {
  const result = await rawRequest('POST', '/api/handshake', {
    connection: null,
    body: {
      clientName: 'daemon-adversarial-harness',
      clientVersion: '1.0.0-test',
      protocolVersion: 1,
      requestedScopes: scopes,
    },
  });
  assert.equal(result.status, 201);
  connectionId = result.payload.connectionId;
  return result.payload;
}

async function getRevision() {
  const result = await rawRequest('GET', '/api/providers');
  assert.equal(result.status, 200);
  providerRevision = result.payload.revision;
  return providerRevision;
}

async function createSession(suffix, workspace = workspacePath) {
  const result = await rawRequest('POST', '/api/sessions', {
    key: `adversarial-session-${suffix}`,
    body: {
      workspacePath: workspace,
      providerId: 'freebuff',
      approvalPolicy: 'manual',
      expectedProviderRevision: providerRevision,
    },
  });
  assert.equal(result.status, 201);
  return result.payload;
}

async function startRun(sessionId, suffix, prompt) {
  return rawRequest('POST', `/api/sessions/${sessionId}/runs`, {
    key: `adversarial-run-${suffix}`,
    body: {
      prompt,
      mode: 'execute',
      expectedProviderRevision: providerRevision,
    },
  });
}

async function waitForTerminal(sessionId, expectedRuns = 1, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await rawRequest('GET', `/api/sessions/${sessionId}`);
    if (
      result.status === 200 &&
      result.payload.runs.length === expectedRuns &&
      result.payload.runs.every((run) => ['completed', 'failed', 'cancelled'].includes(run.status))
    ) {
      return result.payload.runs;
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Session ${sessionId} did not settle ${expectedRuns} run(s).`);
}

async function readSsePage(
  runId,
  after,
  { timeoutMs = 1000, stopAfter = Infinity, lastEventId } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const events = [];
  let closed = false;
  try {
    const response = await fetch(`${baseUrl}/api/runs/${runId}/stream?after=${after}`, {
      headers: {
        'X-CodeWave-Connection': connectionId,
        ...(lastEventId === undefined ? {} : { 'Last-Event-ID': String(lastEventId) }),
      },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (events.length < stopAfter) {
      const chunk = await reader.read();
      if (chunk.done) {
        closed = true;
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true }).replaceAll('\r\n', '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n');
        if (data) events.push(JSON.parse(data));
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (events.length >= stopAfter) await reader.cancel();
  } catch (error) {
    if (error?.name !== 'AbortError') throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { events, closed };
}

function openDatabase() {
  return new DatabaseSync(path.join(daemonRoot, '.codewave', 'state.sqlite'));
}

try {
  daemon = startDaemon();
  await waitForHealth();

  const localhostHost = await requestWithHost('/api/health', `localhost:${port}`);
  record('localhost Host remains compatible with loopback clients', 200, localhostHost.status);
  const hostileHost = await requestWithHost('/api/health', 'attacker.example');
  record('non-local Host header is rejected against DNS rebinding', 403, hostileHost.status);
  const missingHost = await requestWithoutHost('/api/health');
  record(
    'missing Host header fails closed',
    (value) => value === 400 || value === 403,
    missingHost.status,
  );

  const malformedHandshake = await rawRequest('POST', '/api/handshake', {
    connection: null,
    rawBody: '{',
  });
  record('malformed JSON is rejected', 400, malformedHandshake.status);

  const invalidScope = await rawRequest('POST', '/api/handshake', {
    connection: null,
    body: {
      clientName: 'invalid-scope',
      clientVersion: '1',
      protocolVersion: 1,
      requestedScopes: ['runtime:read', 'root:everything'],
    },
  });
  record('unknown handshake scope is rejected', 400, invalidScope.status);

  const handshake = await negotiate();
  record('handshake grants exact deduplicated scope set', 13, handshake.grantedScopes.length);
  await getRevision();

  const readOnly = await rawRequest('POST', '/api/handshake', {
    connection: null,
    body: {
      clientName: 'read-only',
      clientVersion: '1',
      protocolVersion: 1,
      requestedScopes: ['runtime:read'],
    },
  });
  const deniedProviderRead = await rawRequest('GET', '/api/providers', {
    connection: readOnly.payload.connectionId,
  });
  record('under-scoped connection fails closed', 403, deniedProviderRead.status);

  const oversizedBody = await rawRequest('POST', '/api/sessions', {
    rawBody: `{"padding":"${'x'.repeat(2 * 1024 * 1024)}"}`,
  });
  record('request body ceiling is enforced', 400, oversizedBody.status);
  const healthAfterOversize = await rawRequest('GET', '/api/health', { connection: null });
  record('daemon survives oversized request', 200, healthAfterOversize.status);

  const missingApi = await rawRequest('POST', '/api/definitely-missing', {
    key: 'missing-api-route-0001',
    body: { hostile: true },
  });
  record('unknown API route returns JSON 404', 404, missingApi.status, {
    contentType: missingApi.contentType,
    payload: missingApi.payload,
  });
  record(
    'unknown API response is JSON',
    (value) => typeof value === 'string' && value.startsWith('application/json'),
    missingApi.contentType,
  );
  const replayedMissingApi = await rawRequest('POST', '/api/definitely-missing', {
    key: 'missing-api-route-0001',
    body: { hostile: true },
  });
  record('unknown keyed API response is durably replayable', 404, replayedMissingApi.status);
  record('unknown keyed API response is not left pending', false, replayedMissingApi.pending);
  record('unknown keyed API response advertises replay', true, replayedMissingApi.replayed);

  const lexicalEscape = await rawRequest(
    'GET',
    `/api/workspace/entries?workspacePath=${encodeURIComponent(workspacePath)}&relativePath=${encodeURIComponent('../outside')}`,
  );
  record('lexical workspace traversal is rejected', 409, lexicalEscape.status);

  const linkPath = path.join(workspacePath, 'escape-link');
  symlinkSync(outsidePath, linkPath, 'junction');
  const symlinkListing = await rawRequest(
    'GET',
    `/api/workspace/entries?workspacePath=${encodeURIComponent(workspacePath)}&relativePath=escape-link`,
  );
  record('workspace listing cannot follow an escaping junction', 409, symlinkListing.status);
  for (let index = 1; index <= 3; index += 1) {
    const folderName = `outside-created-${index}`;
    const linkEscape = await rawRequest('POST', '/api/workspace/folders', {
      key: `symlink-escape-create-${index}`,
      body: {
        workspacePath,
        parentPath: 'escape-link',
        name: folderName,
      },
    });
    record(`symlink workspace escape ${index} is rejected`, 409, linkEscape.status);
    record(
      `symlink workspace escape ${index} creates nothing outside`,
      false,
      existsSync(path.join(outsidePath, folderName)),
    );
    rmSync(path.join(outsidePath, folderName), { recursive: true, force: true });
  }

  mkdirSync(path.join(outsidePath, 'rename-target'));
  const symlinkRename = await rawRequest('PATCH', '/api/workspace/entries/rename', {
    key: 'symlink-escape-rename-01',
    body: {
      workspacePath,
      targetPath: 'escape-link/rename-target',
      nextName: 'renamed-outside',
    },
  });
  record('workspace rename cannot follow an escaping junction', 409, symlinkRename.status);
  record('rejected junction rename preserves outside target', true, existsSync(path.join(outsidePath, 'rename-target')));
  const symlinkDelete = await rawRequest(
    'DELETE',
    `/api/workspace/entries?workspacePath=${encodeURIComponent(workspacePath)}&targetPath=${encodeURIComponent('escape-link/rename-target')}`,
    { key: 'symlink-escape-delete-01' },
  );
  record('workspace delete cannot follow an escaping junction', 409, symlinkDelete.status);
  record('rejected junction delete preserves outside target', true, existsSync(path.join(outsidePath, 'rename-target')));
  const unlinkJunction = await rawRequest(
    'DELETE',
    `/api/workspace/entries?workspacePath=${encodeURIComponent(workspacePath)}&targetPath=escape-link`,
    { key: 'safe-junction-unlink-01' },
  );
  record('deleting a junction unlinks only the workspace entry', 200, unlinkJunction.status);
  record('deleted junction is gone', false, existsSync(linkPath));
  record('deleting a junction preserves its outside target', true, existsSync(outsidePath));

  const dotPrefixFolder = await rawRequest('POST', '/api/workspace/folders', {
    key: 'safe-dot-prefix-folder-01',
    body: { workspacePath, parentPath: '', name: '..safe-inside' },
  });
  record('safe child whose name starts with dots remains allowed', 201, dotPrefixFolder.status);

  mkdirSync(path.join(workspacePath, 'delete-first'));
  mkdirSync(path.join(workspacePath, 'delete-second'));
  const deletePath = (targetPath) =>
    `/api/workspace/entries?workspacePath=${encodeURIComponent(workspacePath)}&targetPath=${encodeURIComponent(targetPath)}`;
  const firstDelete = await rawRequest('DELETE', deletePath('delete-first'), {
    key: 'query-bound-delete-0001',
  });
  const reorderedFirstDelete = await rawRequest(
    'DELETE',
    `/api/workspace/entries?targetPath=delete-first&workspacePath=${encodeURIComponent(workspacePath)}`,
    { key: 'query-bound-delete-0001' },
  );
  const conflictingDelete = await rawRequest('DELETE', deletePath('delete-second'), {
    key: 'query-bound-delete-0001',
  });
  record('first query-addressed deletion succeeds', 200, firstDelete.status);
  record('semantically identical reordered query replays', true, reorderedFirstDelete.replayed);
  record('idempotency key is bound to mutation query parameters', 409, conflictingDelete.status);
  record('conflicting replay does not delete second target', true, existsSync(path.join(workspacePath, 'delete-second')));

  mkdirSync(path.join(workspacePath, 'repeat-first'));
  mkdirSync(path.join(workspacePath, 'repeat-second'));
  const repeatedFirst = await rawRequest(
    'DELETE',
    `/api/workspace/entries?workspacePath=${encodeURIComponent(workspacePath)}&targetPath=repeat-first&targetPath=repeat-second`,
    { key: 'query-repeat-order-0001' },
  );
  const repeatedReordered = await rawRequest(
    'DELETE',
    `/api/workspace/entries?workspacePath=${encodeURIComponent(workspacePath)}&targetPath=repeat-second&targetPath=repeat-first`,
    { key: 'query-repeat-order-0001' },
  );
  record('first repeated query mutation succeeds', 200, repeatedFirst.status);
  record('reordered repeated query values are not canonicalized together', 409, repeatedReordered.status);
  record('repeated query conflict preserves the second target', true, existsSync(path.join(workspacePath, 'repeat-second')));

  const emptyPromptSession = await createSession('empty-prompt-01');
  const emptyPromptRun = await startRun(emptyPromptSession.id, 'empty-prompt-01', '   ');
  record('empty run prompt is rejected before persistence', 409, emptyPromptRun.status);
  const emptyPromptSnapshot = await rawRequest('GET', `/api/sessions/${emptyPromptSession.id}`);
  record('empty prompt does not create a run', 0, emptyPromptSnapshot.payload.runs.length);

  const sessionCountBeforeEmptyWorkspace = (await rawRequest('GET', '/api/sessions')).payload.length;
  const emptyWorkspaceSession = await rawRequest('POST', '/api/sessions', {
    key: 'empty-workspace-session-01',
    body: {
      workspacePath: '   ',
      providerId: 'freebuff',
      approvalPolicy: 'manual',
      expectedProviderRevision: providerRevision,
    },
  });
  record('empty workspace path is rejected before persistence', 409, emptyWorkspaceSession.status);
  const sessionCountAfterEmptyWorkspace = (await rawRequest('GET', '/api/sessions')).payload.length;
  record(
    'empty workspace path creates no session',
    sessionCountBeforeEmptyWorkspace,
    sessionCountAfterEmptyWorkspace,
  );
  const missingWorkspaceSession = await rawRequest('POST', '/api/sessions', {
    key: 'missing-workspace-session-01',
    body: {
      workspacePath: path.join(tempRoot, 'does-not-exist'),
      providerId: 'freebuff',
      approvalPolicy: 'manual',
      expectedProviderRevision: providerRevision,
    },
  });
  record('nonexistent workspace path is rejected before persistence', 409, missingWorkspaceSession.status);
  const workspaceFilePath = path.join(tempRoot, 'not-a-workspace.txt');
  writeFileSync(workspaceFilePath, 'not a directory', 'utf8');
  const fileWorkspaceSession = await rawRequest('POST', '/api/sessions', {
    key: 'file-workspace-session-01',
    body: {
      workspacePath: workspaceFilePath,
      providerId: 'freebuff',
      approvalPolicy: 'manual',
      expectedProviderRevision: providerRevision,
    },
  });
  record('workspace file path is rejected before persistence', 409, fileWorkspaceSession.status);
  const sessionCountAfterInvalidWorkspaceKinds = (await rawRequest('GET', '/api/sessions')).payload.length;
  record(
    'invalid workspace kinds create no sessions',
    sessionCountBeforeEmptyWorkspace,
    sessionCountAfterInvalidWorkspaceKinds,
  );

  const invalidBridgeSession = await createSession('invalid-bridge-01');
  const invalidBridgeRun = await startRun(
    invalidBridgeSession.id,
    'invalid-bridge-01',
    '[invalid-records] tolerate malformed and unknown bridge records',
  );
  record('invalid-record fixture run starts', 201, invalidBridgeRun.status);
  await waitForTerminal(invalidBridgeSession.id);
  const invalidBridgeSnapshot = await rawRequest('GET', `/api/runs/${invalidBridgeRun.payload.run.id}`);
  const terminalEvents = invalidBridgeSnapshot.payload.events.filter((event) =>
    ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type),
  );
  record('invalid bridge records preserve exactly one terminal event', 1, terminalEvents.length);
  record(
    'invalid bridge records remain observable without crashing the run',
    (value) => value >= 3,
    invalidBridgeSnapshot.payload.events.filter((event) => event.type === 'run.output.delta').length,
  );

  const lateSession = await createSession('late-session-01');
  const lateSessionRun = await startRun(
    lateSession.id,
    'late-session-01',
    '[late-session] terminal records must fence later session metadata',
  );
  assert.equal(lateSessionRun.status, 201);
  await waitForTerminal(lateSession.id);
  const lateSessionSnapshot = await rawRequest('GET', `/api/sessions/${lateSession.id}`);
  record(
    'provider session metadata emitted after terminal cannot overwrite accepted identity',
    'fake-freebuff-session',
    lateSessionSnapshot.payload.session.providerSessionId,
  );

  const recoveryBoundarySession = await createSession('recovery-boundary-01');
  const recoveryBoundaryRun = await startRun(
    recoveryBoundarySession.id,
    'recovery-boundary-01',
    'complete before testing unsupported recovery',
  );
  assert.equal(recoveryBoundaryRun.status, 201);
  await waitForTerminal(recoveryBoundarySession.id);
  const recovered = await rawRequest(
    'POST',
    `/api/sessions/${recoveryBoundarySession.id}/recover`,
    {
      key: 'recover-invalid-bridge-session-01',
      body: { expectedProviderRevision: providerRevision },
    },
  );
  record('provider without resume capability fails recovery closed', 409, recovered.status);
  const deleteRecovered = await rawRequest('DELETE', `/api/sessions/${recoveryBoundarySession.id}`, {
    key: 'delete-recovered-session-01',
  });
  record('completed session can be deleted', 200, deleteRecovered.status);
  const deletedRecoveryLookup = await rawRequest('GET', `/api/sessions/${recoveryBoundarySession.id}`);
  record('deleted completed session is gone', 404, deletedRecoveryLookup.status);

  const approvalId = 'adversarial-invalid-approval';
  const approvalDatabase = openDatabase();
  approvalDatabase.prepare(
    `INSERT INTO approvals (
      id, session_id, run_id, tool_name, tool_use_id, status, reason,
      created_at, resolved_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    approvalId,
    invalidBridgeSession.id,
    invalidBridgeRun.payload.run.id,
    'adversarial-tool',
    'adversarial-tool-use',
    'requested',
    null,
    new Date().toISOString(),
    null,
    '{}',
  );
  approvalDatabase.close();
  const invalidApproval = await rawRequest('POST', `/api/approvals/${approvalId}/resolve`, {
    key: 'invalid-approval-decision-01',
    body: { decision: 'definitely-not-valid' },
  });
  record('invalid approval decision is rejected', 400, invalidApproval.status);
  const approvalCheckDatabase = openDatabase();
  const approvalStatus = approvalCheckDatabase
    .prepare('SELECT status FROM approvals WHERE id = ?')
    .get(approvalId)?.status;
  approvalCheckDatabase.close();
  record('invalid approval decision cannot corrupt persisted status', 'requested', approvalStatus);

  const activeSession = await createSession('active-delete-01');
  const activeRun = await startRun(activeSession.id, 'active-delete-01', '[hold] active delete guard');
  record('held run starts before deletion race', 201, activeRun.status);
  const activeProviderSwitch = await rawRequest('PATCH', `/api/sessions/${activeSession.id}`, {
    key: 'active-session-provider-switch-01',
    body: {
      providerId: 'opencode',
      expectedProviderRevision: providerRevision,
    },
  });
  record('active session cannot switch provider identity', 409, activeProviderSwitch.status);
  record(
    'active provider switch reports the lifecycle guard',
    true,
    typeof activeProviderSwitch.payload?.error === 'string' &&
      activeProviderSwitch.payload.error.includes('while a run is active'),
  );
  const activeDelete = await rawRequest('DELETE', `/api/sessions/${activeSession.id}`, {
    key: 'active-session-delete-01',
  });
  record('active session deletion is rejected', 409, activeDelete.status);
  if (activeDelete.status === 409) {
    await rawRequest('POST', `/api/runs/${activeRun.payload.run.id}/cancel`, {
      key: 'active-session-cancel-01',
    });
    await waitForTerminal(activeSession.id);
    const deleteAfterTerminal = await rawRequest('DELETE', `/api/sessions/${activeSession.id}`, {
      key: 'active-session-delete-after-terminal-01',
    });
    record('session deletion succeeds after cancellation settles', 200, deleteAfterTerminal.status);
  }

  const raceSession = await createSession('launch-race-01');
  const launchRace = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      startRun(raceSession.id, `launch-race-0${index + 1}`, `concurrent launch ${index + 1}`),
    ),
  );
  record(
    'five-way launch race has one winner',
    JSON.stringify([201, 409, 409, 409, 409]),
    JSON.stringify(launchRace.map((result) => result.status).sort()),
  );
  await waitForTerminal(raceSession.id);

  const sessionsBeforeFailedCompare = (await rawRequest('GET', '/api/sessions')).payload.length;
  const failedCompare = await rawRequest('POST', '/api/compare', {
    key: 'compare-preflight-failure-01',
    body: {
      prompt: 'compare without leaking a partial lane',
      workspacePath,
      providers: ['freebuff', 'opencode'],
      approvalPolicy: 'manual',
      expectedProviderRevision: providerRevision,
    },
  });
  record('compare with a disabled lane fails closed', 409, failedCompare.status);
  const sessionsAfterFailedCompare = (await rawRequest('GET', '/api/sessions')).payload.length;
  record(
    'failed compare preflight creates no partial session or run',
    sessionsBeforeFailedCompare,
    sessionsAfterFailedCompare,
  );

  const restartSession = await createSession('restart-01');
  const restartRun = await startRun(restartSession.id, 'restart-01', '[hold] restart reconciliation');
  assert.equal(restartRun.status, 201);
  await stopDaemon();
  daemon = startDaemon();
  await waitForHealth();
  const staleLease = await rawRequest('GET', '/api/runtime');
  record('restart invalidates old protocol lease', 401, staleLease.status);
  await negotiate();
  await getRevision();
  const reconciled = await rawRequest('GET', `/api/runs/${restartRun.payload.run.id}`);
  record('restart reconciles active run to failed', 'failed', reconciled.payload.run.status);
  record(
    'restart reconciliation emits one terminal event',
    1,
    reconciled.payload.events.filter((event) =>
      ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type),
    ).length,
  );

  const hugeTranscriptCursor = await rawRequest(
    'GET',
    `/api/sessions/${invalidBridgeSession.id}/transcript?before=999999999999999999999999999999999`,
  );
  record('unsafe transcript cursor is rejected', 400, hugeTranscriptCursor.status);
  const hugeSseCursor = await rawRequest(
    'GET',
    `/api/runs/${invalidBridgeRun.payload.run.id}/stream?after=999999999999999999999999999999999`,
  );
  record('unsafe SSE cursor is rejected', 400, hugeSseCursor.status);

  await stopDaemon();
  const replayDatabase = openDatabase();
  const runId = invalidBridgeRun.payload.run.id;
  const runRow = replayDatabase
    .prepare('SELECT session_id FROM runs WHERE id = ?')
    .get(runId);
  const currentMax = Number(
    replayDatabase
      .prepare('SELECT COALESCE(MAX(sequence), 0) AS value FROM events WHERE run_id = ?')
      .get(runId).value,
  );
  const insertEvent = replayDatabase.prepare(
    `INSERT INTO events (
      id, session_id, run_id, sequence, timestamp, source, type, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let index = 1; index <= 505; index += 1) {
    insertEvent.run(
      `adversarial-replay-event-${index}`,
      runRow.session_id,
      runId,
      currentMax + index,
      new Date(1_800_000_000_000 + index).toISOString(),
      'system',
      'run.output.delta',
      JSON.stringify({ text: `seed-${index}`, stream: 'stdout' }),
    );
  }
  const totalEvents = Number(
    replayDatabase
      .prepare('SELECT COUNT(*) AS value FROM events WHERE run_id = ?')
      .get(runId).value,
  );
  replayDatabase.close();

  daemon = startDaemon();
  await waitForHealth();
  await negotiate();
  const firstReplayPage = await readSsePage(runId, 0, { timeoutMs: 1200 });
  record('SSE first replay page honors ceiling', 500, firstReplayPage.events.length);
  record('SSE closes a saturated replay page so EventSource can resume', true, firstReplayPage.closed);
  const firstLastSequence = firstReplayPage.events.at(-1)?.sequence ?? 0;
  const remainingCount = totalEvents - firstReplayPage.events.length;
  const secondReplayPage = await readSsePage(runId, 0, {
    timeoutMs: 1200,
    stopAfter: remainingCount,
    lastEventId: firstLastSequence,
  });
  const combinedSequences = [...firstReplayPage.events, ...secondReplayPage.events].map(
    (event) => event.sequence,
  );
  record('SSE reconnect delivers every pre-existing event', totalEvents, combinedSequences.length);
  record(
    'SSE reconnect has no sequence gaps or duplicates',
    true,
    combinedSequences.every((sequence, index) => sequence === index + 1),
  );

  const evidence = {
    mode: OBSERVE_ONLY ? 'pre-fix-observation' : 'post-fix-validation',
    generatedAt: new Date().toISOString(),
    tempRoot,
    baseUrl,
    summary: {
      passed: observations.filter((entry) => entry.passed).length,
      failed: observations.filter((entry) => !entry.passed).length,
      total: observations.length,
    },
    observations,
    daemonLogTail: daemonLogs.slice(-80),
  };
  const evidencePath = path.join(
    EVIDENCE_DIRECTORY,
    OBSERVE_ONLY ? 'observed-pre-fix.json' : 'validated-post-fix.json',
  );
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `Daemon adversarial ${OBSERVE_ONLY ? 'observation' : 'validation'}: ${evidence.summary.passed}/${evidence.summary.total} expectations passed; evidence ${evidencePath}\n`,
  );
} catch (error) {
  const failureEvidence = {
    mode: OBSERVE_ONLY ? 'pre-fix-observation' : 'post-fix-validation',
    generatedAt: new Date().toISOString(),
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    observations,
    daemonLogTail: daemonLogs.slice(-80),
  };
  writeFileSync(
    path.join(
      EVIDENCE_DIRECTORY,
      OBSERVE_ONLY ? 'observed-pre-fix-failure.json' : 'validated-post-fix-failure.json',
    ),
    `${JSON.stringify(failureEvidence, null, 2)}\n`,
    'utf8',
  );
  throw error;
} finally {
  await stopDaemon();
  rmSync(tempRoot, { recursive: true, force: true });
}
