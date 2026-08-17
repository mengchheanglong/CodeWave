import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestrationSwimlanes } from './OrchestrationSwimlanes';
import type { ShellPanelsState } from '../lib/shell-panels-state';

describe('OrchestrationSwimlanes Component Tests', () => {
  const mockFlows: ShellPanelsState['orchestrationFlows'] = [
    {
      rootSession: {
        id: 'sess-root',
        workspacePath: 'C:\\workspace\\project-orchestration',
        providerId: 'gemini',
        approvalPolicy: 'prompt',
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T01:00:00.000Z',
        orchestration: { role: 'main', kind: 'route' },
      },
      latestActivityAt: '2026-08-17T01:00:00.000Z',
      sessions: [
        {
          session: {
            id: 'sess-root',
            workspacePath: 'C:\\workspace\\project-orchestration',
            providerId: 'gemini',
            approvalPolicy: 'prompt',
            createdAt: '2026-08-17T00:00:00.000Z',
            updatedAt: '2026-08-17T01:00:00.000Z',
            orchestration: { role: 'main', kind: 'route' },
          },
          depth: 0,
          runCount: 2,
          latestRun: {
            id: 'run-1',
            status: 'completed',
            prompt: 'Orchestrating feature',
          },
        },
        {
          session: {
            id: 'sess-sub',
            workspacePath: 'C:\\workspace\\project-orchestration',
            providerId: 'qwen',
            approvalPolicy: 'auto',
            createdAt: '2026-08-17T00:30:00.000Z',
            updatedAt: '2026-08-17T01:00:00.000Z',
            orchestration: { role: 'planner', kind: 'delegate' },
          },
          depth: 1,
          runCount: 1,
          latestRun: {
            id: 'run-2',
            status: 'running',
            prompt: 'Draft technical plan',
          },
        },
      ],
    },
  ];

  it('renders empty message when no flows exist or single unrouted session', () => {
    render(
      <OrchestrationSwimlanes
        orchestrationFlows={[]}
        selectedSessionId={null}
        formatTimestamp={(t) => t}
        formatRunStatus={(s) => s}
        onSelectSession={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Routed and child sessions will gather here as orchestration lanes/i),
    ).toBeInTheDocument();
  });

  it('renders swimlane board, flow header, and connected nodes', () => {
    render(
      <OrchestrationSwimlanes
        orchestrationFlows={mockFlows}
        selectedSessionId="sess-sub"
        formatTimestamp={() => 'Just now'}
        formatRunStatus={(s) => s.toUpperCase()}
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.getByText('project-orchestration')).toBeInTheDocument();
    expect(screen.getByText('2 sessions')).toBeInTheDocument();
    expect(screen.getByText('planner')).toBeInTheDocument();
    expect(screen.getByText('delegate')).toBeInTheDocument();
    expect(screen.getByText('Draft technical plan')).toBeInTheDocument();
    expect(screen.getByText('RUNNING')).toBeInTheDocument();
  });

  it('triggers onSelectSession when clicking on a swimlane node', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <OrchestrationSwimlanes
        orchestrationFlows={mockFlows}
        selectedSessionId="sess-root"
        formatTimestamp={() => 'Just now'}
        formatRunStatus={(s) => s}
        onSelectSession={onSelect}
      />,
    );

    const subNode = screen.getByRole('button', { name: /draft technical plan/i });
    await user.click(subNode);

    expect(onSelect).toHaveBeenCalledWith('sess-sub');
  });
});
