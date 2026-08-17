import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConversationHeader } from './ConversationHeader';

describe('ConversationHeader Component Tests', () => {
  it('renders empty workspace view when there is no active session', () => {
    render(
      <ConversationHeader
        workspaceLabel="CodeWave"
        title="Workspace"
        hasActiveSession={false}
        runCount={0}
        runPhaseClassName="status-idle"
        runStatusLabel="Idle"
        selectedSessionNote=""
        toolPlaneNote="governed"
        onOpenQuickOpen={vi.fn()}
        utilityCollapsed={true}
        onToggleUtility={vi.fn()}
      />,
    );

    expect(screen.getByText('CodeWave')).toBeInTheDocument();
    expect(screen.getByText('Open a folder and send a message to begin.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete thread/i })).not.toBeInTheDocument();
  });

  it('renders active session details, run badge, and meta notes', () => {
    render(
      <ConversationHeader
        workspaceLabel="CodeWave"
        title="Implement Auth"
        hasActiveSession={true}
        runCount={3}
        runPhaseClassName="status-running"
        runStatusLabel="Running"
        selectedSessionNote="Last active 2m ago"
        toolPlaneNote="3 tools enabled"
        onOpenQuickOpen={vi.fn()}
        utilityCollapsed={false}
        onToggleUtility={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    );

    expect(screen.getByText('Implement Auth')).toBeInTheDocument();
    expect(screen.getByText('+3 runs')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Last active 2m ago')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete thread/i })).toBeInTheDocument();
  });

  it('triggers onOpenQuickOpen when search button is clicked', async () => {
    const user = userEvent.setup();
    const onQuickOpen = vi.fn();

    render(
      <ConversationHeader
        workspaceLabel="CodeWave"
        title="Test"
        hasActiveSession={false}
        runCount={0}
        runPhaseClassName="status-idle"
        runStatusLabel="Idle"
        selectedSessionNote=""
        toolPlaneNote=""
        onOpenQuickOpen={onQuickOpen}
        utilityCollapsed={true}
        onToggleUtility={vi.fn()}
      />,
    );

    const searchBtn = screen.getByRole('button', { name: 'Quick open' });
    await user.click(searchBtn);
    expect(onQuickOpen).toHaveBeenCalledTimes(1);
  });

  it('triggers onToggleUtility when right rail toggle is clicked', async () => {
    const user = userEvent.setup();
    const onToggleUtility = vi.fn();

    const { rerender } = render(
      <ConversationHeader
        workspaceLabel="CodeWave"
        title="Test"
        hasActiveSession={true}
        runCount={1}
        runPhaseClassName="status-idle"
        runStatusLabel="Idle"
        selectedSessionNote=""
        toolPlaneNote=""
        onOpenQuickOpen={vi.fn()}
        utilityCollapsed={true}
        onToggleUtility={onToggleUtility}
      />,
    );

    const railBtn = screen.getByRole('button', { name: 'Open right rail' });
    expect(railBtn).toHaveAttribute('aria-pressed', 'false');
    await user.click(railBtn);
    expect(onToggleUtility).toHaveBeenCalledTimes(1);

    rerender(
      <ConversationHeader
        workspaceLabel="CodeWave"
        title="Test"
        hasActiveSession={true}
        runCount={1}
        runPhaseClassName="status-idle"
        runStatusLabel="Idle"
        selectedSessionNote=""
        toolPlaneNote=""
        onOpenQuickOpen={vi.fn()}
        utilityCollapsed={false}
        onToggleUtility={onToggleUtility}
      />,
    );

    const openRailBtn = screen.getByRole('button', { name: 'Hide right rail' });
    expect(openRailBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('triggers onDeleteSession when delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(
      <ConversationHeader
        workspaceLabel="CodeWave"
        title="Test"
        hasActiveSession={true}
        runCount={1}
        runPhaseClassName="status-idle"
        runStatusLabel="Idle"
        selectedSessionNote=""
        toolPlaneNote=""
        onOpenQuickOpen={vi.fn()}
        utilityCollapsed={true}
        onToggleUtility={vi.fn()}
        onDeleteSession={onDelete}
      />,
    );

    const deleteBtn = screen.getByRole('button', { name: 'Delete thread' });
    await user.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
