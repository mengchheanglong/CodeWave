import type { ShellPanelsState } from '../../lib/shell-panels-state';
import { requestCreateSession } from '../../app-controller';
import { PlusIcon } from '../icons';

type ThreadTabsProps = {
  sessions: ShellPanelsState['recentSessions'];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
};

export function ThreadTabs({
  sessions,
  selectedSessionId,
  onSelectSession,
}: ThreadTabsProps) {
  if (sessions.length === 0) {
    return null;
  }

  return (
    <div className="thread-tabs" aria-label="Open threads">
      {sessions.slice(0, 8).map((session) => {
        const sessionTitle =
          session.latestRunPrompt?.trim().slice(0, 34) ||
          (session.orchestration
            ? `${session.orchestration.role} thread`
            : 'New thread');
        const isActive = session.id === selectedSessionId;
        return (
          <button
            key={session.id}
            type="button"
            className={`thread-tab${isActive ? ' active' : ''}`}
            title={session.workspacePath}
            onClick={() => {
              onSelectSession(session.id);
            }}
          >
            <span
              className={`thread-tab-dot thread-tab-dot-${session.providerId}`}
              aria-hidden="true"
            ></span>
            <span className="thread-tab-title">{sessionTitle}</span>
          </button>
        );
      })}
      <button
        type="button"
        className="thread-tab thread-tab-new"
        title="New thread"
        onClick={() => {
          void requestCreateSession();
        }}
      >
        <PlusIcon size={12} /> new
      </button>
    </div>
  );
}
