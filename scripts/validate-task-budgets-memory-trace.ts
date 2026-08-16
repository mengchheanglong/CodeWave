import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ClientHandshakeResponse,
  CreateTranscriptCompactionRequest,
  ProjectRecord,
  ProviderRegistrySnapshot,
  RunExecutionBudget,
  RunSnapshot,
  TranscriptCompactionCheckpoint,
  TranscriptWindow,
  WorkbenchSession,
  WorktreeTaskRecord,
} from '@codewave/protocol';
import type { TaskTraceReportV1 } from '@codewave/task-trace';
import { CodeWaveDaemon } from '../apps/daemon/src/server.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(repoRoot, 'scripts', 'fixtures', 'fake-generic-acp-agent.mjs');
const rootPath = mkdtempSync(path.join(os.tmpdir(), 'codewave-budgets-trace-'));
const projectRepoPath = path.join(rootPath, 'git-project');
mkdirSync(projectRepoPath, { recursive: true });

// Initialize real git repo for task-trace tests
execFileSync('git', ['init', '-b', 'main'], { cwd: projectRepoPath, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'CodeWave Test'], { cwd: projectRepoPath, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'test@codewave.local'], { cwd: projectRepoPath, stdio: 'ignore' });
writeFileSync(path.join(projectRepoPath, 'README.md'), '# Test Project\n', 'utf8');
execFileSync('git', ['add', '.'], { cwd: projectRepoPath, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: projectRepoPath, stdio: 'ignore' });

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
      clientName: 'budgets-trace-validator',
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
        'projects:read',
        'projects:write',
        'workspace:read',
        'workspace:write',
      ],
    }),
  });
  assert.equal(response.status, 201);
  const handshake = (await response.json()) as ClientHandshakeResponse;
  connectionId = handshake.connectionId;
  assert.ok(handshake.capabilities.includes('execution-budgets'));
  assert.ok(handshake.capabilities.includes('transcript-compaction-checkpoints'));
  assert.ok(handshake.capabilities.includes('task-trace-evaluation'));
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
    headers.set('Idempotency-Key', `budgets-trace-${++idempotencySequence}`);
  }
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload: T;
  try {
    payload = JSON.parse(text) as T;
  } catch {
    payload = text as unknown as T;
  }
  return { status: response.status, payload };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRunTerminal(runId: string, timeoutMs = 10_000): Promise<RunSnapshot> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { status, payload } = await request<RunSnapshot>('GET', `/api/runs/${runId}`);
    assert.equal(status, 200);
    if (
      payload.run.status === 'completed' ||
      payload.run.status === 'failed' ||
      payload.run.status === 'cancelled'
    ) {
      return payload;
    }
    await sleep(50);
  }
  throw new Error(`Run ${runId} did not reach terminal state within ${timeoutMs}ms.`);
}

