import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpV1ProviderAdapter } from '@codewave/provider-acp';
import type {
  ProviderRunContext,
  ProviderSessionUpdate,
  WorkbenchEvent,
} from '@codewave/protocol';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(repoRoot, 'scripts', 'fixtures', 'fake-minimal-acp-agent.mjs');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'codewave-generic-acp-'));
const workspacePath = path.join(tempRoot, 'workspace');
mkdirSync(workspacePath);

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

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createContext(options: {
  events: WorkbenchEvent[];
  updates: ProviderSessionUpdate[];
}): ProviderRunContext {
  return {
    launchAttemptId: '00000000-0000-4000-8000-000000000201',
    session: {
      id: 'generic-acp-session',
      workspacePath,
      providerId: 'opencode',
      providerConfigurationRevision: 'sha256:generic-acp-validation',
      providerSessionId: null,
      approvalPolicy: 'manual',
      recovery: null,
      orchestration: null,
      createdAt: '2026-08-13T00:00:00.000Z',
    },
    run: {
      id: 'generic-acp-run',
      sessionId: 'generic-acp-session',
      providerId: 'opencode',
      providerConfigurationRevision: 'sha256:generic-acp-validation',
      prompt: 'respond calmly',
      status: 'running',
      mode: 'execute',
      preRunCommit: null,
      createdAt: '2026-08-13T00:00:00.000Z',
      startedAt: '2026-08-13T00:00:00.000Z',
      completedAt: null,
      errorMessage: null,
    },
    emitEvent: async (event) => void options.events.push(event),
    updateSession: async (update) => void options.updates.push(update),
    requestApproval: async () => ({ behavior: 'deny' }),
  };
}

function makeAdapter(
  environment: NodeJS.ProcessEnv,
  logPath: string,
): AcpV1ProviderAdapter {
  return new AcpV1ProviderAdapter({
    profile: {
      providerId: 'opencode',
      displayName: 'Synthetic Wave ACP',
      command: process.execPath,
      args: [fixture],
      probeCwd: workspacePath,
      surface: 'synthetic-wave.acp',
      toolCatalog: [
        {
          name: 'read',
          requirement: 'workspace-read',
          source: 'provider',
          permissionModel: 'auto',
          detail: 'Synthetic read hint.',
        },
      ],
    },
    env: { ...process.env, ...environment, CODEWAVE_MINIMAL_ACP_LOG: logPath },
  });
}

try {
  const logPath = path.join(tempRoot, 'normal.jsonl');
  const adapter = makeAdapter({}, logPath);
  const [firstHealth, secondHealth, capabilities] = await Promise.all([
    adapter.healthCheck(),
    adapter.healthCheck(),
    adapter.capabilities(),
  ]);
  assert.equal(firstHealth.available, true);
  assert.equal(secondHealth.available, true);
  assert.match(firstHealth.detail, /credential state is unverified/i);
  assert.equal(capabilities.resumableSessions, true);
  assert.equal(
    readLog(logPath).filter((entry) => entry.method === 'initialize').length,
    1,
    'concurrent health/capability calls must share one compatibility probe',
  );
  assert.equal((await adapter.toolCatalog()).length, 1);
  assert.deepEqual(
    await adapter.enumerateConnectedTools({
      workspacePath,
      sessionId: 'generic-acp-session',
      providerSessionId: null,
    }),
    [],
  );

  const events: WorkbenchEvent[] = [];
  const updates: ProviderSessionUpdate[] = [];
  await adapter.startRun(createContext({ events, updates }));
  await waitFor(
    () => events.some((event) => event.type === 'run.completed'),
    'Generic ACP run did not complete.',
  );
  assert.equal(
    events.find((event) => event.type === 'message.created')?.payload.content,
    'A calm response from the minimal ACP agent.',
  );
  assert.equal(updates.at(-1)?.providerSessionId, 'minimal-wave-session');
  assert.equal(
    events.filter((event) =>
      ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type),
    ).length,
    1,
  );
  const runPid = Number(
    readLog(logPath).findLast((entry) => entry.method === 'session/prompt')?.pid,
  );
  assert.ok(Number.isInteger(runPid) && runPid > 0);
  await waitFor(
    () => !isProcessAlive(runPid),
    'Generic ACP child survived its terminal event.',
  );

  const stderrLog = path.join(tempRoot, 'stderr.jsonl');
  const stderrAdapter = makeAdapter(
    { CODEWAVE_MINIMAL_ACP_STDERR_BYTES: String(300 * 1024) },
    stderrLog,
  );
  const stderrEvents: WorkbenchEvent[] = [];
  await stderrAdapter.startRun(
    createContext({ events: stderrEvents, updates: [] }),
  );
  await waitFor(
    () => stderrEvents.some((event) => event.type === 'run.completed'),
    'Generic ACP stderr-bound run did not complete.',
  );
  const stderrDeltas = stderrEvents.filter(
    (event) =>
      event.type === 'run.output.delta' && event.payload.stream === 'stderr',
  );
  assert.ok(
    stderrDeltas.every(
      (event) => Buffer.byteLength(String(event.payload.text), 'utf8') <= 64 * 1024,
    ),
  );
  assert.ok(
    stderrDeltas.reduce(
      (total, event) =>
        total + Buffer.byteLength(String(event.payload.text), 'utf8'),
      0,
    ) <= 256 * 1024,
  );

  const cancelLog = path.join(tempRoot, 'cancel.jsonl');
  const cancelAdapter = makeAdapter({ CODEWAVE_MINIMAL_ACP_HOLD: '1' }, cancelLog);
  const cancelEvents: WorkbenchEvent[] = [];
  const cancelUpdates: ProviderSessionUpdate[] = [];
  const handle = await cancelAdapter.startRun(
    createContext({ events: cancelEvents, updates: cancelUpdates }),
  );
  await waitFor(
    () => readLog(cancelLog).some((entry) => entry.method === 'session/prompt'),
    'Synthetic ACP prompt did not start.',
  );
  await handle.cancel();
  await waitFor(
    () => cancelEvents.some((event) => event.type === 'run.cancelled'),
    'Generic ACP cancellation did not settle.',
  );

  const incompatible = makeAdapter(
    { CODEWAVE_MINIMAL_ACP_PROTOCOL: '2' },
    path.join(tempRoot, 'incompatible.jsonl'),
  );
  const incompatibleHealth = await incompatible.healthCheck();
  assert.equal(incompatibleHealth.available, false);
  assert.match(incompatibleHealth.detail, /incompatible protocol v2/i);

  const missing = new AcpV1ProviderAdapter({
    profile: {
      providerId: 'opencode',
      displayName: 'Missing ACP',
      command: path.join(tempRoot, 'missing-agent.exe'),
      args: [],
      probeCwd: workspacePath,
      surface: 'missing.acp',
    },
  });
  const missingHealth = await missing.healthCheck();
  assert.equal(missingHealth.available, false);

  process.stdout.write(
    'Generic ACP provider validation passed: profile-only launch, coalesced compatibility probe, negotiated capabilities, normalized run/cancel lifecycle, catalog honesty, mismatch rejection, and missing-executable diagnostics.\n',
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
