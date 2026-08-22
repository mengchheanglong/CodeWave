import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ClientHandshakeResponse,
  ProjectRecord,
  ProviderRegistrySnapshot,
  RunSnapshot,
  WorkbenchSession,
  WorktreeChangesSnapshot,
  WorktreeTaskRecord,
  WorkspaceEntriesResponse,
} from '@codewave/protocol';
import { CodeWaveDaemon } from '../apps/daemon/src/server.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const acpFixture = path.join(repoRoot, 'scripts', 'fixtures', 'fake-minimal-acp-agent.mjs');
const daemonRoot = mkdtempSync(path.join(os.tmpdir(), 'codewave-worktrees-'));
const projectRoot = path.join(daemonRoot, 'project');
const outsideRoot = path.join(daemonRoot, 'outside');
const hookSentinel = path.join(outsideRoot, 'hook-ran.txt');
mkdirSync(projectRoot);
mkdirSync(outsideRoot);

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function readText(filePath: string): string {
  return readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

git(projectRoot, ['init', '-b', 'main']);
git(projectRoot, ['config', 'user.name', 'CodeWave Test']);
git(projectRoot, ['config', 'user.email', 'codewave-test@example.invalid']);
writeFileSync(path.join(projectRoot, 'tracked.txt'), 'base\n', 'utf8');
git(projectRoot, ['add', 'tracked.txt']);
git(projectRoot, ['commit', '-m', 'base']);
const hookPath = path.join(projectRoot, '.git', 'hooks', 'post-checkout');
writeFileSync(hookPath, `#!/bin/sh\nprintf hook-ran > "${hookSentinel.replace(/\\/g, '/')}"\n`, 'utf8');
chmodSync(hookPath, 0o755);
const postCommitHookPath = path.join(projectRoot, '.git', 'hooks', 'post-commit');
writeFileSync(
  postCommitHookPath,
  `#!/bin/sh\nprintf hook-ran > "${hookSentinel.replace(/\\/g, '/')}"\n`,
  'utf8',
);
chmodSync(postCommitHookPath, 0o755);

const port = 30_000 + Math.floor(Math.random() * 10_000);
const baseUrl = `http://127.0.0.1:${port}`;
let daemon: CodeWaveDaemon | null = null;
let connectionId = '';
let keySequence = 0;

async function startDaemon(): Promise<void> {
  daemon = new CodeWaveDaemon(daemonRoot, port);
  await daemon.start();
  const response = await fetch(`${baseUrl}/api/handshake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify({
      clientName: 'project-worktree-validator',
      clientVersion: '1.0.0-test',
      protocolVersion: 1,
      requestedScopes: [
        'projects:read',
        'projects:write',
        'providers:read',
        'providers:write',
        'sessions:read',
        'sessions:write',
        'runs:read',
        'runs:write',
        'workspace:read',
        'workspace:write',
      ],
    }),
  });
  assert.equal(response.status, 201);
  connectionId = ((await response.json()) as ClientHandshakeResponse).connectionId;
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
  if (method !== 'GET') headers.set('Idempotency-Key', `worktree-${++keySequence}`);
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    payload: (await response.json()) as T,
  };
}

async function waitForRun(
  runId: string,
  statuses: string[],
): Promise<RunSnapshot> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    const snapshot = await request<RunSnapshot>('GET', `/api/runs/${runId}`);
    if (statuses.includes(snapshot.payload.run.status)) return snapshot.payload;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Run ${runId} did not reach ${statuses.join(' or ')}.`);
}

try {
  process.env.CODEWAVE_MINIMAL_ACP_HOLD = '1';
  await startDaemon();

  const nested = await request<{ error: string }>('POST', '/api/projects', {
    rootPath: path.join(projectRoot, 'nested'),
  });
  assert.equal(nested.status, 400);

  const nonGit = await request<{ error: string; code: string }>('POST', '/api/projects', {
    rootPath: outsideRoot,
  });
  assert.equal(nonGit.status, 400);
  assert.equal(nonGit.payload.code, 'invalid_project');
  assert.equal(
    nonGit.payload.error,
    'The project folder is not a Git repository. Open a Git repository root to register it.',
  );
  assert.doesNotMatch(nonGit.payload.error, /fatal:/, 'raw git stderr must not reach clients');

  const registered = await request<ProjectRecord>('POST', '/api/projects', {
    rootPath: projectRoot,
    name: 'Wave project',
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.payload.defaultBranch, 'main');

  appendFileSync(path.join(projectRoot, 'tracked.txt'), 'dirty source\n', 'utf8');
  const dirtySource = await request<{ error: string }>(
    'POST',
    `/api/projects/${registered.payload.id}/tasks`,
    { title: 'Should stay isolated' },
  );
  assert.equal(dirtySource.status, 409);
  git(projectRoot, ['restore', 'tracked.txt']);
  assert.equal(git(projectRoot, ['status', '--porcelain=v1']), '', 'source restore must be clean');
  rmSync(hookSentinel, { force: true });

  const created = await request<WorktreeTaskRecord>(
    'POST',
    `/api/projects/${registered.payload.id}/tasks`,
    { title: 'Calm isolated change' },
  );
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.status, 'active');
  assert.ok(created.payload.branchName.startsWith('codewave/task-calm-isolated-change-'));
  assert.ok(path.basename(created.payload.worktreePath).startsWith('calm-isolated-change-'));
  assert.ok(existsSync(created.payload.worktreePath));
  assert.equal(existsSync(hookSentinel), false, 'CodeWave Git operations must not run repository hooks');
  assert.equal(readText(path.join(created.payload.worktreePath, 'tracked.txt')), 'base\n');

  const entryQuery = new URLSearchParams({
    workspacePath: created.payload.worktreePath,
    relativePath: '',
  });
  const entries = await request<WorkspaceEntriesResponse>(
    'GET',
    `/api/workspace/entries?${entryQuery.toString()}`,
  );
  assert.equal(entries.status, 200);
  assert.equal(entries.payload.entries.some((entry) => entry.name === '.git'), false);
  const gitPreviewQuery = new URLSearchParams({
    workspacePath: created.payload.worktreePath,
    targetPath: '.git',
  });
  const protectedPreview = await request<{ code: string }>(
    'GET',
    `/api/workspace/files?${gitPreviewQuery.toString()}`,
  );
  assert.equal(protectedPreview.status, 409);
  assert.equal(protectedPreview.payload.code, 'workspace_path_escape');
  const protectedDelete = await request<{ error: string }>(
    'DELETE',
    `/api/workspace/entries?${gitPreviewQuery.toString()}`,
  );
  assert.equal(protectedDelete.status, 409);
  const protectedRename = await request<{ error: string }>(
    'PATCH',
    '/api/workspace/entries/rename',
    {
      workspacePath: created.payload.worktreePath,
      targetPath: 'tracked.txt',
      nextName: '.git',
    },
  );
  assert.equal(protectedRename.status, 409);
  const protectedFolder = await request<{ error: string }>(
    'POST',
    '/api/workspace/folders',
    { workspacePath: created.payload.worktreePath, parentPath: '', name: '.codewave' },
  );
  assert.equal(protectedFolder.status, 409);
  assert.equal(git(created.payload.worktreePath, ['status', '--porcelain=v1']), '');

  const clean = await request<WorktreeChangesSnapshot>(
    'GET',
    `/api/tasks/${created.payload.id}/changes`,
  );
  assert.equal(clean.status, 200);
  assert.equal(clean.payload.clean, true);

  writeFileSync(path.join(created.payload.worktreePath, 'tracked.txt'), 'accepted\n', 'utf8');
  writeFileSync(path.join(created.payload.worktreePath, 'new file.txt'), 'new calm file\n', 'utf8');
  const reviewed = await request<WorktreeChangesSnapshot>(
    'GET',
    `/api/tasks/${created.payload.id}/changes`,
  );
  assert.equal(reviewed.payload.clean, false);
  assert.deepEqual(
    reviewed.payload.changes.map((change) => [change.path, change.kind]).sort(),
    [
      ['new file.txt', 'untracked'],
      ['tracked.txt', 'modified'],
    ],
  );
  assert.match(reviewed.payload.diff, /accepted/);
  assert.match(reviewed.payload.diff, /new calm file/);

  appendFileSync(path.join(created.payload.worktreePath, 'tracked.txt'), 'race\n', 'utf8');
  const staleAccept = await request<{ code: string }>(
    'POST',
    `/api/tasks/${created.payload.id}/accept`,
    { expectedVersion: reviewed.payload.version, commitMessage: 'Accept calm change' },
  );
  assert.equal(staleAccept.status, 409);
  assert.equal(staleAccept.payload.code, 'stale_changes');

  const refreshed = await request<WorktreeChangesSnapshot>(
    'GET',
    `/api/tasks/${created.payload.id}/changes`,
  );
  const accepted = await request<WorktreeChangesSnapshot>(
    'POST',
    `/api/tasks/${created.payload.id}/accept`,
    { expectedVersion: refreshed.payload.version, commitMessage: 'Accept calm change' },
  );
  assert.equal(accepted.status, 200);
  assert.equal(accepted.payload.clean, true);
  assert.equal(accepted.payload.task.status, 'accepted');
  assert.ok(accepted.payload.task.acceptedCommit);
  assert.equal(existsSync(hookSentinel), false, 'Accept must not run repository commit hooks');
  assert.equal(readText(path.join(projectRoot, 'tracked.txt')), 'base\n');
  assert.equal(git(projectRoot, ['rev-parse', 'main']), created.payload.baseCommit);

  const second = await request<WorktreeTaskRecord>(
    'POST',
    `/api/projects/${registered.payload.id}/tasks`,
    { title: 'Revert safely' },
  );
  assert.equal(second.status, 201);
  writeFileSync(path.join(second.payload.worktreePath, 'tracked.txt'), 'temporary\n', 'utf8');
  writeFileSync(path.join(second.payload.worktreePath, 'remove-me.txt'), 'temporary\n', 'utf8');
  const beforeRun = await request<WorktreeChangesSnapshot>(
    'GET',
    `/api/tasks/${second.payload.id}/changes`,
  );

  const providers = await request<ProviderRegistrySnapshot>('GET', '/api/providers');
  const custom = await request<ProviderRegistrySnapshot>('POST', '/api/providers', {
    expectedProviderRevision: providers.payload.revision,
    providerId: 'acp.worktree-hold',
    displayName: 'Worktree Hold',
    command: process.execPath,
    args: [acpFixture],
  });
  const enabled = await request<ProviderRegistrySnapshot>(
    'PATCH',
    '/api/providers/acp.worktree-hold',
    { expectedProviderRevision: custom.payload.revision, enabled: true },
  );
  const acceptedSession = await request<WorkbenchSession>('POST', '/api/sessions', {
    workspacePath: created.payload.worktreePath,
    providerId: 'acp.worktree-hold',
    expectedProviderRevision: enabled.payload.revision,
    approvalPolicy: 'manual',
  });
  const closedTaskRun = await request<{ code: string }>(
    'POST',
    `/api/sessions/${acceptedSession.payload.id}/runs`,
    {
      prompt: 'must not mutate an accepted task',
      mode: 'execute',
      expectedProviderRevision: enabled.payload.revision,
    },
  );
  assert.equal(closedTaskRun.status, 409);
  assert.equal(closedTaskRun.payload.code, 'task_workspace_closed');
  const session = await request<WorkbenchSession>('POST', '/api/sessions', {
    workspacePath: second.payload.worktreePath,
    providerId: 'acp.worktree-hold',
    expectedProviderRevision: enabled.payload.revision,
    approvalPolicy: 'manual',
  });
  const competingSession = await request<WorkbenchSession>('POST', '/api/sessions', {
    workspacePath: second.payload.worktreePath,
    providerId: 'acp.worktree-hold',
    expectedProviderRevision: enabled.payload.revision,
    approvalPolicy: 'manual',
  });
  const competingRuns = await Promise.all(
    [session.payload.id, competingSession.payload.id].map((sessionId) =>
      request<{ run?: { id: string }; code?: string }>(
        'POST',
        `/api/sessions/${sessionId}/runs`,
        {
          prompt: 'hold while changes are protected',
          mode: 'execute',
          expectedProviderRevision: enabled.payload.revision,
        },
      ),
    ),
  );
  assert.deepEqual(
    competingRuns.map((candidate) => candidate.status).sort(),
    [201, 409],
    'Only one provider run may prepare against a task worktree at a time',
  );
  const rejectedRun = competingRuns.find((candidate) => candidate.status === 409)!;
  assert.equal(rejectedRun.payload.code, 'task_workspace_busy');
  const run = competingRuns.find((candidate) => candidate.status === 201)!;
  assert.ok(run.payload.run);
  await waitForRun(run.payload.run.id, ['running']);
  const fencedRevert = await request<{ code: string }>(
    'POST',
    `/api/tasks/${second.payload.id}/revert`,
    { expectedVersion: beforeRun.payload.version },
  );
  assert.equal(fencedRevert.status, 409);
  assert.equal(fencedRevert.payload.code, 'task_conflict');
  await request('POST', `/api/runs/${run.payload.run.id}/cancel`);
  await waitForRun(run.payload.run.id, ['cancelled']);

  appendFileSync(path.join(second.payload.worktreePath, 'tracked.txt'), 'stale\n', 'utf8');
  const staleRevert = await request<{ code: string }>(
    'POST',
    `/api/tasks/${second.payload.id}/revert`,
    { expectedVersion: beforeRun.payload.version },
  );
  assert.equal(staleRevert.status, 409);
  assert.equal(staleRevert.payload.code, 'stale_changes');
  const freshRevert = await request<WorktreeChangesSnapshot>(
    'GET',
    `/api/tasks/${second.payload.id}/changes`,
  );
  const reverted = await request<WorktreeChangesSnapshot>(
    'POST',
    `/api/tasks/${second.payload.id}/revert`,
    { expectedVersion: freshRevert.payload.version },
  );
  assert.equal(reverted.status, 200);
  assert.equal(reverted.payload.clean, true);
  assert.equal(reverted.payload.task.status, 'reverted');
  assert.equal(readText(path.join(second.payload.worktreePath, 'tracked.txt')), 'base\n');
  assert.equal(existsSync(path.join(second.payload.worktreePath, 'remove-me.txt')), false);

  const boundedTask = await request<WorktreeTaskRecord>(
    'POST',
    `/api/projects/${registered.payload.id}/tasks`,
    { title: 'Bounded review' },
  );
  assert.equal(boundedTask.status, 201);
  writeFileSync(
    path.join(boundedTask.payload.worktreePath, 'large.txt'),
    Buffer.alloc(600 * 1024, 'w'),
  );
  const boundedReview = await request<WorktreeChangesSnapshot>(
    'GET',
    `/api/tasks/${boundedTask.payload.id}/changes`,
  );
  assert.equal(boundedReview.payload.diffTruncated, true);
  assert.ok(Buffer.byteLength(boundedReview.payload.diff, 'utf8') <= 512 * 1024);
  const blindAccept = await request<{ code: string }>(
    'POST',
    `/api/tasks/${boundedTask.payload.id}/accept`,
    { expectedVersion: boundedReview.payload.version, commitMessage: 'Must not accept blind' },
  );
  assert.equal(blindAccept.status, 409);
  assert.equal(blindAccept.payload.code, 'task_conflict');
  const boundedRevert = await request<WorktreeChangesSnapshot>(
    'POST',
    `/api/tasks/${boundedTask.payload.id}/revert`,
    { expectedVersion: boundedReview.payload.version },
  );
  assert.equal(boundedRevert.status, 200);
  assert.equal(boundedRevert.payload.clean, true);

  const binaryTask = await request<WorktreeTaskRecord>(
    'POST',
    `/api/projects/${registered.payload.id}/tasks`,
    { title: 'Binary review guard' },
  );
  writeFileSync(
    path.join(binaryTask.payload.worktreePath, 'opaque.bin'),
    Buffer.from([0xff, 0x00, 0xfe]),
  );
  const binaryReview = await request<WorktreeChangesSnapshot>(
    'GET',
    `/api/tasks/${binaryTask.payload.id}/changes`,
  );
  assert.equal(binaryReview.payload.diffTruncated, true);
  assert.match(binaryReview.payload.diff, /Binary file not expanded/);
  const binaryAccept = await request<{ code: string }>(
    'POST',
    `/api/tasks/${binaryTask.payload.id}/accept`,
    { expectedVersion: binaryReview.payload.version, commitMessage: 'Must not accept binary' },
  );
  assert.equal(binaryAccept.status, 409);
  assert.equal(binaryAccept.payload.code, 'task_conflict');

  const internalLinkTask = await request<WorktreeTaskRecord>(
    'POST',
    `/api/projects/${registered.payload.id}/tasks`,
    { title: 'Internal identity guard' },
  );
  git(projectRoot, ['worktree', 'remove', '--force', internalLinkTask.payload.worktreePath]);
  symlinkSync(second.payload.worktreePath, internalLinkTask.payload.worktreePath, 'junction');
  const wrongIdentity = await request<{ code: string }>(
    'GET',
    `/api/tasks/${internalLinkTask.payload.id}/changes`,
  );
  assert.equal(wrongIdentity.status, 409);
  assert.equal(wrongIdentity.payload.code, 'task_conflict');

  const escapeTask = await request<WorktreeTaskRecord>(
    'POST',
    `/api/projects/${registered.payload.id}/tasks`,
    { title: 'Containment guard' },
  );
  git(projectRoot, ['worktree', 'remove', '--force', escapeTask.payload.worktreePath]);
  symlinkSync(outsideRoot, escapeTask.payload.worktreePath, 'junction');
  const escaped = await request<{ code: string }>(
    'GET',
    `/api/tasks/${escapeTask.payload.id}/changes`,
  );
  assert.equal(escaped.status, 409);
  assert.equal(escaped.payload.code, 'task_conflict');

  // A git_failed response must carry a friendly message, never raw git stderr.
  const hiddenGitPath = path.join(projectRoot, '.git-hidden-for-validation');
  renameSync(path.join(projectRoot, '.git'), hiddenGitPath);
  let gitFailed: { status: number; payload: { error: string; code: string } };
  try {
    gitFailed = await request<{ error: string; code: string }>(
      'POST',
      `/api/projects/${registered.payload.id}/tasks`,
      { title: 'Friendly git failure' },
    );
  } finally {
    renameSync(hiddenGitPath, path.join(projectRoot, '.git'));
  }
  assert.equal(gitFailed.status, 409);
  assert.equal(gitFailed.payload.code, 'git_failed');
  assert.doesNotMatch(
    gitFailed.payload.error,
    /fatal:/,
    'sendWorktreeError must not emit raw git stderr for git_failed errors',
  );

  const projectList = await request<{
    projects: Array<{ project: ProjectRecord; tasks: WorktreeTaskRecord[] }>;
  }>('GET', '/api/projects');
  assert.equal(projectList.status, 200);
  assert.equal(projectList.payload.projects[0]?.tasks.length, 6);

  process.stdout.write(
    'Project worktree validation passed: repository-root registration, non-Git folder rejection with friendly errors, clean-base task isolation, bounded and binary-safe review, stale-review fencing, one-run task reservations, accept commits, destructive revert, main-worktree preservation, Git identity binding, junction containment, and stderr-free Git failure responses.\n',
  );
} finally {
  delete process.env.CODEWAVE_MINIMAL_ACP_HOLD;
  if (daemon) await daemon.stop().catch(() => undefined);
  rmSync(daemonRoot, { recursive: true, force: true });
}
