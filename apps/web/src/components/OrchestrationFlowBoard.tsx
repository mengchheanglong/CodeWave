import type { CSSProperties } from 'react';
import type { RunStatus } from '@codewave/protocol';
import type { ShellPanelsState } from '../lib/shell-panels-state';

type OrchestrationFlowBoardProps = {
  orchestrationFlows: ShellPanelsState['orchestrationFlows'];
  selectedSessionId: string | null;
  emptyMessage?: string;
  formatTimestamp: (timestamp: string) => string;
  formatRunStatus: (status: RunStatus) => string;
  onSelectSession: (sessionId: string) => void;
};

function EmptyState({ message }: { message: string }) {
  return <div className="empty">{message}</div>;
}

function getWorkspaceLabel(workspacePath: string) {
  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? workspacePath;
}

function formatFlowSessionLabel(
  summary: ShellPanelsState['orchestrationFlows'][number]['sessions'][number],
) {
  if (!summary.session.orchestration) {
    return 'main session';
  }

  return `${summary.session.orchestration.role} via ${summary.session.orchestration.kind}`;
}

function formatFlowLatestRun(
  summary: ShellPanelsState['orchestrationFlows'][number]['sessions'][number],
  formatRunStatus: (status: RunStatus) => string,
) {
  if (!summary.latestRun) {
    return 'No runs yet';
  }

  return `${formatRunStatus(summary.latestRun.status)} - ${summary.latestRun.prompt}`;
}

export function OrchestrationFlowBoard({
  orchestrationFlows,
  selectedSessionId,
  emptyMessage,
  formatTimestamp,
  formatRunStatus,
  onSelectSession,
}: OrchestrationFlowBoardProps) {
  const flows = orchestrationFlows.filter(
    (flow) =>
      flow.sessions.length > 1 || flow.rootSession.orchestration?.kind === 'route',
  );

  if (flows.length === 0) {
    return (
      <EmptyState
        message={
          emptyMessage ??
          'Routed and child sessions will gather here as orchestration flows.'
        }
      />
    );
  }

  return (
    <>
      {flows.map((flow) => (
        <article className="flow-card" key={`${flow.rootSession.id}-${flow.latestActivityAt}`}>
          <header className="flow-card-header">
            <div>
              <p className="eyebrow">Flow</p>
              <h3>{getWorkspaceLabel(flow.rootSession.workspacePath)}</h3>
            </div>
            <div className="flow-meta">
              <span>{flow.sessions.length} sessions</span>
              <span>{formatTimestamp(flow.latestActivityAt)}</span>
            </div>
          </header>
          <div className="flow-session-list">
            {flow.sessions.map((summary) => (
              <button
                key={summary.session.id}
                type="button"
                className={`flow-session-button sb-thread qw-flow-row ${
                  selectedSessionId === summary.session.id ? 'active sb-thread-active' : ''
                }`}
                style={
                  {
                    '--flow-depth': String(summary.depth),
                  } as CSSProperties
                }
                onClick={() => {
                  onSelectSession(summary.session.id);
                }}
                >
                <div className="sidebar-item-title-row">
                  <span className="sb-thread-title">
                    {getWorkspaceLabel(summary.session.workspacePath)}
                  </span>
                  <span className="sidebar-item-badge">{summary.session.providerId}</span>
                </div>
                <span className="sb-thread-time sidebar-item-subline">{summary.runCount} runs</span>
                <span className="qw-flow-row-meta sidebar-item-subline">
                  {formatFlowSessionLabel(summary)}
                </span>
                <span className="qw-flow-row-meta sidebar-item-subline">
                  {formatFlowLatestRun(summary, formatRunStatus)}
                </span>
              </button>
            ))}
          </div>
        </article>
      ))}
    </>
  );
}
