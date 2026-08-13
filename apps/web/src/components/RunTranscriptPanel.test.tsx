import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TranscriptMessage } from '@codewave/protocol';
import { RunTranscriptPanel } from './RunTranscriptPanel';

const CREATED_AT = '2026-08-13T03:00:00.000Z';

function message(sequence: number, runId: string): TranscriptMessage {
  return {
    id: `message-${sequence}`,
    sessionId: 'session-1',
    runId,
    sequence,
    parentMessageId: sequence === 1 ? null : `message-${sequence - 1}`,
    role: sequence % 2 === 0 ? 'assistant' : 'user',
    content: `prior message ${sequence}`,
    createdAt: CREATED_AT,
    sourceEventId: sequence % 2 === 0 ? `event-${sequence}` : null,
    metadata: {},
  };
}

describe('RunTranscriptPanel session memory', () => {
  it('shows a bounded recent window and expands loaded parent-linked history', () => {
    const prior = Array.from({ length: 8 }, (_, index) =>
      message(index + 5, `run-${index + 1}`),
    );
    const current = {
      ...message(13, 'run-current'),
      content: 'current prompt',
      role: 'user' as const,
    };

    render(
      <RunTranscriptPanel
        selectedRun={{
          id: 'run-current',
          status: 'running',
          mode: 'execute',
          prompt: 'current prompt',
          createdAt: CREATED_AT,
          completedAt: null,
        }}
        events={[
          {
            id: 'event-started',
            sequence: 1,
            type: 'run.started',
            timestamp: CREATED_AT,
            payload: {},
          },
        ]}
        transcript={{
          sessionId: 'session-1',
          messages: [...prior, current],
          hasMoreBefore: true,
          oldestSequence: 5,
          newestSequence: 13,
          totalCount: 20,
        }}
        approvals={[]}
        onResolveApproval={vi.fn()}
        onExecutePlan={vi.fn()}
        showThinking={false}
        formatTimestamp={() => '03:00'}
      />,
    );

    expect(screen.getByText('Session memory')).toBeInTheDocument();
    expect(screen.getByText(/8 prior messages · parent-linked · 4 earlier on disk/)).toBeInTheDocument();
    expect(screen.queryByText('prior message 5')).not.toBeInTheDocument();
    expect(screen.queryByText('prior message 12')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View context' }));

    expect(screen.getByText('prior message 5')).toBeInTheDocument();
    expect(screen.getByText('prior message 12')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Hide context' }),
    ).toBeInTheDocument();
  });
});
