import '@testing-library/jest-dom';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ProjectListResponse,
  WorktreeChangesSnapshot,
  WorktreeTaskRecord,
} from '@codewave/protocol';
import { resetDaemonConnection } from '../lib/daemon-api';
import { ProjectChangesPanel } from './ProjectChangesPanel';

const project = {
  id: 'project-1',
  name: 'Wave project',
  rootPath: '/workspace/wave',
  defaultBranch: 'main',
  createdAt: '2026-08-13T00:00:00.000Z',
};
const task: WorktreeTaskRecord = {
  id: 'task-1',
  projectId: project.id,
  title: 'Calm settings flow',
  branchName: 'codewave/task-calm-settings-flow-task1',
  baseRef: 'HEAD',
  baseCommit: 'a'.repeat(40),
  worktreePath: '/workspace/tasks/calm-settings',
  status: 'active',
  createdAt: '2026-08-13T00:00:01.000Z',
  updatedAt: '2026-08-13T00:00:01.000Z',
  acceptedCommit: null,
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function handshakeResponse(): Response {
  return jsonResponse({
    connectionId: 'connection-1',
    protocolVersion: 1,
    serverName: 'CodeWave daemon',
    serverVersion: 'test',
    capabilities: [],
    availableScopes: [],
    grantedScopes: [],
    limits: {},
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }, 201);
}

function changes(overrides: Partial<WorktreeChangesSnapshot> = {}): WorktreeChangesSnapshot {
  return {
    task,
    headCommit: task.baseCommit,
    version: 'sha256:reviewed',
    clean: false,
    changes: [
      {
        path: 'src/settings.ts',
        originalPath: null,
        kind: 'modified',
        indexStatus: ' ',
        worktreeStatus: 'M',
      },
    ],
    diff: 'diff --git a/src/settings.ts b/src/settings.ts\n--- a/src/settings.ts\n+++ b/src/settings.ts\n@@ -1 +1 @@\n-old\n+calm',
    diffTruncated: false,
    maxDiffBytes: 524288,
    ...overrides,
  };
}

afterEach(() => {
  resetDaemonConnection();
  vi.restoreAllMocks();
});

describe('ProjectChangesPanel', () => {
  it('registers the current Git root and reveals isolated task creation', async () => {
    const user = userEvent.setup();
    let registered = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/handshake') return handshakeResponse();
      if (url === '/api/projects' && init?.method === 'POST') {
        registered = true;
        return jsonResponse(project, 201);
      }
      if (url === '/api/projects') {
        const payload: ProjectListResponse = {
          projects: registered ? [{ project, tasks: [] }] : [],
        };
        return jsonResponse(payload);
      }
      throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url}`);
    }));

    render(
      <ProjectChangesPanel
        workspacePath={project.rootPath}
        hasActiveRun={false}
        onOpenWorkspace={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Register project' }));
    expect(await screen.findByText('Isolated tasks')).toBeInTheDocument();
    expect(screen.getByText(/Git project registered/i)).toBeInTheDocument();
  });

  it('creates and opens a task while moving focus into the title field', async () => {
    const user = userEvent.setup();
    const onOpenWorkspace = vi.fn().mockResolvedValue(undefined);
    let created = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/handshake') return handshakeResponse();
      if (url === '/api/projects') {
        return jsonResponse({ projects: [{ project, tasks: created ? [task] : [] }] });
      }
      if (url === `/api/projects/${project.id}/tasks` && init?.method === 'POST') {
        created = true;
        return jsonResponse(task, 201);
      }
      throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url}`);
    }));

    render(
      <ProjectChangesPanel
        workspacePath={project.rootPath}
        hasActiveRun={false}
        onOpenWorkspace={onOpenWorkspace}
      />,
    );
    await user.click(await screen.findByRole('button', { name: /New task/i }));
    const title = screen.getByRole('textbox', { name: 'Task title' });
    await waitFor(() => expect(title).toHaveFocus());
    await user.type(title, task.title);
    await user.click(screen.getByRole('button', { name: 'Create & open task' }));
    await waitFor(() => expect(onOpenWorkspace).toHaveBeenCalledWith(task.worktreePath));
  });

  it('reviews and accepts a bounded diff through the product confirmation', async () => {
    const user = userEvent.setup();
    let accepted = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/handshake') return handshakeResponse();
      if (url === '/api/projects') {
        return jsonResponse({ projects: [{ project, tasks: [accepted ? { ...task, status: 'accepted' } : task] }] });
      }
      if (url === `/api/tasks/${task.id}/changes` && !init?.method) {
        return jsonResponse(
          accepted
            ? changes({
                task: { ...task, status: 'accepted', acceptedCommit: 'b'.repeat(40) },
                clean: true,
                changes: [],
                diff: '',
              })
            : changes(),
        );
      }
      if (url === `/api/tasks/${task.id}/accept` && init?.method === 'POST') {
        accepted = true;
        expect(JSON.parse(String(init.body))).toMatchObject({
          expectedVersion: 'sha256:reviewed',
          commitMessage: `CodeWave: ${task.title}`,
        });
        return jsonResponse(
          changes({
            task: { ...task, status: 'accepted', acceptedCommit: 'b'.repeat(40) },
            clean: true,
            changes: [],
            diff: '',
          }),
        );
      }
      throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url}`);
    }));

    render(
      <ProjectChangesPanel
        workspacePath={task.worktreePath}
        hasActiveRun={false}
        onOpenWorkspace={vi.fn()}
      />,
    );
    expect(await screen.findByText('1 changed file')).toBeInTheDocument();
    expect(screen.getByText('src/settings.ts')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept changes' }));
    const commitMessage = screen.getByRole('textbox');
    await waitFor(() => expect(commitMessage).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Create task commit' }));
    expect(await screen.findByText(/Accepted as bbbbbbbb/i)).toBeInTheDocument();
    expect(screen.getByText('Worktree is clean')).toBeInTheDocument();
  });

  it('disables mutations while an agent run is active', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/handshake') return handshakeResponse();
      if (url === '/api/projects') return jsonResponse({ projects: [{ project, tasks: [task] }] });
      if (url === `/api/tasks/${task.id}/changes`) return jsonResponse(changes());
      throw new Error(`Unexpected request ${url}`);
    }));

    render(
      <ProjectChangesPanel
        workspacePath={task.worktreePath}
        hasActiveRun
        onOpenWorkspace={vi.fn()}
      />,
    );
    expect(await screen.findByText(/unlock after the active run finishes/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revert task' })).toBeDisabled();
  });

  it('refuses acceptance when the bounded review is incomplete', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/handshake') return handshakeResponse();
      if (url === '/api/projects') return jsonResponse({ projects: [{ project, tasks: [task] }] });
      if (url === `/api/tasks/${task.id}/changes`) {
        return jsonResponse(changes({ diffTruncated: true }));
      }
      throw new Error(`Unexpected request ${url}`);
    }));

    render(
      <ProjectChangesPanel
        workspacePath={task.worktreePath}
        hasActiveRun={false}
        onOpenWorkspace={vi.fn()}
      />,
    );
    expect(await screen.findByText(/review the remaining files outside CodeWave/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revert task' })).toBeEnabled();
  });

  it('keeps a created task recoverable when opening its workspace fails', async () => {
    const user = userEvent.setup();
    let created = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/handshake') return handshakeResponse();
      if (url === '/api/projects') {
        return jsonResponse({ projects: [{ project, tasks: created ? [task] : [] }] });
      }
      if (url === `/api/projects/${project.id}/tasks` && init?.method === 'POST') {
        created = true;
        return jsonResponse(task, 201);
      }
      throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url}`);
    }));

    render(
      <ProjectChangesPanel
        workspacePath={project.rootPath}
        hasActiveRun={false}
        onOpenWorkspace={vi.fn().mockRejectedValue(new Error('Session setup failed'))}
      />,
    );
    await user.click(await screen.findByRole('button', { name: /New task/i }));
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), task.title);
    await user.click(screen.getByRole('button', { name: 'Create & open task' }));
    expect(
      await screen.findByText(/Task created, but its workspace could not be opened/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
  });
});

