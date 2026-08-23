import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  createReadStream,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import type {
  AcceptWorktreeChangesRequest,
  CreateProjectRequest,
  CreateWorktreeTaskRequest,
  ProjectRecord,
  RevertWorktreeChangesRequest,
  WorktreeChangeKind,
  WorktreeChangeRecord,
  WorktreeChangesSnapshot,
  WorktreeTaskRecord,
} from '@codewave/protocol';
import type { SQLiteStateStore } from '@codewave/state';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024;
export const MAX_WORKTREE_DIFF_BYTES = 512 * 1024;
const MAX_UNTRACKED_PREVIEW_BYTES = 128 * 1024;
const DISABLED_GIT_HOOKS_PATH = path.join(
  os.tmpdir(),
  `codewave-disabled-git-hooks-${randomUUID()}`,
);

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: DISABLED_GIT_HOOKS_PATH,
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
  };
}

export class WorktreeManagerError extends Error {
  /** Raw diagnostic detail for server-side logs only; never sent to clients. */
  declare readonly detail?: string;

  constructor(
    message: string,
    readonly code:
      | 'invalid_project'
      | 'invalid_task'
      | 'task_not_found'
      | 'task_closed'
      | 'task_conflict'
      | 'stale_changes'
      | 'git_failed',
  ) {
    super(message);
    this.name = 'WorktreeManagerError';
  }
}

type GitResult = { stdout: string };
type BoundedGitOutput = {
  output: string;
  truncated: boolean;
};

/**
 * Map raw Git stderr to a client-safe message. Raw stderr is never embedded in
 * error.message; it is attached separately as non-enumerable `detail` for
 * server-side logs only.
 */
function gitFailureDetail(failure: { stderr?: string; message?: string }): string {
  return (failure.stderr || failure.message || 'Git command failed.').trim().slice(0, 2_000);
}

function friendlyGitFailureMessage(stderr: string): string {
  if (/not a git repository/i.test(stderr)) {
    return 'That folder is not inside a Git repository.';
  }
  if (/Permission denied|could not read from remote|fatal: unable to access/i.test(stderr)) {
    return 'A Git operation failed due to access permissions.';
  }
  return 'A Git operation failed. Check the folder and try again.';
}

function gitFailedError(failure: { stderr?: string; message?: string }): WorktreeManagerError {
  const detail = gitFailureDetail(failure);
  const error = new WorktreeManagerError(friendlyGitFailureMessage(detail), 'git_failed');
  Object.defineProperty(error, 'detail', {
    value: detail,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return error;
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<GitResult> {
  try {
    const result = await execFileAsync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: 20_000,
      windowsHide: true,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      env: gitEnvironment(),
    });
    return { stdout: result.stdout };
  } catch (error) {
    throw gitFailedError(error as { stderr?: string; message?: string });
  }
}

async function runGitBounded(
  cwd: string,
  args: string[],
  retainBytes: number,
): Promise<BoundedGitOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', cwd, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: gitEnvironment(),
    });
    const retained: Buffer[] = [];
    const stderr: Buffer[] = [];
    let retainedLength = 0;
    let totalLength = 0;
    let stderrLength = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 20_000);

    child.stdout.on('data', (value: Buffer) => {
      const chunk = Buffer.from(value);
      totalLength += chunk.length;
      if (retainedLength < retainBytes) {
        const slice = chunk.subarray(0, retainBytes - retainedLength);
        retained.push(slice);
        retainedLength += slice.length;
      }
    });
    child.stderr.on('data', (value: Buffer) => {
      if (stderrLength >= 64 * 1024) return;
      const chunk = Buffer.from(value).subarray(0, 64 * 1024 - stderrLength);
      stderr.push(chunk);
      stderrLength += chunk.length;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(new WorktreeManagerError(`Git operation failed: ${error.message}`, 'git_failed'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new WorktreeManagerError('Git diff exceeded the 20 second limit.', 'git_failed'));
        return;
      }
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        reject(
          detail
            ? gitFailedError({ stderr: detail })
            : new WorktreeManagerError(
                `Git operation failed: git exited with code ${String(code)}`,
                'git_failed',
              ),
        );
        return;
      }
      resolve({
        output: Buffer.concat(retained).toString('utf8'),
        truncated: totalLength > retainBytes,
      });
    });
  });
}

