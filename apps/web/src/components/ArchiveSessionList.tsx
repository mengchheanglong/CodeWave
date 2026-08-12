import type { RunStatus } from '@codewave/protocol';
import type { ShellPanelsState } from '../lib/shell-panels-state';
import { EmptyState } from './EmptyState';

type ArchiveSessionListProps = {
  archiveSessions: ShellPanelsState['archiveSessions'];
  selectedSessionId: string | null;
  emptyMessage?: string;
  formatRunStatus: (status: RunStatus) => string;
  formatSessionOrchestration: (
    session: ShellPanelsState['archiveSessions'][number]['session'],
  ) => string | null;
  formatSessionRecovery: (
    session: ShellPanelsState['archiveSessions'][number]['session'],
  ) => string | null;
  onSelectSession: (sessionId: string) => void;
};

function getWorkspaceLabel(workspacePath: string) {
  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? workspacePath;
}

export function ArchiveSessionList({
  archiveSessions,
  selectedSessionId,
  emptyMessage,
  formatRunStatus,
  formatSessionOrchestration,
  formatSessionRecovery,
  onSelectSession,
}: ArchiveSessionListProps) {
  if (archiveSessions.length === 0) {
    return (
      <EmptyState
        title="Archive is empty"
        message={emptyMessage ?? 'Session summaries will appear here.'}
      />
    );
  }

  return (
    <>
      {archiveSessions.map((summary) => {
        const latestRunLine = summary.latestRun
          ? `${formatRunStatus(summary.latestRun.status)} - ${summary.latestRun.prompt}`
          : 'No runs yet';

        return (
          <button
            key={summary.session.id}
            type="button"
            title={summary.session.workspacePath}
            className={`session-item archive-item sb-thread qw-archive-row ${
              selectedSessionId === summary.session.id ? 'active sb-thread-active' : ''
            }`}
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
            <span className="sb-thread-time sidebar-item-subline">
              {summary.runCount} runs · {summary.session.approvalPolicy}
            </span>
            <span className="qw-archive-row-meta sidebar-item-subline">
              {summary.session.orchestration
                ? formatSessionOrchestration(summary.session)
                : summary.session.recovery
                  ? `recovered from ${formatSessionRecovery(summary.session)}`
                  : latestRunLine}
            </span>
          </button>
        );
      })}
    </>
  );
}