describe('ProjectChangesPanel task trace evaluation', () => {
  it('loads and renders the deterministic trace evaluation on demand', async () => {
    const user = userEvent.setup();
    const traceReport = {
      id: 'trace:sha256:' + 'a'.repeat(64),
      schemaVersion: 'codewave-task-trace-report-v1',
      projectionVersion: 'codewave-task-trace-projection-v1',
      rulesetVersion: 'codewave-task-trace-rules-v1',
      subject: {
        kind: 'worktree-task' as const,
        taskRef: 'ref:sha256:' + 'b'.repeat(64),
        taskStatus: 'active' as const,
      },
      sourceDigest: 'sha256:' + 'c'.repeat(64),
      evaluatedThrough: '2026-08-13T00:00:02.000Z',
      contentBoundary: 'metadata-only-v1' as const,
      sourceCut: { taskUpdatedAt: '2026-08-13T00:00:01.000Z', runs: [] },
      projection: {
        sessions: [],
        runs: [],
        routing: [],
        approvals: [],
        tools: [],
        usage: [],
        recovery: [],
        outcome: {
          decision: 'undecided' as const,
          source: 'none' as const,
          reviewVersion: null,
          receiptHash: null,
          acceptedCommitPresent: false,
          decidedAt: null,
        },
      },
      assertions: [
        {
          id: 'CW-TT1' as const,
          status: 'pass' as const,
          reasonCode: 'CW-TT1_PASS',
          evidenceRefs: [],
        },
        {
          id: 'CW-TT6' as const,
          status: 'unknown' as const,
          reasonCode: 'CW-TT6_UNKNOWN',
          evidenceRefs: [],
        },
      ],
      summary: {
        integrity: 'pass' as const,
        completeness: 'partial' as const,
        outcome: 'undecided' as const,
        failedAssertions: [],
        unknownAssertions: ['CW-TT6'],
      },
    };
    let traceRequested = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/handshake') return handshakeResponse();
      if (url === '/api/projects') return jsonResponse({ projects: [{ project, tasks: [task] }] });
      if (url === `/api/tasks/${task.id}/changes` && !init?.method) {
        return jsonResponse(changes());
      }
      if (url === `/api/tasks/${task.id}/trace` && !init?.method) {
        traceRequested = true;
        return jsonResponse(traceReport);
      }
      throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url}`);
    }));

    render(
      <ProjectChangesPanel
        workspacePath={task.worktreePath}
        hasActiveRun={false}
        onOpenWorkspace={vi.fn()}
      />,
    );
    expect(await screen.findByText('1 changed file')).toBeInTheDocument();
    expect(screen.queryByText('UNDECIDED')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Evaluate task trace' }));

    await waitFor(() => expect(traceRequested).toBe(true));
    expect(await screen.findByText('UNDECIDED')).toBeInTheDocument();
    expect(screen.getByText(/integrity/i)).toBeInTheDocument();
    expect(screen.getByText('PASS', { selector: '.task-trace-pill' })).toBeInTheDocument();
    expect(screen.getByText('PARTIAL')).toBeInTheDocument();
    expect(screen.getByText('CW-TT1')).toBeInTheDocument();
    expect(screen.getByText('CW-TT6')).toBeInTheDocument();
    expect(screen.getByText(traceReport.sourceDigest)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide evaluation' }));
    expect(screen.queryByText('UNDECIDED')).not.toBeInTheDocument();
  });

  it('surfaces trace evaluation failures without breaking the review panel', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/handshake') return handshakeResponse();
      if (url === '/api/projects') return jsonResponse({ projects: [{ project, tasks: [task] }] });
      if (url === `/api/tasks/${task.id}/changes` && !init?.method) {
        return jsonResponse(changes());
      }
      if (url === `/api/tasks/${task.id}/trace` && !init?.method) {
        return jsonResponse({ error: 'Task trace projection failed.' }, 500);
      }
      throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url}`);
    }));

    render(
      <ProjectChangesPanel
        workspacePath={task.worktreePath}
        hasActiveRun={false}
        onOpenWorkspace={vi.fn()}
      />,
    );
    expect(await screen.findByText('1 changed file')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Evaluate task trace' }));

    expect(await screen.findByText(/Task trace projection failed/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Evaluate task trace' }),
    ).toBeInTheDocument();
  });
});