function normalizeOneLine(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (typeof value !== 'string') {
    throw new WorktreeManagerError(`${field} must be a string.`, 'invalid_task');
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || /[\r\n\0]/.test(normalized)) {
    throw new WorktreeManagerError(
      `${field} must be one line and 1-${maximumLength} characters.`,
      'invalid_task',
    );
  }
  return normalized;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'task'
  );
}

function classifyChange(indexStatus: string, worktreeStatus: string): WorktreeChangeKind {
  const pair = `${indexStatus}${worktreeStatus}`;
  if (pair === '??') return 'untracked';
  if (pair.includes('U') || pair === 'AA' || pair === 'DD') return 'conflicted';
  if (pair.includes('R')) return 'renamed';
  if (pair.includes('C')) return 'copied';
  if (pair.includes('D')) return 'deleted';
  if (pair.includes('A')) return 'added';
  return 'modified';
}

function parsePorcelainStatus(raw: string): WorktreeChangeRecord[] {
  const entries = raw.split('\0');
  const changes: WorktreeChangeRecord[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.length < 3) continue;
    const indexStatus = entry[0] ?? ' ';
    const worktreeStatus = entry[1] ?? ' ';
    const filePath = entry.slice(3);
    let originalPath: string | null = null;
    if (indexStatus === 'R' || indexStatus === 'C') {
      originalPath = entries[index + 1] || null;
      index += 1;
    }
    changes.push({
      path: filePath,
      originalPath,
      kind: classifyChange(indexStatus, worktreeStatus),
      indexStatus,
      worktreeStatus,
    });
  }
  return changes;
}

function untrackedPreview(
  worktreeRoot: string,
  relativePath: string,
): { content: string; truncated: boolean } {
  const absolutePath = path.resolve(worktreeRoot, relativePath);
  if (!isPathInside(worktreeRoot, absolutePath)) return { content: '', truncated: false };
  let metadata;
  try {
    metadata = lstatSync(absolutePath);
  } catch {
    return { content: '', truncated: false };
  }
  const header = `diff --git a/${relativePath} b/${relativePath}\nnew file\n`;
  if (metadata.isSymbolicLink()) {
    return { content: `${header}[Untracked symbolic link not expanded]\n`, truncated: true };
  }
  if (!metadata.isFile()) {
    return { content: `${header}[Untracked non-file entry not expanded]\n`, truncated: true };
  }
  const realFile = realpathSync.native(absolutePath);
  const realRoot = realpathSync.native(worktreeRoot);
  if (!isPathInside(realRoot, realFile)) {
    return {
      content: `${header}[Untracked path outside the worktree not expanded]\n`,
      truncated: true,
    };
  }
  const length = Math.min(metadata.size, MAX_UNTRACKED_PREVIEW_BYTES);
  const buffer = Buffer.alloc(length);
  const descriptor = openSync(realFile, 'r');
  let bytesRead = 0;
  try {
    bytesRead = readSync(descriptor, buffer, 0, length, 0);
  } finally {
    closeSync(descriptor);
  }
  const content = buffer.subarray(0, bytesRead);
  if (content.includes(0)) {
    return { content: `${header}[Binary file not expanded]\n`, truncated: true };
  }
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    return { content: `${header}[Non-UTF-8 file not expanded]\n`, truncated: true };
  }
  const body = decoded
    .split(/\r?\n/)
    .map((line) => `+${line}`)
    .join('\n');
  const truncated = metadata.size > length ? '\n+[Preview truncated]' : '';
  return {
    content: `${header}--- /dev/null\n+++ b/${relativePath}\n${body}${truncated}\n`,
    truncated: metadata.size > length,
  };
}

