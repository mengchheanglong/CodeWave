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

describe('RunTranscriptPanel compaction surfaces', () => {
  const baseEvents = [
    {
      id: 'event-started',
      sequence: 1,
      type: 'run.started' as const,
      timestamp: CREATED_AT,
      payload: {},
    },
  ];

  function renderPanel(
    overrides: Partial<Parameters<typeof RunTranscriptPanel>[0]> = {},
  ) {
    const props = {
      selectedRun: {
        id: 'run-current',
        status: 'completed' as const,
        mode: 'execute' as const,
        prompt: 'current prompt',
        createdAt: CREATED_AT,
        completedAt: CREATED_AT,
      },
      events: baseEvents,
      transcript: {
        sessionId: 'session-1',
        messages: [message(1, 'run-current')],
        hasMoreBefore: false,
        oldestSequence: 1,
        newestSequence: 1,
        totalCount: 1,
      },
      approvals: [],
      onResolveApproval: vi.fn(),
      onExecutePlan: vi.fn(),
      showThinking: false,
      formatTimestamp: () => '03:00',
      ...overrides,
    };
    render(<RunTranscriptPanel {...props} />);
    return props;
  }

  it('renders the derived compaction checkpoint with summary, memories, and authority label', () => {
    renderPanel({
      transcript: {
        sessionId: 'session-1',
        messages: [message(1, 'run-current')],
        hasMoreBefore: false,
        oldestSequence: 1,
        newestSequence: 1,
        totalCount: 1,
        latestCompactionCheckpoint: {
          id: 'checkpoint-1',
          sessionId: 'session-1',
          previousCheckpointId: null,
          fromSequence: 1,
          throughSequence: 1,
          throughMessageId: 'message-1',
          throughRunId: 'run-earlier',
          sourceMessageCount: 1,
          segmentDigest: 'sha256:abc',
          coverageDigest: 'sha256:def',
          summaryText: '[1 · user] compacted context summary',
          memories: [
            {
              id: 'memory-1',
              text: 'The user prefers concise answers.',
              sourceMessageIds: ['message-1'],
              authority: 'derived-non-authoritative' as const,
            },
          ],
          generator: { id: 'codewave.local-compactor', version: '1', kind: 'local-deterministic' as const },
          policyRevision: 'codewave-transcript-compaction-policy-v1',
          authority: 'derived-non-authoritative' as const,
          createdAt: CREATED_AT,
        },
      },
    });

    expect(screen.getByText('Compacted Checkpoint')).toBeInTheDocument();
    expect(screen.getByText(/compacted context summary/)).toBeInTheDocument();
    expect(screen.getByText('derived-non-authoritative')).toBeInTheDocument();
    expect(screen.getByText(/The user prefers concise answers\./)).toBeInTheDocument();
  });

  it('offers compact history for terminal runs and reports the request', () => {
    const onCompactTranscript = vi.fn();
    renderPanel({ onCompactTranscript });

    fireEvent.click(screen.getByRole('button', { name: 'Compact history' }));
    expect(onCompactTranscript).toHaveBeenCalledTimes(1);
  });

  it('hides compact history while the run is still active', () => {
    renderPanel({
      selectedRun: {
        id: 'run-current',
        status: 'running' as const,
        mode: 'execute' as const,
        prompt: 'current prompt',
        createdAt: CREATED_AT,
        completedAt: null,
      },
    });

    expect(
      screen.queryByRole('button', { name: 'Compact history' }),
    ).not.toBeInTheDocument();
  });
});
