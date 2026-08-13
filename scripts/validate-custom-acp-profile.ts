import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ClientHandshakeResponse,
  ProviderRegistrySnapshot,
  RunSnapshot,
  RuntimeInfo,
  WorkbenchSession,
} from '@codewave/protocol';
import { CodeWaveDaemon } from '../apps/daemon/src/server.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(repoRoot, 'scripts', 'fixtures', 'fake-minimal-acp-agent.mjs');
const rootPath = mkdtempSync(path.join(os.tmpdir(), 'codewave-custom-acp-'));
const workspacePath = path.join(rootPath, 'workspace');
const agentLogPath = path.join(rootPath, 'custom-agent.jsonl');
mkdirSync(workspacePath);
const port = 20_000 + Math.floor(Math.random() * 10_000);
const baseUrl = `http://127.0.0.1:${port}`;
let daemon: CodeWaveDaemon | null = null;
let connectionId = '';
let idempotencySequence = 0;

async function startDaemon(): Promise<void> {
  daemon = new CodeWaveDaemon(rootPath, port);
  await daemon.start();
  const response = await fetch(`${baseUrl}/api/handshake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify({
      clientName: 'custom-acp-validator',
      clientVersion: '1.0.0-test',
      protocolVersion: 1,
      requestedScopes: [
        'runtime:read',
        'providers:read',
        'providers:write',
        'sessions:read',
        'sessions:write',
        'runs:read',
        'runs:write',
      ],
    }),
  });
  assert.equal(response.status, 201);
  connectionId = ((await response.json()) as ClientHandshakeResponse).connectionId;
}

async function stopDaemon(): Promise<void> {
  if (daemon) await daemon.stop();
  daemon = null;
}

async function request<T>(
  method: string,
  pathname: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; payload: T }> {
  const headers = new Headers({
    'X-CodeWave-Connection': connectionId,
    Connection: 'close',
  });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (method !== 'GET') {
    headers.set('Idempotency-Key', `custom-acp-${++idempotencySequence}`);
  }
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, payload: (await response.json()) as T };
}

async function waitForTerminal(runId: string): Promise<RunSnapshot> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    const result = await request<RunSnapshot>('GET', `/api/runs/${runId}`);
    if (['completed', 'failed', 'cancelled'].includes(result.payload.run.status)) {
      return result.payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Custom ACP run did not reach a terminal state.');
}

try {
  await startDaemon();
  const initial = await request<ProviderRegistrySnapshot>('GET', '/api/providers');
  assert.equal(initial.status, 200);
  assert.equal(initial.payload.version, 2);

  const invalid = await request<{ error: string }>('POST', '/api/providers', {
    expectedProviderRevision: initial.payload.revision,
    providerId: 'acp.INVALID',
    displayName: 'Invalid ACP',
    command: process.execPath,
    args: [fixture, '--log', agentLogPath],
  });
  assert.equal(invalid.status, 409);
  assert.match(invalid.payload.error, /lowercase acp/i);

  const unsafeEnabledCreation = await request<{ error: string }>('POST', '/api/providers', {
    expectedProviderRevision: initial.payload.revision,
    providerId: 'acp.unsafe-enabled',
    displayName: 'Unsafe enabled profile',
    command: process.execPath,
    args: [fixture, '--log', agentLogPath],
    enabled: true,
  });
  assert.equal(unsafeEnabledCreation.status, 400);
  assert.match(unsafeEnabledCreation.payload.error, /undeclared (?:field|property) 'enabled'/i);

  const created = await request<ProviderRegistrySnapshot>('POST', '/api/providers', {
    expectedProviderRevision: initial.payload.revision,
    providerId: 'acp.synthetic-wave',
    displayName: 'Synthetic Wave',
    command: process.execPath,
    args: [fixture, '--log', agentLogPath],
    priority: 15,
  });
  assert.equal(created.status, 201);
  const profile = created.payload.providers.find(
    (provider) => provider.providerId === 'acp.synthetic-wave',
  );
  assert.deepEqual(
    profile && {
      profileKind: profile.profileKind,
      adapterKind: profile.adapterKind,
      command: profile.command,
      args: profile.args,
      enabled: profile.enabled,
    },
    {
      profileKind: 'custom',
      adapterKind: 'acp-v1',
      command: process.execPath,
      args: [fixture, '--log', agentLogPath],
      enabled: false,
    },
  );

  const disabledRuntime = await request<RuntimeInfo>('GET', '/api/runtime');
  assert.equal(
    disabledRuntime.payload.providers.find(
      (provider) => provider.providerId === 'acp.synthetic-wave',
    )?.status,
    'disabled',
  );
  assert.equal(
    existsSync(agentLogPath),
    false,
    'A disabled custom executable must not be launched for capabilities or health.',
  );

  const enabled = await request<ProviderRegistrySnapshot>(
    'PATCH',
    '/api/providers/acp.synthetic-wave',
    {
      expectedProviderRevision: created.payload.revision,
      enabled: true,
    },
  );
  assert.equal(enabled.status, 200);
  const runtime = await request<RuntimeInfo>('GET', '/api/runtime');
  assert.equal(runtime.status, 200);
  const health = runtime.payload.providers.find(
    (provider) => provider.providerId === 'acp.synthetic-wave',
  );
  assert.equal(health?.available, true);
  assert.match(health?.detail ?? '', /credential state is unverified/i);

  const sessionResponse = await request<WorkbenchSession>('POST', '/api/sessions', {
    workspacePath,
    providerId: 'acp.synthetic-wave',
    expectedProviderRevision: enabled.payload.revision,
    approvalPolicy: 'manual',
  });
  assert.equal(sessionResponse.status, 201);
  const firstRun = await request<{ run: { id: string } }>(
    'POST',
    `/api/sessions/${sessionResponse.payload.id}/runs`,
    {
      prompt: 'run the custom profile',
      mode: 'execute',
      expectedProviderRevision: enabled.payload.revision,
    },
  );
  assert.equal(firstRun.status, 201);
  const firstSnapshot = await waitForTerminal(firstRun.payload.run.id);
  assert.equal(firstSnapshot.run.status, 'completed');
  assert.equal(
    firstSnapshot.transcript.messages.at(-1)?.content,
    'A calm response from the minimal ACP agent.',
  );

  await stopDaemon();
  await startDaemon();
  const restarted = await request<ProviderRegistrySnapshot>('GET', '/api/providers');
  assert.ok(
    restarted.payload.providers.some(
      (provider) => provider.providerId === 'acp.synthetic-wave',
    ),
  );
  const secondRun = await request<{ run: { id: string } }>(
    'POST',
    `/api/sessions/${sessionResponse.payload.id}/runs`,
    {
      prompt: 'resume after daemon restart',
      mode: 'execute',
      expectedProviderRevision: restarted.payload.revision,
    },
  );
  assert.equal(secondRun.status, 201);
  assert.equal((await waitForTerminal(secondRun.payload.run.id)).run.status, 'completed');

  const updated = await request<ProviderRegistrySnapshot>(
    'PATCH',
    '/api/providers/acp.synthetic-wave',
    {
      expectedProviderRevision: restarted.payload.revision,
      displayName: 'Synthetic Wave Local',
      args: [fixture, '--log', agentLogPath],
      enabled: false,
    },
  );
  assert.equal(updated.status, 200);
  assert.equal(
    updated.payload.providers.find(
      (provider) => provider.providerId === 'acp.synthetic-wave',
    )?.displayName,
    'Synthetic Wave Local',
  );

  process.stdout.write(
    'Custom ACP profile validation passed: v2 revision-fenced creation, strict IDs, real compatibility health, selection, run, restart persistence/resume, and generic update/disable.\n',
  );
} finally {
  await stopDaemon().catch(() => undefined);
  rmSync(rootPath, { recursive: true, force: true });
}
