import type { RunStatus } from '@codewave/protocol';
import type { RunViewState } from '../lib/run-view-state';
import { EmptyState } from './EmptyState';

type RunHistoryListProps = {
  selectedSessionId: string | null;
  runs: RunViewState['runs'];
  selectedRunId: string | null;
  emptyMessage?: string;
  formatRunStatus: (status: RunStatus) => string;
  formatTimestamp: (timestamp: string) => string;
  onSelectRun: (runId: string) => void;
};

export function RunHistoryList({
  selectedSessionId,
  runs,
  selectedRunId,
  emptyMessage,
  formatRunStatus,
  formatTimestamp,
  onSelectRun,
}: RunHistoryListProps) {
  if (!selectedSessionId) {
    return (
      <EmptyState
        title="No session selected"
        message="Select a session to inspect its runs."
      />
    );
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        title="No runs yet"
        message={emptyMessage ?? 'No runs have been started for this session yet.'}
      />
    );
  }

  return (
    <>
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          className={`session-item sb-thread qw-run-row ${
            selectedRunId === run.id ? 'active sb-thread-active' : ''
          }`}
          onClick={() => {
            onSelectRun(run.id);
          }}
        >
          <div className="sidebar-thread-head">
            <span className="sb-thread-title">{run.prompt}</span>
            <span className="sidebar-thread-status">{formatRunStatus(run.status)}</span>
          </div>
          <span className="sb-thread-time sidebar-item-subline">
            {formatTimestamp(run.createdAt)}
          </span>
        </button>
      ))}
    </>
  );
}
