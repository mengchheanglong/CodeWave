import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ArchiveSessionList } from './ArchiveSessionList';
import type { ShellPanelsState } from '../lib/shell-panels-state';

describe('ArchiveSessionList Component Tests', () => {
  const mockArchiveSessions: ShellPanelsState['archiveSessions'] = [
    {
      session: {
        id: 'archived-1',
        workspacePath: 'C:\\Users\\User\\projects\\project-alpha',
        providerId: 'gemini',
        approvalPolicy: 'prompt',
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T01:00:00.000Z',
      },
      runCount: 5,
      latestRun: {
        id: 'run-1',
        status: 'completed',
        prompt: 'Generate documentation',
      },
    },
    {
      session: {
        id: 'archived-2',
        workspacePath: '/home/user/beta',
        providerId: 'qwen',
        approvalPolicy: 'auto',
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T02:00:00.000Z',
        orchestration: { role: 'researcher' },
      },
      runCount: 2,
      latestRun: null,
    },
  ];

  it('renders empty state when archive is empty', () => {
    render(
      <ArchiveSessionList
        archiveSessions={[]}
        selectedSessionId={null}
        formatRunStatus={(s) => s}
        formatSessionOrchestration={() => null}
        formatSessionRecovery={() => null}
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.getByText('Archive is empty')).toBeInTheDocument();
    expect(screen.getByText('Session summaries will appear here.')).toBeInTheDocument();
  });

  it('renders archived session items with workspace names and badges', () => {
    render(
      <ArchiveSessionList
        archiveSessions={mockArchiveSessions}
        selectedSessionId="archived-1"
        formatRunStatus={(s) => s.toUpperCase()}
        formatSessionOrchestration={(s) => s.orchestration?.role ?? null}
        formatSessionRecovery={() => null}
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.getByText('project-alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('5 runs · prompt')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED - Generate documentation')).toBeInTheDocument();
    expect(screen.getByText('researcher')).toBeInTheDocument();
  });

  it('triggers onSelectSession when clicking on an archived session', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <ArchiveSessionList
        archiveSessions={mockArchiveSessions}
        selectedSessionId={null}
        formatRunStatus={(s) => s}
        formatSessionOrchestration={() => null}
        formatSessionRecovery={() => null}
        onSelectSession={onSelect}
      />,
    );

    const firstItem = screen.getByRole('button', { name: /project-alpha/i });
    await user.click(firstItem);

    expect(onSelect).toHaveBeenCalledWith('archived-1');
  });
});