try {
  await startDaemon();

  // Register custom ACP provider for deterministic scenario tests
  const providersResponse = await request<ProviderRegistrySnapshot>('GET', '/api/providers');
  const createProfile = await request<ProviderRegistrySnapshot>('POST', '/api/providers', {
    expectedProviderRevision: providersResponse.payload.revision,
    providerId: 'acp.fixture-budgets',
    displayName: 'Fixture Budgets Agent',
    command: process.execPath,
    args: [fixture],
    priority: 10,
  });
  assert.equal(createProfile.status, 201);

  const enableProfile = await request<ProviderRegistrySnapshot>(
    'PATCH',
    '/api/providers/acp.fixture-budgets',
    {
      expectedProviderRevision: createProfile.payload.revision,
      enabled: true,
    },
  );
  assert.equal(enableProfile.status, 200);
  const currentProviderRevision = enableProfile.payload.revision;

  // ---------------------------------------------------------------------------
  // Vector 1: Execution Budget - Hard Wall-Time Exceeded & Cancel
  // ---------------------------------------------------------------------------
  process.stdout.write('Testing wall-time execution budget enforcement...\n');
  const session1 = await request<WorkbenchSession>('POST', '/api/sessions', {
    workspacePath: projectRepoPath,
    providerId: 'acp.fixture-budgets',
    expectedProviderRevision: currentProviderRevision,
  });
  assert.equal(session1.status, 201);

  const wallTimeBudget: RunExecutionBudget = {
    schemaVersion: 'codewave-run-budget-v1',
    maxWallTimeMs: 150,
    maxToolInvocations: null,
    maxReportedTokens: null,
  };

  const run1 = await request<RunSnapshot>('POST', `/api/sessions/${session1.payload.id}/runs`, {
    prompt: 'Execute long task for wall-time budget test',
    expectedProviderRevision: currentProviderRevision,
    executionBudget: wallTimeBudget,
  });
  assert.equal(run1.status, 201);
  assert.equal(run1.payload.executionBudget?.budget.maxWallTimeMs, 150);

  const terminalRun1 = await waitForRunTerminal(run1.payload.run.id);
  assert.equal(terminalRun1.run.status, 'cancelled');
  assert.equal(terminalRun1.executionBudget?.exceededDimension, 'wall-time');
  assert.equal(terminalRun1.executionBudget?.enforcement, 'hard-cancel');
  assert.ok(terminalRun1.events.some((e) => e.type === 'run.budget.exceeded'));
  process.stdout.write('PASS Wall-time budget hard cancellation\n');

  // ---------------------------------------------------------------------------
  // Vector 2: Transcript Compaction & Derived Memory Checkpoints
  // ---------------------------------------------------------------------------
  process.stdout.write('Testing transcript compaction creation and queries...\n');
  const session2 = await request<WorkbenchSession>('POST', '/api/sessions', {
    workspacePath: projectRepoPath,
    providerId: 'acp.fixture-budgets',
    expectedProviderRevision: currentProviderRevision,
  });
  assert.equal(session2.status, 201);

  // Run 1 in session2
  const s2run1 = await request<RunSnapshot>('POST', `/api/sessions/${session2.payload.id}/runs`, {
    prompt: 'First conversation prompt about architecture',
    expectedProviderRevision: currentProviderRevision,
  });
  assert.equal(s2run1.status, 201);
  await waitForRunTerminal(s2run1.payload.run.id);

  // Run 2 in session2
  const s2run2 = await request<RunSnapshot>('POST', `/api/sessions/${session2.payload.id}/runs`, {
    prompt: 'Second conversation prompt about unit tests',
    expectedProviderRevision: currentProviderRevision,
  });
  assert.equal(s2run2.status, 201);
  await waitForRunTerminal(s2run2.payload.run.id);

  // Get transcript window
  const transcriptRes = await request<TranscriptWindow>(
    'GET',
    `/api/sessions/${session2.payload.id}/transcript`,
  );
  assert.equal(transcriptRes.status, 200);
  console.log('Transcript payload:', JSON.stringify(transcriptRes.payload, null, 2));
  const headSeq = transcriptRes.payload.newestSequence!;
  assert.ok(headSeq >= 2);

  // Create compaction through sequence 2 (which is the tail of run 1)
  const compactionBody: CreateTranscriptCompactionRequest = {
    throughSequence: 2,
    expectedTranscriptHeadSequence: headSeq,
    expectedPreviousCheckpointId: null,
    expectedCompactionPolicyRevision: 'sha256:bc85f1a8b716191a35bc3d93ee27935a04001dcbe6385cb04554d9bd85822dc2',
  };
  const compactionRes = await request<TranscriptCompactionCheckpoint>(
    'POST',
    `/api/sessions/${session2.payload.id}/compactions`,
    compactionBody as unknown as Record<string, unknown>,
  );
  if (compactionRes.status !== 201) {
    console.error('Compaction failed:', compactionRes.payload);
  }
  assert.equal(compactionRes.status, 201);
  assert.equal(compactionRes.payload.sessionId, session2.payload.id);
  assert.equal(compactionRes.payload.fromSequence, 1);
  assert.equal(compactionRes.payload.throughSequence, 2);
  assert.equal(compactionRes.payload.authority, 'derived-non-authoritative');
  assert.ok(compactionRes.payload.summaryText.length > 0);

  // Query latest compaction
  const latestCompactionRes = await request<{ checkpoint: TranscriptCompactionCheckpoint | null }>(
    'GET',
    `/api/sessions/${session2.payload.id}/compactions/latest`,
  );
  assert.equal(latestCompactionRes.status, 200);
  assert.equal(latestCompactionRes.payload.checkpoint?.id, compactionRes.payload.id);

  // Query all compactions
  const allCompactionsRes = await request<TranscriptCompactionCheckpoint[]>(
    'GET',
    `/api/sessions/${session2.payload.id}/compactions`,
  );
  assert.equal(allCompactionsRes.status, 200);
  assert.equal(allCompactionsRes.payload.length, 1);
  process.stdout.write('PASS Transcript compaction creation, storage, and retrieval\n');

  // ---------------------------------------------------------------------------
  // Vector 3: Project Worktree Task & Trace Evaluation
  // ---------------------------------------------------------------------------
  process.stdout.write('Testing task trace projection and evaluation...\n');
  const projectRes = await request<ProjectRecord>('POST', '/api/projects', {
    rootPath: projectRepoPath,
    name: 'Git Test Project',
  });
  assert.equal(projectRes.status, 201);

  const taskRes = await request<WorktreeTaskRecord>(
    'POST',
    `/api/projects/${projectRes.payload.id}/tasks`,
    {
      title: 'Task for Trace Evaluation',
    },
  );
  assert.equal(taskRes.status, 201);

  // Run agent session inside task worktree
  const taskSession = await request<WorkbenchSession>('POST', '/api/sessions', {
    workspacePath: taskRes.payload.worktreePath,
    providerId: 'acp.fixture-budgets',
    expectedProviderRevision: currentProviderRevision,
  });
  assert.equal(taskSession.status, 201);

  const taskRun = await request<RunSnapshot>('POST', `/api/sessions/${taskSession.payload.id}/runs`, {
    prompt: 'Implement feature in isolated worktree',
    expectedProviderRevision: currentProviderRevision,
  });
  assert.equal(taskRun.status, 201);
  await waitForRunTerminal(taskRun.payload.run.id);

  // Create file in worktree to review
  writeFileSync(path.join(taskRes.payload.worktreePath, 'feature.txt'), 'Hello world\n', 'utf8');

  // Fetch changes to get version
  const changesRes = await request<{ version: string }>(
    'GET',
    `/api/tasks/${taskRes.payload.id}/changes`,
  );
  assert.equal(changesRes.status, 200);

  // Accept changes
  const acceptRes = await request<{ clean: boolean }>(
    'POST',
    `/api/tasks/${taskRes.payload.id}/accept`,
    {
      expectedVersion: changesRes.payload.version,
      commitMessage: 'feat: add feature in task',
    },
  );
  assert.equal(acceptRes.status, 200);
  assert.equal(acceptRes.payload.clean, true);

  // Request Task Trace
  const traceRes = await request<TaskTraceReportV1>(
    'GET',
    `/api/tasks/${taskRes.payload.id}/trace`,
  );
  if (traceRes.status !== 200) {
    console.error('Task trace failed:', traceRes.payload);
  }
  assert.equal(traceRes.status, 200);
  assert.equal(traceRes.payload.schemaVersion, 'codewave-task-trace-report-v1');
  assert.equal(traceRes.payload.projection.outcome.decision, 'keep');
  assert.equal(traceRes.payload.summary.outcome, 'keep');
  if (traceRes.payload.summary.integrity !== 'pass') {
    console.error('Failed assertions:', traceRes.payload.assertions);
  }
  assert.equal(traceRes.payload.summary.integrity, 'pass');
  assert.equal(traceRes.payload.assertions.length, 8);
  assert.equal(traceRes.payload.summary.failedAssertions.length, 0);
  assert.ok(traceRes.payload.assertions.every((a) => a.status !== 'fail'));
  process.stdout.write('PASS Task trace projection, evaluation, and outcome verification\n');

  process.stdout.write('\nAll task budget, compaction memory, and task trace evaluations PASSED (3/3 vector groups).\n');
} finally {
  await stopDaemon();
  try {
    rmSync(rootPath, { recursive: true, force: true });
  } catch {}
}
