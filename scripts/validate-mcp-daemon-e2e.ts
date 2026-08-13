import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { CodeWaveDaemonClient } from '../apps/mcp-server/src/daemon-client.js';
import { projectArchive, projectRun, projectTranscript } from '../apps/mcp-server/src/projections.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'codewave-mcp-e2e-'));
const workspacePath = path.join(tempRoot, 'observer-workspace');
mkdirSync(workspacePath, { recursive: true });
const port = 5700 + Math.floor(Math.random() * 500);
const origin = `http://127.0.0.1:${port}`;
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const daemonEntry = path.join(repoRoot, 'apps', 'daemon', 'src', 'index.ts');
const bridgeFixture = path.join(repoRoot, 'scripts', 'fixtures', 'fake-freebuff-bridge.mjs');
const bridgeCommand = `"${process.execPath}" "${bridgeFixture}"`;
const daemonLogs: string[] = [];

const daemon = spawn(process.execPath, [tsxCli, daemonEntry], {
  cwd: tempRoot,
  env: {
    ...process.env,
    CODEWAVE_PORT: String(port),
    CODEWAVE_FREEBUFF_COMMAND: bridgeCommand,
    CODEWAVE_OPENCODE_ENABLED: 'false',
    CODEWAVE_QWEN_ENABLED: 'false',
    CODEWAVE_GEMINI_ENABLED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
daemon.stdout?.on('data', (chunk) => daemonLogs.push(chunk.toString()));
daemon.stderr?.on('data', (chunk) => daemonLogs.push(chunk.toString()));

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // The isolated daemon is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Isolated daemon did not start. ${daemonLogs.join('\n')}`);
}

let privilegedConnection = '';
async function request(
  method: string,
  pathname: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<{ status: number; payload: Record<string, any> }> {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(privilegedConnection ? { 'x-codewave-connection': privilegedConnection } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    payload: (await response.json()) as Record<string, any>,
  };
}

function receiptCount(): number {
  const databasePath = path.join(tempRoot, '.codewave', 'state.sqlite');
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database
      .prepare('SELECT COUNT(*) AS count FROM mutation_receipts')
      .get() as { count: number };
    return Number(row.count);
  } finally {
    database.close();
  }
}

try {
  await waitForHealth();
  const handshake = await request('POST', '/api/handshake', {
    clientName: 'MCP observer E2E seeder',
    clientVersion: '0.1.0',
    protocolVersion: 1,
    requestedScopes: [
      'providers:read',
      'sessions:read',
      'sessions:write',
      'runs:read',
      'runs:write',
    ],
  });
  assert.equal(handshake.status, 201);
  privilegedConnection = String(handshake.payload.connectionId);
  const providers = await request('GET', '/api/providers');
  assert.equal(providers.status, 200);
  const revision = String(providers.payload.revision);

  const createdSession = await request(
    'POST',
    '/api/sessions',
    {
      workspacePath,
      providerId: 'freebuff',
      expectedProviderRevision: revision,
      approvalPolicy: 'manual',
    },
    'mcp-e2e-session-create-01',
  );
  assert.equal(createdSession.status, 201);
  const sessionId = String(createdSession.payload.id);
  const createdRun = await request(
    'POST',
    `/api/sessions/${sessionId}/runs`,
    {
      prompt: '[result-only] real daemon observer evaluation',
      mode: 'execute',
      expectedProviderRevision: revision,
    },
    'mcp-e2e-run-create-0001',
  );
  assert.equal(createdRun.status, 201);
  const runId = String(createdRun.payload.run.id);

  let terminal: Record<string, any> | null = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request('GET', `/api/runs/${runId}`);
    if (['completed', 'failed', 'cancelled'].includes(response.payload.run?.status)) {
      terminal = response.payload;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(terminal?.run?.status, 'completed');

  const receiptsBeforeObserver = receiptCount();
  const observer = new CodeWaveDaemonClient(origin);
  const archive = projectArchive(await observer.listSessions());
  const sessionSnapshot = await observer.getSession(sessionId);
  const runSnapshot = projectRun(await observer.getRun(runId));
  const transcript = projectTranscript(
    await observer.readTranscript(sessionId, { limit: 20 }),
  );
  const receiptsAfterObserver = receiptCount();

  assert.equal(archive.sessions[0]?.id, sessionId);
  assert.equal(sessionSnapshot.session.id, sessionId);
  assert.equal(runSnapshot.run.status, 'completed');
  assert.match(transcript.messages.at(-1)?.content ?? '', /real daemon observer evaluation/);
  assert.equal(receiptsAfterObserver, receiptsBeforeObserver);
  assert.doesNotMatch(JSON.stringify(runSnapshot), new RegExp(workspacePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  process.stdout.write(
    `MCP real-daemon E2E passed: seeded session ${sessionId}, observed completed run ${runId}, read transcript, and preserved ${receiptsAfterObserver} mutation receipts with zero observer writes.\n`,
  );
} finally {
  if (daemon.exitCode === null) {
    daemon.kill();
    await Promise.race([
      once(daemon, 'close'),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  }
  const resolvedTemp = path.resolve(tempRoot);
  const resolvedOsTemp = path.resolve(os.tmpdir());
  assert.ok(resolvedTemp.startsWith(`${resolvedOsTemp}${path.sep}`));
  if (existsSync(resolvedTemp)) rmSync(resolvedTemp, { recursive: true, force: true });
}
