import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InlineApprovalCards } from './InlineApprovalCards';
import type { ShellPanelsState } from '../lib/shell-panels-state';

describe('InlineApprovalCards Component Tests', () => {
  const mockApprovals: ShellPanelsState['approvals'] = [
    {
      id: 'approval-1',
      runId: 'run-1',
      toolName: 'write_file',
      reason: 'Modify src/index.ts',
      status: 'requested',
      createdAt: '2026-08-17T00:00:00.000Z',
      payload: { input: { path: 'src/index.ts', content: 'hello' } },
    },
    {
      id: 'approval-2',
      runId: 'run-1',
      toolName: 'execute_command',
      reason: 'Run npm install',
      status: 'approved',
      createdAt: '2026-08-17T00:01:00.000Z',
      payload: { input: { command: 'npm install' } },
    },
  ];

  it('renders null when approvals list is empty', () => {
    const { container } = render(
      <InlineApprovalCards approvals={[]} onResolveApproval={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders approval cards with tool names, reasons, and hints', () => {
    render(
      <InlineApprovalCards
        approvals={mockApprovals}
        onResolveApproval={vi.fn()}
      />,
    );

    expect(screen.getByText(/write_file/i)).toBeInTheDocument();
    expect(screen.getByText(/Modify src\/index\.ts/i)).toBeInTheDocument();
    expect(screen.getByText(/execute_command/i)).toBeInTheDocument();
    expect(screen.getByText(/Run npm install/i)).toBeInTheDocument();
  });

  it('calls onResolveApproval with approved when Approve button is clicked', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();

    render(
      <InlineApprovalCards
        approvals={mockApprovals}
        onResolveApproval={onResolve}
      />,
    );

    const approveButtons = screen.getAllByRole('button', { name: /approve/i });
    await user.click(approveButtons[0]!);

    expect(onResolve).toHaveBeenCalledWith('approval-1', 'approved');
  });

  it('calls onResolveApproval with denied when Deny button is clicked', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();

    render(
      <InlineApprovalCards
        approvals={mockApprovals}
        onResolveApproval={onResolve}
      />,
    );

    const denyButtons = screen.getAllByRole('button', { name: /deny/i });
    await user.click(denyButtons[0]!);

    expect(onResolve).toHaveBeenCalledWith('approval-1', 'denied');
  });
});
