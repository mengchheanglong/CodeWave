import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CheckpointListPanel } from './CheckpointListPanel';
import type { ShellPanelsState } from '../lib/shell-panels-state';

describe('CheckpointListPanel Component Tests', () => {
  const mockCheckpoints: ShellPanelsState['checkpoints'] = [
    {
      id: 'cp-1',
      runId: 'run-1',
      title: 'Initial Commit Checkpoint',
      createdAt: '2026-08-17T00:00:00.000Z',
      metadata: { step: 1, hash: 'abc1234' },
      providerSessionId: 'provider-sess-456',
    },
    {
      id: 'cp-2',
      runId: 'run-1',
      title: 'Local Checkpoint',
      createdAt: '2026-08-17T01:00:00.000Z',
      metadata: { step: 2 },
    },
  ];

  it('renders empty state when no checkpoints exist', () => {
    render(
      <CheckpointListPanel
        checkpoints={[]}
        capabilities={null}
        formatTimestamp={(t) => t}
        onRecoverCheckpoint={vi.fn()}
      />,
    );

    expect(screen.getByText('No checkpoints recorded')).toBeInTheDocument();
    expect(screen.getByText('Checkpoint events will be stored here.')).toBeInTheDocument();
  });

  it('renders provider capability guidance message when checkpoints are unsupported', () => {
    render(
      <CheckpointListPanel
        checkpoints={[]}
        capabilities={{
          streaming: true,
          checkpointEvents: false,
          nativeSteering: false,
          toolCallResponses: true,
          sessionResumption: false,
        }}
        formatTimestamp={(t) => t}
        onRecoverCheckpoint={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/This provider does not emit checkpoint events yet/i),
    ).toBeInTheDocument();
  });

  it('renders checkpoint cards and recovers session when button clicked', async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn();

    render(
      <CheckpointListPanel
        checkpoints={mockCheckpoints}
        capabilities={null}
        formatTimestamp={() => '10m ago'}
        onRecoverCheckpoint={onRecover}
      />,
    );

    expect(screen.getByText('Initial Commit Checkpoint')).toBeInTheDocument();
    expect(screen.getByText('Local Checkpoint')).toBeInTheDocument();
    expect(screen.getByText(/provider session provider-sess-456/i)).toBeInTheDocument();

    const recoverBtn = screen.getByRole('button', { name: 'Recover Session' });
    await user.click(recoverBtn);

    expect(onRecover).toHaveBeenCalledWith('cp-1');
  });
});
