import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunViewState } from '../lib/run-view-state';
import type { ShellPanelsState } from '../lib/shell-panels-state';
import {
  buildTimelineSteps,
  type TimelineStep,
} from '../lib/run-inspector-views';
import { EmptyState } from './EmptyState';
import { InlineApprovalCards } from './InlineApprovalCards';
import { StepTimeline, toolStepKey } from './StepTimeline';
import { CheckIcon, ListIcon } from './icons';

type RunTranscriptPanelProps = {
  selectedRun: RunViewState['selectedRun'];
  events: RunViewState['events'];
  transcript: RunViewState['transcript'];
  approvals: ShellPanelsState['approvals'];
  onResolveApproval: (
    approvalId: string,
    decision: 'approved' | 'denied',
  ) => void;
  onExecutePlan: (planText: string) => void;
  showThinking: boolean;
  formatTimestamp: (timestamp: string) => string;
  expandAllSignal?: number;
};

export function RunTranscriptPanel({
  selectedRun,
  events,
  transcript,
  approvals,
  onResolveApproval,
  onExecutePlan,
  showThinking,
  formatTimestamp,
  expandAllSignal = 0,
}: RunTranscriptPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const steps = useMemo(
    () => buildTimelineSteps(selectedRun, events),
    [selectedRun, events],
  );
  const [expandedToolIds, setExpandedToolIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [allExpanded, setAllExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const priorMessages = useMemo(
    () => {
      const messages = transcript?.messages ?? [];
      const currentRunSequence = messages.find(
        (message) => message.runId === selectedRun?.id,
      )?.sequence;
      if (currentRunSequence === undefined) {
        return [];
      }
      return messages.filter(
        (message) => message.sequence < currentRunSequence,
      );
    },
    [selectedRun?.id, transcript],
  );
  const visiblePriorMessages = historyExpanded ? priorMessages : [];
  const priorSteps = useMemo<TimelineStep[]>(
    () =>
      visiblePriorMessages.map((message) => ({
        kind:
          message.role === 'user'
            ? 'user'
            : message.role === 'assistant'
              ? 'assistant'
              : 'system',
        text: message.content,
        timestamp: message.createdAt,
      })),
    [visiblePriorMessages],
  );

  const toolSteps = useMemo(
    () => steps.filter((step) => step.kind === 'tool'),
    [steps],
  );

  const planText = useMemo(() => {
    if (selectedRun?.mode !== 'plan') {
      return '';
    }
    const isTerminal =
      selectedRun.status === 'completed' ||
      selectedRun.status === 'failed' ||
      selectedRun.status === 'cancelled';
    if (!isTerminal) {
      return '';
    }
    const messages = steps.filter((step) => step.kind === 'assistant');
    const last = messages.at(-1);
    return last?.kind === 'assistant' ? last.text : '';
  }, [selectedRun, steps]);

  useEffect(() => {
    if (!containerRef.current || !selectedRun || steps.length === 0) {
      return;
    }

    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [selectedRun, steps]);

  useEffect(() => {
    setHistoryExpanded(false);
  }, [selectedRun?.id]);

  function toggleTool(key: string) {
    setExpandedToolIds((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function expandAllTools() {
    const keys = toolSteps.map((step, index) => toolStepKey(step, index));
    setExpandedToolIds(new Set(keys));
    setAllExpanded(true);
  }

  function collapseAllTools() {
    setExpandedToolIds(new Set());
    setAllExpanded(false);
  }

  useEffect(() => {
    if (expandAllSignal === 0) {
      return;
    }
    if (expandAllSignal % 2 === 1) {
      expandAllTools();
    } else {
      collapseAllTools();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandAllSignal]);

  if (!selectedRun) {
    return (
      <div className="transcript-empty-shell">
        <EmptyState
          icon="↗"
          title="Ready for a new run"
          message="Describe the change in the composer below. CodeWave will capture the response, tool activity, and artifacts here."
        />
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="transcript-empty-shell">
        <EmptyState
          icon="·"
          title="Run is starting"
          message="The first agent response will appear here as soon as it arrives."
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="transcript-stream terminal-stream">
      {priorMessages.length > 0 ? (
        <section
          className={`session-memory${historyExpanded ? ' expanded' : ' collapsed'}`}
          aria-label="Recent session memory"
        >
          <header className="session-memory-header">
            <div>
              <span className="session-memory-eyebrow">Session memory</span>
              <span className="session-memory-detail">
                {priorMessages.length} prior message
                {priorMessages.length === 1 ? '' : 's'} · parent-linked
                {transcript?.hasMoreBefore
                  ? ` · ${Math.max(0, (transcript.oldestSequence ?? 1) - 1)} earlier on disk`
                  : ''}
              </span>
            </div>
            <button
              type="button"
              className="transcript-toolbar-button session-memory-toggle"
              aria-expanded={historyExpanded}
              onClick={() => setHistoryExpanded((current) => !current)}
            >
              {historyExpanded ? 'Hide context' : 'View context'}
            </button>
          </header>
          {historyExpanded ? (
            <>
              <div className="session-memory-feed">
                <StepTimeline
                  steps={priorSteps}
                  showThinking={false}
                  expandedToolIds={new Set()}
                  onToggleTool={() => {}}
                  formatTimestamp={formatTimestamp}
                />
              </div>
              <div className="session-memory-current">
                <span>Current run</span>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {toolSteps.length > 0 ? (
        <div className="transcript-toolbar">
          <span className="transcript-toolbar-label">
            {toolSteps.length} tool step{toolSteps.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            className="transcript-toolbar-button"
            onClick={allExpanded ? collapseAllTools : expandAllTools}
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      ) : null}

      <StepTimeline
        steps={steps}
        showThinking={showThinking}
        expandedToolIds={expandedToolIds}
        onToggleTool={toggleTool}
        formatTimestamp={formatTimestamp}
      />

      {planText ? (
        <div className="plan-card">
          <header className="plan-card-header">
            <span className="plan-card-title" aria-hidden="true">
              <ListIcon size={15} />
            </span>
            <span className="plan-card-title">Plan ready</span>
            <span className="plan-card-tag">read-only run</span>
          </header>
          <pre className="plan-card-body">{planText}</pre>
          <footer className="plan-card-footer">
            <span className="plan-card-note">
              Approve to execute this plan with full access.
            </span>
            <button
              type="button"
              className="plan-card-execute"
              onClick={() => {
                onExecutePlan(planText);
              }}
            >
              <CheckIcon size={13} />
              Approve &amp; execute
            </button>
          </footer>
        </div>
      ) : null}

      <InlineApprovalCards
        approvals={approvals}
        onResolveApproval={onResolveApproval}
      />
    </div>
  );
}

export type { TimelineStep };