async function hashChangedFileState(
  worktreeRoot: string,
  changes: WorktreeChangeRecord[],
): Promise<string> {
  const relativePaths = new Set<string>();
  for (const change of changes) {
    relativePaths.add(change.path);
    if (change.originalPath) relativePaths.add(change.originalPath);
  }
  const digest = createHash('sha256');
  for (const relativePath of [...relativePaths].sort()) {
    const absolutePath = path.resolve(worktreeRoot, relativePath);
    if (!isPathInside(worktreeRoot, absolutePath)) {
      throw new WorktreeManagerError('Git reported a path outside the task worktree.', 'task_conflict');
    }
    digest.update(relativePath).update('\0');
    let metadata;
    try {
      metadata = lstatSync(absolutePath);
    } catch {
      digest.update('missing\0');
      continue;
    }
    digest.update(String(metadata.mode)).update('\0').update(String(metadata.size)).update('\0');
    if (metadata.isSymbolicLink()) {
      digest.update('symlink\0').update(readlinkSync(absolutePath)).update('\0');
      continue;
    }
    if (!metadata.isFile()) {
      digest.update(metadata.isDirectory() ? 'directory\0' : 'other\0');
      continue;
    }
    digest.update('file\0');
    for await (const chunk of createReadStream(absolutePath)) {
      digest.update(chunk as Buffer);
    }
    digest.update('\0');
  }
  return digest.digest('hex');
}

export class WorktreeManager {
  private readonly managedRoot: string;
  private readonly managedRootRealPath: string;
  private readonly busyTasks = new Set<string>();
  private readonly runReservedTasks = new Set<string>();

  constructor(
    rootPath: string,
    private readonly stateStore: SQLiteStateStore,
  ) {
    this.managedRoot = path.resolve(rootPath, '.codewave', 'worktrees');
    mkdirSync(this.managedRoot, { recursive: true });
    this.managedRootRealPath = realpathSync.native(this.managedRoot);
  }

  listProjects(): Array<{ project: ProjectRecord; tasks: WorktreeTaskRecord[] }> {
    return this.stateStore.listProjects().map((project) => ({
      project,
      tasks: this.stateStore.listWorktreeTasks(project.id),
    }));
  }

  private assertManagedRoot(): void {
    if (
      !existsSync(this.managedRoot) ||
      !samePath(this.managedRootRealPath, realpathSync.native(this.managedRoot))
    ) {
      throw new WorktreeManagerError(
        'The daemon-managed worktree root moved or changed identity.',
        'task_conflict',
      );
    }
  }

