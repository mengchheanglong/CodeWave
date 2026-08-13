import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProjectListResponse,
  ProjectTaskGroup,
  WorktreeChangesSnapshot,
  WorktreeTaskRecord,
} from '@codewave/protocol';
import { DiffCard } from '@codewave/ui-kit';
import { createDaemonApi } from '../lib/daemon-api';
import { PromptModal } from './PromptModal';
import { CheckIcon, PlusIcon, RefreshIcon, WorkflowIcon } from './icons';

type ProjectChangesPanelProps = {
  workspacePath: string;
  hasActiveRun: boolean;
  onOpenWorkspace: (workspacePath: string) => Promise<void>;
};

function comparablePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return navigator.userAgent.toLowerCase().includes('windows')
    ? normalized.toLowerCase()
    : normalized;
}

function statusCopy(task: WorktreeTaskRecord): string {
  if (task.status === 'accepted') return 'Accepted commit';
  if (task.status === 'reverted') return 'Reverted';
  return 'Active task';
}

export function ProjectChangesPanel({
  workspacePath,
  hasActiveRun,
  onOpenWorkspace,
}: ProjectChangesPanelProps) {
  const apiRef = useRef(createDaemonApi());
  const titleInputRef = useRef<HTMLInputElement>(null);
  const refreshSequenceRef = useRef(0);
  const [registry, setRegistry] = useState<ProjectListResponse>({ projects: [] });
  const [changes, setChanges] = useState<WorktreeChangesSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);

  const normalizedWorkspace = comparablePath(workspacePath);
  const activeGroup = useMemo(
    () =>
      registry.projects.find(
        (group) => comparablePath(group.project.rootPath) === normalizedWorkspace,
      ) ?? null,
    [normalizedWorkspace, registry.projects],
  );
  const taskContext = useMemo(() => {
    for (const group of registry.projects) {
      const task = group.tasks.find(
        (entry) => comparablePath(entry.worktreePath) === normalizedWorkspace,
      );
      if (task) return { group, task };
    }
    return null;
  }, [normalizedWorkspace, registry.projects]);

  async function refresh(): Promise<void> {
    const sequence = ++refreshSequenceRef.current;
    setLoading(true);
    setError(null);
    try {
      const nextRegistry = await apiRef.current.getProjects();
      const nextTask = nextRegistry.projects
        .flatMap((group) => group.tasks)
        .find((task) => comparablePath(task.worktreePath) === normalizedWorkspace);
      const nextChanges = nextTask
        ? await apiRef.current.getWorktreeChanges(nextTask.id)
        : null;
      if (sequence !== refreshSequenceRef.current) return;
      setRegistry(nextRegistry);
      setChanges(nextChanges);
    } catch (caught) {
      if (sequence !== refreshSequenceRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Projects could not be loaded.');
    } finally {
      if (sequence === refreshSequenceRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequenceRef.current += 1;
    };
    // The workspace identity is the lifecycle boundary for this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedWorkspace]);

  useEffect(() => {
    if (!creating) return;
    const frame = window.requestAnimationFrame(() => titleInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [creating]);

  async function registerCurrentProject(): Promise<void> {
    if (!workspacePath.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRef.current.createProject({ rootPath: workspacePath });
      setNotice('Git project registered. You can now create isolated tasks.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Project could not be registered.');
    } finally {
      setBusy(false);
    }
  }

  async function createTask(group: ProjectTaskGroup): Promise<void> {
    const title = taskTitle.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let task: WorktreeTaskRecord;
      try {
        task = await apiRef.current.createWorktreeTask(group.project.id, { title });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Task could not be created.');
        return;
      }
      setTaskTitle('');
      setCreating(false);
      setNotice('Isolated task created. Opening its dedicated worktree…');
      await refresh();
      try {
        await onOpenWorkspace(task.worktreePath);
      } catch (caught) {
        setNotice('The task is safe and available in this project list.');
        setError(
          caught instanceof Error
            ? `Task created, but its workspace could not be opened: ${caught.message}`
            : 'Task created, but its workspace could not be opened.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function accept(commitMessage: string): Promise<void> {
    if (!changes) return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiRef.current.acceptWorktreeChanges(changes.task.id, {
        expectedVersion: changes.version,
        commitMessage,
      });
      setChanges(next);
      setNotice(`Accepted as ${next.task.acceptedCommit?.slice(0, 8) ?? 'a task commit'}.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Changes could not be accepted.');
    } finally {
      setBusy(false);
    }
  }

  async function revert(): Promise<void> {
    if (!changes) return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiRef.current.revertWorktreeChanges(changes.task.id, {
        expectedVersion: changes.version,
      });
      setChanges(next);
      setNotice('Task changes reverted. The project worktree was not touched.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Changes could not be reverted.');
    } finally {
      setBusy(false);
    }
  }

  if (!workspacePath.trim()) {
    return (
      <div className="project-changes-empty">
        <WorkflowIcon size={20} />
        <strong>Open a Git project</strong>
        <p>CodeWave will isolate each agent task in its own worktree.</p>
      </div>
    );
  }

  return (
    <div className="project-changes-panel" aria-busy={loading || busy}>
      <div className="project-changes-toolbar">
        <div>
          <span className="eyebrow">Git isolation</span>
          <strong>{taskContext?.task.title ?? activeGroup?.project.name ?? 'Current workspace'}</strong>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh project changes"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          <RefreshIcon size={14} />
        </button>
      </div>

      {error ? <div className="project-changes-message error" role="alert">{error}</div> : null}
      {notice ? <div className="project-changes-message" role="status">{notice}</div> : null}
      {loading ? <div className="project-changes-loading" role="status">Inspecting Git state…</div> : null}

      {!loading && !activeGroup && !taskContext ? (
        <section className="project-register-card">
          <WorkflowIcon size={18} />
          <div>
            <strong>Make this a CodeWave project</strong>
            <p>Register the Git root before creating isolated agent tasks. No files are moved.</p>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void registerCurrentProject()}
          >
            Register project
          </button>
        </section>
      ) : null}

      {!loading && activeGroup ? (
        <section className="project-task-list">
          <div className="project-task-list-heading">
            <div>
              <strong>Isolated tasks</strong>
              <span>{activeGroup.project.defaultBranch} · {activeGroup.tasks.length} total</span>
            </div>
            <button
              type="button"
              aria-expanded={creating}
              onClick={() => setCreating((current) => !current)}
            >
              <PlusIcon size={13} /> {creating ? 'Cancel' : 'New task'}
            </button>
          </div>
          {creating ? (
            <form
              className="project-task-create"
              onSubmit={(event) => {
                event.preventDefault();
                void createTask(activeGroup);
              }}
            >
              <label htmlFor="project-task-title">Task title</label>
              <input
                ref={titleInputRef}
                id="project-task-title"
                value={taskTitle}
                maxLength={120}
                placeholder="Implement the settings flow"
                onChange={(event) => setTaskTitle(event.target.value)}
              />
              <small>Creates a new branch and worktree from the clean {activeGroup.project.defaultBranch} checkout.</small>
              <button type="submit" className="primary-button" disabled={!taskTitle.trim() || busy}>
                Create & open task
              </button>
            </form>
          ) : null}
          <div className="project-task-items">
            {activeGroup.tasks.length === 0 ? (
              <div className="project-task-empty">No isolated tasks yet.</div>
            ) : (
              activeGroup.tasks.map((task) => (
                <article key={task.id} className="project-task-item">
                  <span className={`project-task-status ${task.status}`} aria-hidden="true"></span>
                  <div>
                    <strong>{task.title}</strong>
                    <span>{statusCopy(task)} · {task.branchName}</span>
                  </div>
                  <button type="button" disabled={busy} onClick={() => void onOpenWorkspace(task.worktreePath)}>
                    Open
                  </button>
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      {!loading && taskContext && changes ? (
        <section className="task-review-panel">
          <div className="task-review-summary">
            <div className={`task-review-mark ${changes.clean ? 'clean' : 'dirty'}`}>
              {changes.clean ? <CheckIcon size={16} /> : changes.changes.length}
            </div>
            <div>
              <strong>{changes.clean ? 'Worktree is clean' : `${changes.changes.length} changed ${changes.changes.length === 1 ? 'file' : 'files'}`}</strong>
              <span>{statusCopy(changes.task)} · {changes.task.branchName}</span>
            </div>
          </div>

          {hasActiveRun ? (
            <div className="project-changes-message">Accept and revert unlock after the active run finishes.</div>
          ) : null}

          {changes.changes.length > 0 ? (
            <div className="task-change-files" aria-label="Changed files">
              {changes.changes.map((change) => (
                <div key={`${change.path}:${change.originalPath ?? ''}`} className="task-change-file">
                  <span className={`task-change-kind ${change.kind}`}>{change.kind.slice(0, 1).toUpperCase()}</span>
                  <span title={change.path}>{change.path}</span>
                  <code>{change.indexStatus}{change.worktreeStatus}</code>
                </div>
              ))}
            </div>
          ) : null}

          {changes.diff ? (
            <div className="task-diff-shell">
              <DiffCard diff={changes.diff} fileName="Task changes" initialLines={60} />
              {changes.diffTruncated ? (
                <p className="task-diff-warning">Diff stopped at {changes.maxDiffBytes.toLocaleString()} bytes. Review the remaining files outside CodeWave before accepting.</p>
              ) : null}
            </div>
          ) : null}

          {changes.task.status === 'active' && !changes.clean ? (
            <div className="task-review-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy || hasActiveRun}
                onClick={() => setRevertOpen(true)}
              >
                Revert task
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || hasActiveRun || changes.diffTruncated}
                onClick={() => setAcceptOpen(true)}
              >
                Accept changes
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <PromptModal
        isOpen={acceptOpen}
        title="Accept task changes"
        subtitle="Create a commit on this isolated task branch. The main project branch is not merged or modified."
        placeholder="Commit message"
        defaultValue={taskContext ? `CodeWave: ${taskContext.task.title}` : 'CodeWave task changes'}
        confirmLabel="Create task commit"
        onConfirm={(message) => void accept(message)}
        onClose={() => setAcceptOpen(false)}
      />
      <PromptModal
        isOpen={revertOpen}
        title="Revert all task changes?"
        subtitle="Tracked edits will reset to the task HEAD and non-ignored untracked files will be deleted. The main project worktree remains untouched."
        confirmLabel="Revert task changes"
        mode="confirm"
        destructive
        onConfirm={() => void revert()}
        onClose={() => setRevertOpen(false)}
      />
    </div>
  );
}
