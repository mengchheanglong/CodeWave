import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RunHistoryList } from './RunHistoryList';
import type { RunViewState } from '../lib/run-view-state';

describe('RunHistoryList Component Tests', () => {
  const mockRuns: RunViewState['runs'] = [
    {
      id: 'run-1',
      sessionId: 'session-1',
      prompt: 'Implement auth tokens',
      status: 'completed',
      createdAt: '2026-08-17T00:00:00.000Z',
    },
    {
      id: 'run-2',
      sessionId: 'session-1',
      prompt: 'Add error handling',
      status: 'running',
      createdAt: '2026-08-17T01:00:00.000Z',
    },
  ];

  it('renders empty state when no session is selected', () => {
    render(
      <RunHistoryList
        selectedSessionId={null}
        runs={[]}
        selectedRunId={null}
        formatRunStatus={(s) => s}
        formatTimestamp={(t) => t}
        onSelectRun={vi.fn()}
      />,
    );

    expect(screen.getByText('No session selected')).toBeInTheDocument();
  });

  it('renders empty state when session has no runs', () => {
    render(
      <RunHistoryList
        selectedSessionId="session-1"
        runs={[]}
        selectedRunId={null}
        emptyMessage="Custom empty message"
        formatRunStatus={(s) => s}
        formatTimestamp={(t) => t}
        onSelectRun={vi.fn()}
      />,
    );

    expect(screen.getByText('No runs yet')).toBeInTheDocument();
    expect(screen.getByText('Custom empty message')).toBeInTheDocument();
  });

  it('renders run history items and highlights active run', () => {
    render(
      <RunHistoryList
        selectedSessionId="session-1"
        runs={mockRuns}
        selectedRunId="run-2"
        formatRunStatus={(s) => s.toUpperCase()}
        formatTimestamp={() => '2m ago'}
        onSelectRun={vi.fn()}
      />,
    );

    expect(screen.getByText('Implement auth tokens')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('Add error handling')).toBeInTheDocument();
    expect(screen.getByText('RUNNING')).toBeInTheDocument();

    const run2Button = screen.getByRole('button', { name: /add error handling/i });
    expect(run2Button).toHaveClass('active');
  });

  it('triggers onSelectRun when clicking on a run item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <RunHistoryList
        selectedSessionId="session-1"
        runs={mockRuns}
        selectedRunId="run-1"
        formatRunStatus={(s) => s}
        formatTimestamp={(t) => t}
        onSelectRun={onSelect}
      />,
    );

    const run2Button = screen.getByRole('button', { name: /add error handling/i });
    await user.click(run2Button);

    expect(onSelect).toHaveBeenCalledWith('run-2');
  });
});
