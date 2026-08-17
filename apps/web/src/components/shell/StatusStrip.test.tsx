import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatusStrip } from './StatusStrip';
import type { ShellControlsState } from '../../lib/shell-controls-state';
import type { ShellPanelsState } from '../../lib/shell-panels-state';
import type { ShellSummaryState } from '../../lib/shell-summary-state';

describe('StatusStrip Component Tests', () => {
  const defaultControlsState: ShellControlsState = {
    providerId: 'gemini',
    sessionApprovalPolicy: 'prompt',
    selectedSessionApprovalPolicy: 'prompt',
    steerPrompt: '',
    startRunDisabled: false,
    cancelRunDisabled: true,
  };

  const defaultPanelsState: ShellPanelsState = {
    selectedSessionId: 'session-1',
    selectedProviderId: 'gemini',
    recentSessions: [],
    archivedSessions: [],
    daemonProtocol: {
      version: 1,
      capabilities: ['streaming', 'worktrees', 'mcp'],
      availableScopes: ['read', 'write'],
    },
    tools: [],
    artifacts: [],
    checkpoints: [],
  };

  const defaultSummaryState: ShellSummaryState = {
    daemonConnectionLabel: 'connected',
    runStatusLabel: 'Active Run',
    runStatusClassName: 'status-running',
    activeRunId: 'run-1',
  };

  it('renders workspace label and brand name', () => {
    render(
      <StatusStrip
        shellControlsState={defaultControlsState}
        shellPanelsState={defaultPanelsState}
        shellSummaryState={defaultSummaryState}
        workspaceLabel="CodeWave"
        workspaceTitle="C:\\workspace\\CodeWave"
        contextUsagePercent={35}
        attentionBellOn={true}
        onToggleBell={vi.fn()}
        compactNavigationOpen={false}
        onToggleCompactNavigation={vi.fn()}
      />,
    );

    expect(screen.getByText('CodeWave')).toBeInTheDocument();
    expect(screen.getByTitle(/CodeWave/i)).toBeInTheDocument();
    expect(screen.getByText('35%')).toBeInTheDocument();
    expect(screen.getByText('Active Run')).toBeInTheDocument();
  });

  it('toggles notification bell when bell button is clicked', async () => {
    const user = userEvent.setup();
    const onToggleBell = vi.fn();

    const { rerender } = render(
      <StatusStrip
        shellControlsState={defaultControlsState}
        shellPanelsState={defaultPanelsState}
        shellSummaryState={defaultSummaryState}
        workspaceLabel="CodeWave"
        workspaceTitle="CodeWave"
        contextUsagePercent={0}
        attentionBellOn={true}
        onToggleBell={onToggleBell}
        compactNavigationOpen={false}
        onToggleCompactNavigation={vi.fn()}
      />,
    );

    const bellBtn = screen.getByRole('button', { name: /desktop notifications on/i });
    expect(bellBtn).toHaveAttribute('aria-pressed', 'true');
    await user.click(bellBtn);
    expect(onToggleBell).toHaveBeenCalledTimes(1);

    rerender(
      <StatusStrip
        shellControlsState={defaultControlsState}
        shellPanelsState={defaultPanelsState}
        shellSummaryState={defaultSummaryState}
        workspaceLabel="CodeWave"
        workspaceTitle="CodeWave"
        contextUsagePercent={0}
        attentionBellOn={false}
        onToggleBell={onToggleBell}
        compactNavigationOpen={false}
        onToggleCompactNavigation={vi.fn()}
      />,
    );

    const mutedBellBtn = screen.getByRole('button', { name: /desktop notifications off/i });
    expect(mutedBellBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onToggleCompactNavigation when navigation button is clicked', async () => {
    const user = userEvent.setup();
    const onToggleNav = vi.fn();

    render(
      <StatusStrip
        shellControlsState={defaultControlsState}
        shellPanelsState={defaultPanelsState}
        shellSummaryState={defaultSummaryState}
        workspaceLabel="CodeWave"
        workspaceTitle="CodeWave"
        contextUsagePercent={0}
        attentionBellOn={true}
        onToggleBell={vi.fn()}
        compactNavigationOpen={false}
        onToggleCompactNavigation={onToggleNav}
      />,
    );

    const navBtn = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(navBtn);
    expect(onToggleNav).toHaveBeenCalledTimes(1);
  });

  it('renders disconnected daemon state properly', () => {
    const disconnectedSummary: ShellSummaryState = {
      daemonConnectionLabel: 'disconnected',
      runStatusLabel: 'Idle',
      runStatusClassName: 'status-idle',
      activeRunId: null,
    };

    render(
      <StatusStrip
        shellControlsState={defaultControlsState}
        shellPanelsState={{ ...defaultPanelsState, selectedSessionId: null }}
        shellSummaryState={disconnectedSummary}
        workspaceLabel="CodeWave"
        workspaceTitle="CodeWave"
        contextUsagePercent={0}
        attentionBellOn={true}
        onToggleBell={vi.fn()}
        compactNavigationOpen={false}
        onToggleCompactNavigation={vi.fn()}
      />,
    );

    expect(screen.getByText('disconnected')).toBeInTheDocument();
    expect(screen.queryByText('Active Run')).not.toBeInTheDocument();
  });
});
