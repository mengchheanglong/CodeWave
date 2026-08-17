import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThreadTabs } from './ThreadTabs';
import * as appController from '../../app-controller';
import type { ShellPanelsState } from '../../lib/shell-panels-state';

describe('ThreadTabs Component Tests', () => {
  const mockSessions: ShellPanelsState['recentSessions'] = [
    {
      id: 'session-1',
      workspacePath: 'C:\\workspace\\project-1',
      providerId: 'gemini',
      createdAt: '2026-08-17T00:00:00.000Z',
      latestRunPrompt: 'Build authentication feature',
      activeRunId: null,
      status: 'idle',
      totalTokens: 120,
    },
    {
      id: 'session-2',
      workspacePath: 'C:\\workspace\\project-2',
      providerId: 'qwen',
      createdAt: '2026-08-17T01:00:00.000Z',
      latestRunPrompt: '',
      orchestration: { role: 'architect' },
      activeRunId: null,
      status: 'running',
      totalTokens: 500,
    },
    {
      id: 'session-3',
      workspacePath: 'C:\\workspace\\project-3',
      providerId: 'opencode',
      createdAt: '2026-08-17T02:00:00.000Z',
      latestRunPrompt: '',
      activeRunId: null,
      status: 'idle',
      totalTokens: 0,
    },
  ];

  it('renders null when there are no sessions', () => {
    const { container } = render(
      <ThreadTabs
        sessions={[]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders tabs with prompts, role fallbacks, and default names', () => {
    render(
      <ThreadTabs
        sessions={mockSessions}
        selectedSessionId="session-1"
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.getByText('Build authentication feature')).toBeInTheDocument();
    expect(screen.getByText('architect thread')).toBeInTheDocument();
    expect(screen.getByText('New thread')).toBeInTheDocument();
  });

  it('marks the active session tab with active class', () => {
    render(
      <ThreadTabs
        sessions={mockSessions}
        selectedSessionId="session-2"
        onSelectSession={vi.fn()}
      />,
    );

    const activeTab = screen.getByRole('button', { name: /architect thread/i });
    expect(activeTab).toHaveClass('active');
  });

  it('calls onSelectSession when clicking on a tab', async () => {
    const user = userEvent.setup();
    const onSelectSession = vi.fn();
    render(
      <ThreadTabs
        sessions={mockSessions}
        selectedSessionId="session-1"
        onSelectSession={onSelectSession}
      />,
    );

    const tab2 = screen.getByRole('button', { name: /architect thread/i });
    await user.click(tab2);

    expect(onSelectSession).toHaveBeenCalledWith('session-2');
  });

  it('triggers requestCreateSession when clicking new thread button', async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(appController, 'requestCreateSession').mockImplementation(vi.fn());

    render(
      <ThreadTabs
        sessions={mockSessions}
        selectedSessionId="session-1"
        onSelectSession={vi.fn()}
      />,
    );

    const newButton = screen.getByTitle('New thread');
    await user.click(newButton);

    expect(createSpy).toHaveBeenCalledTimes(1);
    createSpy.mockRestore();
  });

  it('bounds tabs to maximum of 8 items', () => {
    const nineSessions = Array.from({ length: 9 }, (_, index) => ({
      id: `session-${index}`,
      workspacePath: `/workspace/${index}`,
      providerId: 'gemini' as const,
      createdAt: '2026-08-17T00:00:00.000Z',
      latestRunPrompt: `Prompt ${index}`,
      activeRunId: null,
      status: 'idle' as const,
      totalTokens: 0,
    }));

    render(
      <ThreadTabs
        sessions={nineSessions}
        selectedSessionId="session-0"
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.getByText('Prompt 0')).toBeInTheDocument();
    expect(screen.getByText('Prompt 7')).toBeInTheDocument();
    expect(screen.queryByText('Prompt 8')).not.toBeInTheDocument();
  });
});
