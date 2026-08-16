import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createRunEventPublisher,
  startAcpRun,
  type AcpRunHandle,
  type AcpTransportTrace,
} from '@codewave/provider-transport';
import type {
  ProviderApprovalDecision,
  ProviderRunContext,
  ProviderSessionUpdate,
  WorkbenchEvent,
} from '@codewave/protocol';
import { CodeWaveDaemon } from '../apps/daemon/src/server.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(repoRoot, 'scripts', 'fixtures', 'fake-generic-acp-agent.mjs');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'codewave-acp-v1-'));
const workspacePath = path.join(tempRoot, 'workspace');
mkdirSync(workspacePath);

type Scenario = {
  child: ChildProcess;
  events: WorkbenchEvent[];
  traces: AcpTransportTrace[];
  updates: ProviderSessionUpdate[];
  logPath: string;
  publisher: ReturnType<typeof createRunEventPublisher>;
  start: Promise<AcpRunHandle>;
};

function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        if (await predicate()) {
          resolve();
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(message));
          return;
        }
        setTimeout(() => void poll(), 10);
      } catch (error) {
        reject(error);
      }
    };
    void poll();
  });
}

function startScenario(
  scenario: string,
  options: {
    providerSessionId?: string | null;
    requestApproval?: () => Promise<ProviderApprovalDecision>;
    initializeTimeoutMs?: number;
  } = {},
): Scenario {
  const logPath = path.join(
    tempRoot,
    `${scenario}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );
  const child = spawn(process.execPath, [fixture], {
    cwd: workspacePath,
    env: {
      ...process.env,
      CODEWAVE_FAKE_ACP_SCENARIO: scenario,
      CODEWAVE_FAKE_ACP_LOG: logPath,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const events: WorkbenchEvent[] = [];
  const traces: AcpTransportTrace[] = [];
  const updates: ProviderSessionUpdate[] = [];
  const context: ProviderRunContext = {
    launchAttemptId: '00000000-0000-4000-8000-000000000101',
    session: {
      id: `acp-${scenario}-session`,
      workspacePath,
      providerId: 'opencode',
      providerConfigurationRevision: 'sha256:acp-v1-validation',
      createdAt: '2026-08-13T00:00:00.000Z',
      providerSessionId: options.providerSessionId ?? null,
      approvalPolicy: 'manual',
      recovery: null,
      orchestration: null,
    },
    run: {
      id: `acp-${scenario}-run`,
      sessionId: `acp-${scenario}-session`,
      providerId: 'opencode',
      providerConfigurationRevision: 'sha256:acp-v1-validation',
      prompt: 'validate generic ACP v1',
      status: 'running',
      mode: 'execute',
      preRunCommit: null,
      createdAt: '2026-08-13T00:00:00.000Z',
      startedAt: '2026-08-13T00:00:00.000Z',
      completedAt: null,
      errorMessage: null,
    },
    emitEvent: async (event) => void events.push(event),
    updateSession: async (update) => void updates.push(update),
    requestApproval:
      options.requestApproval ?? (async () => ({ behavior: 'allow' })),
  };
  const publisher = createRunEventPublisher(context, 'opencode');
  const start = startAcpRun({
    child,
    context,
    publish: async (type, payload) => {
      await publisher.publish(type, payload);
    },
    profile: {
      providerId: 'opencode',
      displayName: 'Generic fixture',
      surface: 'fixture.acp',
      initializeTimeoutMs: options.initializeTimeoutMs,
      cancelGraceMs: 250,
    },
    trace: (entry) => traces.push(entry),
  });
  return { child, events, traces, updates, logPath, publisher, start };
}

async function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => child.once('close', () => resolve())),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('ACP fixture process did not exit.')), 3_000),
    ),
  ]);
}

function readLog(logPath: string): Array<Record<string, unknown>> {
  try {
    return readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function validateDaemonPermissionCancellation(): Promise<void> {
  const daemonRoot = path.join(tempRoot, 'daemon-cancel-root');
  mkdirSync(daemonRoot);
  const port = 20_000 + Math.floor(Math.random() * 10_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    CODEWAVE_GEMINI_ENABLED: process.env.CODEWAVE_GEMINI_ENABLED,
    CODEWAVE_GEMINI_COMMAND: process.env.CODEWAVE_GEMINI_COMMAND,
    CODEWAVE_GEMINI_MODE: process.env.CODEWAVE_GEMINI_MODE,
    CODEWAVE_FAKE_ACP_PERMISSION: process.env.CODEWAVE_FAKE_ACP_PERMISSION,
  };
  process.env.CODEWAVE_GEMINI_ENABLED = 'true';
  process.env.CODEWAVE_GEMINI_COMMAND = `"${process.execPath}" "${path.join(
    repoRoot,
    'scripts',
    'fixtures',
    'fake-gemini-acp-agent.mjs',
  )}"`;
  process.env.CODEWAVE_GEMINI_MODE = 'acp';
  process.env.CODEWAVE_FAKE_ACP_PERMISSION = 'true';
  const daemon = new CodeWaveDaemon(daemonRoot, port);
  try {
    await daemon.start();
    const handshakeResponse = await fetch(`${baseUrl}/api/handshake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: 'acp-v1-validator',
        clientVersion: '1.0.0-test',
        protocolVersion: 1,
        requestedScopes: [
          'providers:read',
          'sessions:read',
          'sessions:write',
          'runs:read',
          'runs:write',
          'approvals:write',
        ],
      }),
    });
    assert.equal(handshakeResponse.status, 201);
    const handshake = (await handshakeResponse.json()) as { connectionId: string };
    let keySequence = 0;
    const request = async (
      method: string,
      pathname: string,
      body?: Record<string, unknown>,
    ): Promise<{ status: number; payload: any }> => {
      const headers = new Headers({ 'X-CodeWave-Connection': handshake.connectionId });
      if (body !== undefined) headers.set('Content-Type', 'application/json');
      if (method !== 'GET') {
        headers.set('Idempotency-Key', `acp-daemon-cancel-${++keySequence}`);
      }
      const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        payload: await response.json(),
      };
    };
    const registry = await request('GET', '/api/providers');
    const session = await request('POST', '/api/sessions', {
      workspacePath,
      providerId: 'gemini',
      expectedProviderRevision: registry.payload.revision,
      approvalPolicy: 'manual',
    });
    assert.equal(session.status, 201);
    const run = await request('POST', `/api/sessions/${session.payload.id}/runs`, {
      prompt: 'request a permission and wait',
      mode: 'execute',
      expectedProviderRevision: registry.payload.revision,
    });
    assert.equal(run.status, 201);
    const runId = run.payload.run.id as string;
    let snapshot: any = null;
    await waitFor(async () => {
      const result = await request('GET', `/api/runs/${runId}`);
      snapshot = result.payload;
      return snapshot.approvals.some((approval: any) => approval.status === 'requested');
    }, 'Daemon ACP permission was not requested.');
    const cancelStartedAt = Date.now();
    const cancelled = await request('POST', `/api/runs/${runId}/cancel`, {});
    const cancelElapsedMs = Date.now() - cancelStartedAt;
    assert.equal(cancelled.status, 200);
    assert.ok(
      cancelElapsedMs < 1_250,
      `Pending ACP permission cancellation took ${cancelElapsedMs}ms.`,
    );
    assert.equal(cancelled.payload.run.status, 'cancelled');
    assert.equal(
      cancelled.payload.approvals.filter((approval: any) => approval.status === 'denied')
        .length,
      1,
    );
    assert.match(
      String(cancelled.payload.approvals[0]?.reason),
      /cancellation resolved the pending provider permission/i,
    );
    assert.equal(
      cancelled.payload.events.filter((event: WorkbenchEvent) =>
        ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type),
      ).length,
      1,
    );
  } finally {
    await daemon.stop();
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function settle(scenario: Scenario): Promise<AcpRunHandle> {
  const handle = await scenario.start;
  await Promise.race([
    handle.settled,
    new Promise<never>((_, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('ACP fixture run did not settle within 5 seconds.')),
        5_000,
      );
      timeout.unref?.();
    }),
  ]).catch((error) => {
    if (scenario.child.exitCode === null) scenario.child.kill();
    throw error;
  });
  await waitForChildExit(scenario.child);
  return handle;
}

try {
  const transportPackage = JSON.parse(
    readFileSync(path.join(repoRoot, 'packages/providers/transport/package.json'), 'utf8'),
  ) as { dependencies: Record<string, string> };
  const lock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string; integrity?: string }>;
  };
  assert.equal(transportPackage.dependencies['@agentclientprotocol/sdk'], '1.3.0');
  assert.equal(lock.packages['node_modules/@agentclientprotocol/sdk']?.version, '1.3.0');
  assert.equal(
    lock.packages['node_modules/@agentclientprotocol/sdk']?.integrity,
    'sha512-i3h/efaeuMUFAO1HSfo97QZQnnvMd7wWBYtBsdL6UMZg3a78sk3Ffya5Xu7C7tYsXomXoDXJBAzQF2PcFKAhIQ==',
  );
  assert.doesNotMatch(
    readFileSync(path.join(repoRoot, 'packages/providers/transport/src/acp.ts'), 'utf8'),
    /experimental\/v2|ClientSideConnection|unstable_resumeSession|waitForQuietPeriod/,
  );

  const normal = startScenario('normal');
  await settle(normal);
  assert.equal(normal.publisher.terminalEventType, 'run.completed');
  assert.equal(normal.updates[0]?.providerSessionId, 'generic-new-session');
  const normalLog = readLog(normal.logPath);
  const initialize = normalLog.find((entry) => entry.kind === 'initialize');
  assert.deepEqual(initialize?.clientCapabilities, {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
    auth: { terminal: false },
  });
  assert.deepEqual(initialize?.clientInfo, {
    name: 'codewave',
    title: 'CodeWave',
    version: '0.1.0-dev',
  });
  assert.equal(normalLog.some((entry) => entry.kind === 'session.close'), false);
  assert.ok(normal.traces.some((entry) => entry.kind === 'initialize.complete'));

  const interleaved = startScenario('interleaved-messages');
  await settle(interleaved);
  const message = interleaved.events.find((event) => event.type === 'message.created');
  assert.equal(message?.payload.content, 'alpha omega\n\nbeta');

  const resumed = startScenario('resume', { providerSessionId: 'existing-session' });
  await settle(resumed);
  const resumeLog = readLog(resumed.logPath);
  assert.ok(resumeLog.some((entry) => entry.kind === 'session.resume'));
  assert.equal(resumeLog.some((entry) => entry.kind === 'session.load.start'), false);
  assert.equal(resumeLog.some((entry) => entry.kind === 'session.new'), false);

  const loaded = startScenario('load', { providerSessionId: 'loaded-session' });
  await settle(loaded);
  assert.ok(readLog(loaded.logPath).some((entry) => entry.kind === 'session.load.complete'));
  assert.equal(
    loaded.events.some((event) =>
      JSON.stringify(event.payload).includes('historical replay must stay hidden'),
    ),
    false,
  );

  const unsupported = startScenario('normal', { providerSessionId: 'orphan-session' });
  await assert.rejects(unsupported.start, /cannot restore this existing session/i);
  await waitForChildExit(unsupported.child);

  const mismatch = startScenario('protocol-mismatch');
  await assert.rejects(mismatch.start, /incompatible protocol v2/i);
  await waitForChildExit(mismatch.child);

  const slow = startScenario('slow-initialize', { initializeTimeoutMs: 100 });
  await assert.rejects(slow.start, /initialize timed out/i);
  await waitForChildExit(slow.child);

  const maxTokens = startScenario('max-tokens');
  await settle(maxTokens);
  assert.equal(maxTokens.publisher.terminalEventType, 'run.failed');
  assert.match(
    String(maxTokens.events.find((event) => event.type === 'run.failed')?.payload.message),
    /max_tokens/,
  );

  const wrongSession = startScenario('wrong-session');
  await settle(wrongSession);
  assert.equal(
    wrongSession.events.some((event) =>
      JSON.stringify(event.payload).includes('must never be emitted'),
    ),
    false,
  );
  assert.ok(
    wrongSession.traces.some(
      (entry) =>
        entry.kind === 'session.update' && entry.detail.rejected === 'session_mismatch',
    ),
  );

  const allowOnce = startScenario('pending-permission', {
    requestApproval: async () => ({ behavior: 'allow' }),
  });
  await settle(allowOnce);
  assert.deepEqual(
    readLog(allowOnce.logPath).find((entry) => entry.kind === 'permission.result')
      ?.outcome,
    { outcome: 'selected', optionId: 'allow-once' },
  );

  const rejectOnce = startScenario('pending-permission', {
    requestApproval: async () => ({ behavior: 'deny' }),
  });
  await settle(rejectOnce);
  assert.deepEqual(
    readLog(rejectOnce.logPath).find((entry) => entry.kind === 'permission.result')
      ?.outcome,
    { outcome: 'selected', optionId: 'reject-once' },
  );

  const noSemanticOption = startScenario('allow-only-permission', {
    requestApproval: async () => ({ behavior: 'deny' }),
  });
  await settle(noSemanticOption);
  assert.deepEqual(
    readLog(noSemanticOption.logPath).find((entry) => entry.kind === 'permission.result')
      ?.outcome,
    { outcome: 'cancelled' },
  );

  const earlyEof = startScenario('early-eof');
  await settle(earlyEof);
  assert.equal(earlyEof.publisher.terminalEventType, 'run.failed');

  const oversized = startScenario('oversized-line');
  await settle(oversized);
  assert.equal(oversized.publisher.terminalEventType, 'run.failed');
  assert.match(
    String(oversized.events.find((event) => event.type === 'run.failed')?.payload.message),
    /line limit/i,
  );

  const malformed = startScenario('malformed-json');
  await settle(malformed);
  assert.equal(malformed.publisher.terminalEventType, 'run.failed');

  let resolvePermission: ((decision: ProviderApprovalDecision) => void) | null = null;
  const pendingPermission = startScenario('pending-permission', {
    requestApproval: () =>
      new Promise((resolve) => {
        resolvePermission = resolve;
      }),
  });
  const pendingHandle = await pendingPermission.start;
  await waitFor(
    () => pendingPermission.events.some((event) => event.type === 'tool.requested'),
    'ACP fixture did not request permission.',
  );
  resolvePermission?.({ behavior: 'cancel', message: 'Run cancelled.' });
  pendingPermission.publisher.requestCancellation();
  await pendingHandle.cancel();
  await pendingHandle.settled;
  await waitForChildExit(pendingPermission.child);
  assert.equal(pendingPermission.publisher.terminalEventType, 'run.cancelled');
  assert.equal(
    readLog(pendingPermission.logPath).find((entry) => entry.kind === 'permission.result')
      ?.outcome instanceof Object,
    true,
  );

  const waitCancel = startScenario('wait-for-cancel');
  const waitCancelHandle = await waitCancel.start;
  waitCancel.publisher.requestCancellation();
  await waitCancelHandle.cancel();
  await waitCancelHandle.settled;
  await waitForChildExit(waitCancel.child);
  assert.equal(waitCancel.publisher.terminalEventType, 'run.cancelled');
  assert.ok(readLog(waitCancel.logPath).some((entry) => entry.kind === 'session.cancel'));

  await validateDaemonPermissionCancellation();

  process.stdout.write(
    'ACP v1 validation passed: exact stable SDK, app API, bounded initialize/framing, capability-gated new/resume/load, replay suppression, message identity, permission cancellation, stop reasons, terminal ownership, and child cleanup.\n',
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
