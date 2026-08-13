import type { RunStatus } from '@codewave/protocol';
import type { ShellPanelsState } from '../lib/shell-panels-state';

type OrchestrationSwimlanesProps = {
  orchestrationFlows: ShellPanelsState['orchestrationFlows'];
  selectedSessionId: string | null;
  emptyMessage?: string;
  formatTimestamp: (timestamp: string) => string;
  formatRunStatus: (status: RunStatus) => string;
  onSelectSession: (sessionId: string) => void;
};

function getWorkspaceLabel(workspacePath: string) {
  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? workspacePath;
}

function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'planner':
      return 'planner';
    case 'researcher':
      return 'researcher';
    case 'reviewer':
      return 'reviewer';
    case 'verifier':
      return 'verifier';
    case 'main':
      return 'main';
    default:
      return 'main';
  }
}

function kindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case 'route':
      return 'route';
    case 'delegate':
      return 'delegate';
    case 'review':
      return 'review';
    case 'verify':
      return 'verify';
    case 'handoff':
      return 'handoff';
    default:
      return 'session';
  }
}

const ROLE_ORDER: string[] = ['main', 'planner', 'researcher', 'reviewer', 'verifier'];

export function OrchestrationSwimlanes({
  orchestrationFlows,
  selectedSessionId,
  emptyMessage,
  formatTimestamp,
  formatRunStatus,
  onSelectSession,
}: OrchestrationSwimlanesProps) {
  const flows = orchestrationFlows.filter(
    (flow) =>
      flow.sessions.length > 1 || flow.rootSession.orchestration?.kind === 'route',
  );

  if (flows.length === 0) {
    return (
      <div className="empty swimlane-empty">
        {emptyMessage ?? 'Routed and child sessions will gather here as orchestration lanes.'}
      </div>
    );
  }

  return (
    <div className="swimlane-board">
      {flows.map((flow) => {
        const sortedSessions = [...flow.sessions].sort((left, right) => {
          const leftRole = left.session.orchestration?.role ?? 'main';
          const rightRole = right.session.orchestration?.role ?? 'main';
          const leftIndex = ROLE_ORDER.indexOf(leftRole);
          const rightIndex = ROLE_ORDER.indexOf(rightRole);
          if (leftIndex !== rightIndex) {
            return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
          }
          return left.depth - right.depth;
        });

        return (
          <article
            className="swimlane"
            key={`${flow.rootSession.id}-${flow.latestActivityAt}`}
          >
            <header className="swimlane-header">
              <div>
                <p className="eyebrow">Flow</p>
                <h3>{getWorkspaceLabel(flow.rootSession.workspacePath)}</h3>
              </div>
              <div className="flow-meta">
                <span>{flow.sessions.length} sessions</span>
                <span>{formatTimestamp(flow.latestActivityAt)}</span>
              </div>
            </header>
            <div className="swimlane-track">
              {sortedSessions.map((summary, index) => (
                <div
                  className="swimlane-segment"
                  key={summary.session.id}
                >
                  <button
                    type="button"
                    className={`swimlane-node sb-thread qw-flow-row ${
                      selectedSessionId === summary.session.id ? 'active sb-thread-active' : ''
                    }`}
                    onClick={() => {
                      onSelectSession(summary.session.id);
                    }}
                  >
                    <span className="swimlane-node-role">
                      {roleLabel(summary.session.orchestration?.role)}
                    </span>
                    <span className="swimlane-node-kind">
                      {kindLabel(summary.session.orchestration?.kind)}
                    </span>
                    <span className="swimlane-node-provider">
                      {summary.session.providerId}
                    </span>
                    {summary.latestRun ? (
                      <span className={`swimlane-node-status status-${summary.latestRun.status}`}>
                        {formatRunStatus(summary.latestRun.status)}
                      </span>
                    ) : (
                      <span className="swimlane-node-status">no runs</span>
                    )}
                    <span className="swimlane-node-prompt">
                      {summary.latestRun?.prompt ?? '—'}
                    </span>
                    <span className="swimlane-node-runs">{summary.runCount} runs</span>
                  </button>
                  {index < sortedSessions.length - 1 ? (
                    <span className="swimlane-arrow" aria-hidden="true">
                      →
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}
