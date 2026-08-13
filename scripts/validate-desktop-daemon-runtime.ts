import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ClientHandshakeResponse,
  ProviderRegistrySnapshot,
  WorkbenchSession,
} from '@codewave/protocol';
import { CodeWaveDaemon } from '../apps/daemon/src/server.js';

const DESKTOP_HEADER = 'X-CodeWave-Desktop-Bootstrap';
const DESKTOP_SECRET = 'desktop-validator-secret';

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T;
  return body;
}

async function assertStatus(response: Response, expected: number): Promise<void> {
  if (response.status === expected) return;
  const body = await response.text();
  assert.equal(response.status, expected, body);
}

async function handshake(
  baseUrl: string,
  secret = DESKTOP_SECRET,
): Promise<ClientHandshakeResponse> {
  const response = await fetch(`${baseUrl}/api/handshake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [DESKTOP_HEADER]: secret,
    },
    body: JSON.stringify({
      clientName: 'codewave-desktop-runtime-validator',
      clientVersion: '1.0.0',
      protocolVersion: 1,
      requestedScopes: [
        'providers:read',
        'sessions:read',
        'sessions:write',
        'runs:read',
        'runs:write',
      ],
    }),
  });
  await assertStatus(response, 201);
  return readJson<ClientHandshakeResponse>(response);
}

async function authenticatedGet<T>(
  baseUrl: string,
  pathname: string,
  connectionId: string,
): Promise<T> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      [DESKTOP_HEADER]: DESKTOP_SECRET,
      'X-CodeWave-Connection': connectionId,
    },
  });
  await assertStatus(response, 200);
  return readJson<T>(response);
}

async function reserveOccupiedPort(): Promise<{
  port: number;
  close(): Promise<void>;
}> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), 'codewave-desktop-daemon-'),
);
const workspaceRoot = path.join(temporaryRoot, 'workspace');
const dataDirectory = path.join(temporaryRoot, 'desktop-data');
await mkdir(workspaceRoot, { recursive: true });
const fixturePath = fileURLToPath(
  new URL('./fixtures/fake-freebuff-bridge.mjs', import.meta.url),
);
const originalFreebuffCommand = process.env.CODEWAVE_FREEBUFF_COMMAND;
const originalHoldMs = process.env.CODEWAVE_FAKE_FREEBUFF_HOLD_MS;
process.env.CODEWAVE_FREEBUFF_COMMAND = `${JSON.stringify(process.execPath)} ${JSON.stringify(fixturePath)}`;
process.env.CODEWAVE_FAKE_FREEBUFF_HOLD_MS = '60000';

let daemon: CodeWaveDaemon | null = null;
let restartedDaemon: CodeWaveDaemon | null = null;
let collisionDaemon: CodeWaveDaemon | null = null;
let occupied: Awaited<ReturnType<typeof reserveOccupiedPort>> | null = null;

try {
  assert.throws(
    () =>
      new CodeWaveDaemon({
        workspaceRoot,
        host: '0.0.0.0' as '127.0.0.1',
      }),
    /locked to 127\.0\.0\.1/,
  );

  daemon = new CodeWaveDaemon({
    workspaceRoot,
    dataDirectory,
    host: '127.0.0.1',
    port: 0,
    desktopBootstrapSecret: DESKTOP_SECRET,
    shutdownTimeoutMs: 2_000,
  });
  assert.throws(
    () => daemon!.getBaseUrl(),
    /unavailable until an OS-selected port is listening/,
  );
  const started = await daemon.start();
  assert.equal(started.host, '127.0.0.1');
  assert(started.port > 0, 'port 0 must resolve to an actual OS-selected port');
  assert.equal(started.baseUrl, daemon.getBaseUrl());
  assert.equal(started.baseUrl, `http://127.0.0.1:${started.port}`);

  const missingSecret = await fetch(`${started.baseUrl}/api/health`);
  assert.equal(missingSecret.status, 401);
  assert.equal(
    (await readJson<{ code: string }>(missingSecret)).code,
    'desktop_bootstrap_required',
  );
  const wrongSecret = await fetch(`${started.baseUrl}/api/health`, {
    headers: { [DESKTOP_HEADER]: `${DESKTOP_SECRET}-wrong` },
  });
  assert.equal(wrongSecret.status, 401);
  const rightSecret = await fetch(`${started.baseUrl}/api/health`, {
    headers: { [DESKTOP_HEADER]: DESKTOP_SECRET },
  });
  assert.equal(rightSecret.status, 200);
  assert.equal((await readJson<{ ok: boolean }>(rightSecret)).ok, true);
  const wrongHandshake = await fetch(`${started.baseUrl}/api/handshake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [DESKTOP_HEADER]: 'wrong-handshake-secret',
    },
    body: '{}',
  });
  assert.equal(wrongHandshake.status, 401);

  const connection = await handshake(started.baseUrl);
  const registry = await authenticatedGet<ProviderRegistrySnapshot>(
    started.baseUrl,
    '/api/providers',
    connection.connectionId,
  );
  const createResponse = await fetch(`${started.baseUrl}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'desktop-state-session-1',
      [DESKTOP_HEADER]: DESKTOP_SECRET,
      'X-CodeWave-Connection': connection.connectionId,
    },
    body: JSON.stringify({
      workspacePath: workspaceRoot,
      providerId: 'freebuff',
      expectedProviderRevision: registry.revision,
      approvalPolicy: 'manual',
    }),
  });
  await assertStatus(createResponse, 201);
  const createdSession = await readJson<WorkbenchSession>(createResponse);
  assert.equal(createdSession.workspacePath, path.resolve(workspaceRoot));

  const runResponse = await fetch(
    `${started.baseUrl}/api/sessions/${createdSession.id}/runs`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'desktop-active-run-1',
        [DESKTOP_HEADER]: DESKTOP_SECRET,
        'X-CodeWave-Connection': connection.connectionId,
      },
      body: JSON.stringify({
        prompt: '[hold] desktop shutdown must cancel this provider',
        mode: 'execute',
        expectedProviderRevision: registry.revision,
      }),
    },
  );
  await assertStatus(runResponse, 201);
  const activeRun = await readJson<{ run: { id: string; status: string } }>(
    runResponse,
  );
  assert.equal(activeRun.run.status, 'running');
  const streamResponse = await fetch(
    `${started.baseUrl}/api/runs/${activeRun.run.id}/stream`,
    {
      headers: {
        [DESKTOP_HEADER]: DESKTOP_SECRET,
        'X-CodeWave-Connection': connection.connectionId,
      },
    },
  );
  await assertStatus(streamResponse, 200);
  const streamReader = streamResponse.body?.getReader();
  assert(streamReader, 'SSE response must expose a readable body');
  const firstStreamChunk = await streamReader.read();
  assert.equal(firstStreamChunk.done, false);

  const stopStartedAt = Date.now();
  await Promise.all([daemon.stop(), daemon.stop()]);
  assert(
    Date.now() - stopStartedAt < 5_000,
    'active-provider shutdown must remain bounded',
  );
  await Promise.race([
    (async () => {
      while (!(await streamReader.read()).done) {
        // Drain the final shutdown marker before the stream closes.
      }
    })(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SSE did not close during daemon stop.')), 2_000),
    ),
  ]);
  await daemon.stop();
  await assert.rejects(
    daemon.start(),
    /instances can only be started once/,
  );
  assert(
    existsSync(path.join(dataDirectory, 'state.sqlite')),
    'desktop data directory must own state.sqlite',
  );
  assert(
    !existsSync(path.join(workspaceRoot, '.codewave', 'state.sqlite')),
    'a separate desktop data directory must not place state.sqlite in the workspace',
  );

  restartedDaemon = new CodeWaveDaemon({
    workspaceRoot,
    dataDirectory,
    port: 0,
    desktopBootstrapSecret: DESKTOP_SECRET,
    shutdownTimeoutMs: 2_000,
  });
  const restarted = await restartedDaemon.start();
  const restartedConnection = await handshake(restarted.baseUrl);
  const sessions = await authenticatedGet<WorkbenchSession[]>(
    restarted.baseUrl,
    '/api/sessions',
    restartedConnection.connectionId,
  );
  assert(
    sessions.some((session) => session.id === createdSession.id),
    'state must survive a WAL checkpoint, close, and random-port restart',
  );
  const cancelledRun = await authenticatedGet<{ run: { status: string } }>(
    restarted.baseUrl,
    `/api/runs/${activeRun.run.id}`,
    restartedConnection.connectionId,
  );
  assert.equal(cancelledRun.run.status, 'cancelled');
  await restartedDaemon.stop();

  occupied = await reserveOccupiedPort();
  collisionDaemon = new CodeWaveDaemon({
    workspaceRoot: path.join(temporaryRoot, 'collision-workspace'),
    dataDirectory: path.join(temporaryRoot, 'collision-data'),
    port: occupied.port,
    shutdownTimeoutMs: 1_000,
  });
  await assert.rejects(
    collisionDaemon.start(),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'EADDRINUSE',
  );
  await collisionDaemon.stop();

  const ordinaryDaemon = new CodeWaveDaemon({
    workspaceRoot,
    dataDirectory: path.join(temporaryRoot, 'ordinary-data'),
    port: 0,
  });
  const ordinaryStarted = await ordinaryDaemon.start();
  const ordinaryHealth = await fetch(`${ordinaryStarted.baseUrl}/api/health`);
  assert.equal(ordinaryHealth.status, 200);
  await ordinaryDaemon.stop();

  console.log(
    'Desktop daemon runtime validation passed: loopback-only random ports, separate data/state, exact bootstrap gating, listen errors, active-provider cancellation, idempotent bounded stop, no restart after stop, WAL checkpoint/close, and restart persistence.',
  );
} finally {
  await daemon?.stop().catch(() => undefined);
  await restartedDaemon?.stop().catch(() => undefined);
  await collisionDaemon?.stop().catch(() => undefined);
  await occupied?.close().catch(() => undefined);
  if (originalFreebuffCommand === undefined) {
    delete process.env.CODEWAVE_FREEBUFF_COMMAND;
  } else {
    process.env.CODEWAVE_FREEBUFF_COMMAND = originalFreebuffCommand;
  }
  if (originalHoldMs === undefined) {
    delete process.env.CODEWAVE_FAKE_FREEBUFF_HOLD_MS;
  } else {
    process.env.CODEWAVE_FAKE_FREEBUFF_HOLD_MS = originalHoldMs;
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