  async registerProject(input: CreateProjectRequest): Promise<ProjectRecord> {
    if (typeof input.rootPath !== 'string' || !path.isAbsolute(input.rootPath)) {
      throw new WorktreeManagerError(
        'Project rootPath must be an absolute path.',
        'invalid_project',
      );
    }
    const requestedPath = path.resolve(input.rootPath);
    if (!existsSync(requestedPath) || !statSync(requestedPath).isDirectory()) {
      throw new WorktreeManagerError('Project rootPath must be an existing directory.', 'invalid_project');
    }
    const rootPath = realpathSync.native(requestedPath);
    let insideWorkTree: GitResult;
    try {
      insideWorkTree = await runGit(rootPath, ['rev-parse', '--is-inside-work-tree']);
    } catch {
      insideWorkTree = { stdout: '' };
    }
    if (insideWorkTree.stdout.trim() !== 'true') {
      throw new WorktreeManagerError(
        'The project folder is not a Git repository. Open a Git repository root to register it.',
        'invalid_project',
      );
    }
    const topLevel = (await runGit(rootPath, ['rev-parse', '--show-toplevel'])).stdout.trim();
    const canonicalTopLevel = realpathSync.native(path.resolve(topLevel));
    if (!samePath(rootPath, canonicalTopLevel)) {
      throw new WorktreeManagerError(
        'Choose the Git repository root, not a nested folder.',
        'invalid_project',
      );
    }
    const existing = this.stateStore
      .listProjects()
      .find((project) => samePath(project.rootPath, canonicalTopLevel));
    if (existing) return existing;
    let defaultBranch: string;
    try {
      defaultBranch = (
        await runGit(rootPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
      ).stdout.trim();
    } catch {
      throw new WorktreeManagerError(
        'The project must be on a named branch before CodeWave can create tasks.',
        'invalid_project',
      );
    }
    const name = input.name === undefined
      ? normalizeOneLine(path.basename(rootPath), 'Project name', 80)
      : normalizeOneLine(input.name, 'Project name', 80);
    return this.stateStore.createProject({
      id: randomUUID(),
      name,
      rootPath,
      defaultBranch,
      createdAt: new Date().toISOString(),
    });
  }

  async createTask(
    projectId: string,
    input: CreateWorktreeTaskRequest,
  ): Promise<WorktreeTaskRecord> {
    this.assertManagedRoot();
    const project = this.stateStore.getProject(projectId);
    if (!project) {
      throw new WorktreeManagerError('Project not found.', 'invalid_project');
    }
    if (!existsSync(project.rootPath) || !samePath(project.rootPath, realpathSync.native(project.rootPath))) {
      throw new WorktreeManagerError(
        'The registered project root moved or changed identity.',
        'task_conflict',
      );
    }
    const title = normalizeOneLine(input.title, 'Task title', 120);
    const baseRef = input.baseRef?.trim() || 'HEAD';
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(baseRef)) {
      throw new WorktreeManagerError('baseRef contains unsupported characters.', 'invalid_task');
    }
    const projectStatus = (await runGit(project.rootPath, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ])).stdout;
    if (projectStatus) {
      throw new WorktreeManagerError(
        'The project worktree must be clean before creating an isolated task.',
        'task_conflict',
      );
    }
    const baseCommit = (
      await runGit(project.rootPath, ['rev-parse', '--verify', `${baseRef}^{commit}`])
    ).stdout.trim();
    const id = randomUUID();
    const branchName = `codewave/task-${slugify(title)}-${id.slice(0, 8)}`;
    const worktreePath = path.join(
      this.managedRoot,
      project.id,
      `${slugify(title)}-${id.slice(0, 8)}`,
    );
    if (!isPathInside(this.managedRoot, worktreePath) || existsSync(worktreePath)) {
      throw new WorktreeManagerError('Managed worktree path is unavailable.', 'task_conflict');
    }
    mkdirSync(path.dirname(worktreePath), { recursive: true });
    try {
      await runGit(project.rootPath, [
        'worktree',
        'add',
        '-b',
        branchName,
        '--',
        worktreePath,
        baseCommit,
      ]);
      const canonicalWorktree = realpathSync.native(worktreePath);
      if (!isPathInside(this.managedRootRealPath, canonicalWorktree)) {
        throw new WorktreeManagerError(
          'Created worktree escaped the daemon-managed root.',
          'task_conflict',
        );
      }
      const now = new Date().toISOString();
      return this.stateStore.createWorktreeTask({
        id,
        projectId: project.id,
        title,
        branchName,
        baseRef,
        baseCommit,
        worktreePath: canonicalWorktree,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        acceptedCommit: null,
      });
    } catch (error) {
      if (existsSync(worktreePath)) {
        await runGit(project.rootPath, ['worktree', 'remove', '--force', '--', worktreePath]).catch(
          () => undefined,
        );
      }
      await runGit(project.rootPath, ['branch', '-D', '--', branchName]).catch(() => undefined);
      throw error;
    }
  }

  getTask(taskId: string): WorktreeTaskRecord {
    const task = this.stateStore.getWorktreeTask(taskId);
    if (!task) throw new WorktreeManagerError('Task not found.', 'task_not_found');
    return task;
  }

  reserveRunForWorkspace(
    workspacePath: string,
  ): { taskId: string; release: () => void } | WorktreeManagerError | null {
    const task = this.stateStore
      .listWorktreeTasks()
      .find(
        (candidate) => samePath(candidate.worktreePath, workspacePath),
      );
    if (!task) return null;
    if (task.status !== 'active') {
      return new WorktreeManagerError(
        'This task is already accepted or reverted. Create a new isolated task before starting another provider run.',
        'task_closed',
      );
    }
    if (this.busyTasks.has(task.id) || this.runReservedTasks.has(task.id)) {
      return new WorktreeManagerError(
        'Another run or change decision is already being prepared for this task workspace.',
        'task_conflict',
      );
    }
    this.runReservedTasks.add(task.id);
    let released = false;
    return {
      taskId: task.id,
      release: () => {
        if (released) return;
        released = true;
        this.runReservedTasks.delete(task.id);
      },
    };
  }

  private assertManagedTask(task: WorktreeTaskRecord): void {
    if (!existsSync(task.worktreePath)) {
      throw new WorktreeManagerError('The task worktree no longer exists.', 'task_conflict');
    }
    const realTaskPath = realpathSync.native(task.worktreePath);
    if (
      !isPathInside(this.managedRootRealPath, realTaskPath) ||
      !samePath(task.worktreePath, realTaskPath)
    ) {
      throw new WorktreeManagerError(
        'The task worktree moved, became a link, or escaped the daemon-managed root.',
        'task_conflict',
      );
    }
  }

  private async assertTaskGitIdentity(task: WorktreeTaskRecord): Promise<void> {
    this.assertManagedTask(task);
    const project = this.stateStore.getProject(task.projectId);
    if (!project || !existsSync(project.rootPath)) {
      throw new WorktreeManagerError(
        'The registered project for this task is unavailable.',
        'task_conflict',
      );
    }
    const [topLevel, branch, taskCommonDirectory, projectCommonDirectory] = await Promise.all([
      runGit(task.worktreePath, ['rev-parse', '--show-toplevel']),
      runGit(task.worktreePath, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
      runGit(task.worktreePath, ['rev-parse', '--git-common-dir']),
      runGit(project.rootPath, ['rev-parse', '--git-common-dir']),
    ]);
    const canonicalTopLevel = realpathSync.native(path.resolve(topLevel.stdout.trim()));
    const taskCommonPath = realpathSync.native(
      path.resolve(task.worktreePath, taskCommonDirectory.stdout.trim()),
    );
    const projectCommonPath = realpathSync.native(
      path.resolve(project.rootPath, projectCommonDirectory.stdout.trim()),
    );
    if (
      !samePath(canonicalTopLevel, task.worktreePath) ||
      branch.stdout.trim() !== task.branchName ||
      !samePath(taskCommonPath, projectCommonPath)
    ) {
      throw new WorktreeManagerError(
        'The task path no longer identifies its registered Git worktree and branch.',
        'task_conflict',
      );
    }
  }

  async changes(taskId: string): Promise<WorktreeChangesSnapshot> {
    const task = this.getTask(taskId);
    await this.assertTaskGitIdentity(task);
    const headCommit = (await runGit(task.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
    const statusRaw = (
      await runGit(task.worktreePath, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
      ])
    ).stdout;
    const changes = parsePorcelainStatus(statusRaw);
    const trackedDiff = await runGitBounded(
      task.worktreePath,
      [
        'diff',
        '--binary',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        'HEAD',
        '--',
      ],
      MAX_WORKTREE_DIFF_BYTES,
    );
    const untrackedPreviews = changes
      .filter((change) => change.kind === 'untracked')
      .map((change) => untrackedPreview(task.worktreePath, change.path));
    const untrackedDiff = untrackedPreviews.map((preview) => preview.content).join('\n');
    const remainingBytes = Math.max(
      0,
      MAX_WORKTREE_DIFF_BYTES - Buffer.byteLength(trackedDiff.output, 'utf8'),
    );
    const untrackedBuffer = Buffer.from(untrackedDiff, 'utf8');
    const boundedDiff = `${trackedDiff.output}${untrackedBuffer
      .subarray(0, remainingBytes)
      .toString('utf8')}`;
    const diffTruncated =
      trackedDiff.truncated ||
      untrackedBuffer.length > remainingBytes ||
      untrackedPreviews.some((preview) => preview.truncated);
    const fileStateDigest = await hashChangedFileState(task.worktreePath, changes);
    const version = `sha256:${createHash('sha256')
      .update(headCommit)
      .update('\0')
      .update(fileStateDigest)
      .digest('hex')}`;
    return {
      task,
      headCommit,
      version,
      clean: changes.length === 0,
      changes,
      diff: boundedDiff,
      diffTruncated,
      maxDiffBytes: MAX_WORKTREE_DIFF_BYTES,
    };
  }

  async accept(
    taskId: string,
    input: AcceptWorktreeChangesRequest,
  ): Promise<WorktreeChangesSnapshot> {
    if (this.busyTasks.has(taskId) || this.runReservedTasks.has(taskId)) {
      throw new WorktreeManagerError(
        'Another run or change decision is already being prepared for this task workspace.',
        'task_conflict',
      );
    }
    this.busyTasks.add(taskId);
    try {
      const task = this.getTask(taskId);
      if (task.status !== 'active') {
        throw new WorktreeManagerError('Only active task changes can be accepted.', 'task_conflict');
      }
      const message = normalizeOneLine(input.commitMessage, 'Commit message', 160);
      const current = await this.changes(taskId);
      if (input.expectedVersion !== current.version) {
        throw new WorktreeManagerError(
          'Task changes changed after review. Refresh before accepting them.',
          'stale_changes',
        );
      }
      if (current.clean) {
        throw new WorktreeManagerError('The task has no changes to accept.', 'task_conflict');
      }
      if (current.diffTruncated) {
        throw new WorktreeManagerError(
          'The bounded review is incomplete. Review and commit this task with Git outside CodeWave.',
          'task_conflict',
        );
      }
      await runGit(task.worktreePath, ['add', '--all', '--']);
      const postStageStatus = parsePorcelainStatus(
        (
          await runGit(task.worktreePath, [
            'status',
            '--porcelain=v1',
            '-z',
            '--untracked-files=all',
          ])
        ).stdout,
      );
      if (postStageStatus.some((change) => change.worktreeStatus !== ' ')) {
        throw new WorktreeManagerError(
          'Files changed while CodeWave was accepting them. Refresh and review again.',
          'stale_changes',
        );
      }
      const postStage = await this.changes(taskId);
      if (postStage.version !== current.version) {
        throw new WorktreeManagerError(
          'Files changed while CodeWave was accepting them. Refresh and review again.',
          'stale_changes',
        );
      }
      await runGit(task.worktreePath, [
        'commit',
        '-m',
        message,
        '--no-verify',
        '--no-gpg-sign',
      ]);
      const acceptedCommit = (await runGit(task.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
      this.stateStore.updateWorktreeTaskStatus(
        taskId,
        'accepted',
        new Date().toISOString(),
        acceptedCommit,
      );
      return this.changes(taskId);
    } finally {
      this.busyTasks.delete(taskId);
    }
  }

  async revert(
    taskId: string,
    input: RevertWorktreeChangesRequest,
  ): Promise<WorktreeChangesSnapshot> {
    if (this.busyTasks.has(taskId) || this.runReservedTasks.has(taskId)) {
      throw new WorktreeManagerError(
        'Another run or change decision is already being prepared for this task workspace.',
        'task_conflict',
      );
    }
    this.busyTasks.add(taskId);
    try {
      const task = this.getTask(taskId);
      if (task.status !== 'active') {
        throw new WorktreeManagerError('Only active task changes can be reverted.', 'task_conflict');
      }
      const current = await this.changes(taskId);
      if (input.expectedVersion !== current.version) {
        throw new WorktreeManagerError(
          'Task changes changed after review. Refresh before reverting them.',
          'stale_changes',
        );
      }
      if (current.clean) {
        throw new WorktreeManagerError('The task has no changes to revert.', 'task_conflict');
      }
      await this.assertTaskGitIdentity(task);
      await runGit(task.worktreePath, ['reset', '--hard', 'HEAD']);
      await runGit(task.worktreePath, ['clean', '-fd', '--']);
      this.stateStore.updateWorktreeTaskStatus(
        taskId,
        'reverted',
        new Date().toISOString(),
        null,
      );
      return this.changes(taskId);
    } finally {
      this.busyTasks.delete(taskId);
    }
  }
}
