import { useEffect, useState } from 'react';
import type { ShellPanelsState } from '../lib/shell-panels-state';
import { EmptyState } from './EmptyState';
import { ChevronDownIcon, HomeIcon, MoreIcon } from './icons';

type RecentSessionListProps = {
  sessions: ShellPanelsState['recentSessions'];
  selectedSessionId: string | null;
  emptyMessage: string;
  emptyTitle?: string;
  onSelectSession: (sessionId: string) => void;
  onDeleteWorkspaceGroup: (workspacePath: string) => void;
  onDeleteSession: (sessionId: string) => void;
};

function getWorkspaceLabel(workspacePath: string) {
  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? workspacePath;
}

function getWorkspaceDisplayLabel(
  workspacePath: string,
  duplicateLeafLabels: Set<string>,
) {
  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  const leaf = segments.at(-1) ?? workspacePath;
  if (!duplicateLeafLabels.has(leaf.toLowerCase())) {
    return leaf;
  }

  const parent = segments.at(-2);
  if (!parent) {
    return leaf;
  }

  return `${parent}/${leaf}`;
}

function getThreadTitle(session: ShellPanelsState['recentSessions'][number]) {
  const prompt = session.latestRunPrompt?.trim();
  if (prompt) {
    return prompt.length > 34 ? `${prompt.slice(0, 34)}...` : prompt;
  }

  if (session.recovery) {
    return 'Recovered thread';
  }

  if (session.orchestration) {
    return `${session.orchestration.role} thread`;
  }

  return 'New thread';
}

export function RecentSessionList({
  sessions,
  selectedSessionId,
  emptyMessage,
  emptyTitle,
  onSelectSession,
  onDeleteWorkspaceGroup,
  onDeleteSession,
}: RecentSessionListProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | null>(null);
  const [openMenuWorkspacePath, setOpenMenuWorkspacePath] = useState<string | null>(null);

  useEffect(() => {
    if (!openMenuSessionId && !openMenuWorkspacePath) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (
        target.closest('.session-item-menu-shell') ||
        target.closest('.project-item-menu-shell')
      ) {
        return;
      }

      setOpenMenuSessionId(null);
      setOpenMenuWorkspacePath(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenMenuSessionId(null);
        setOpenMenuWorkspacePath(null);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuSessionId, openMenuWorkspacePath]);

  if (sessions.length === 0) {
    return <EmptyState title={emptyTitle ?? 'No sessions yet'} message={emptyMessage} />;
  }

  const groupedSessions = sessions.reduce<
    Array<{
      workspacePath: string;
      workspaceLabel: string;
      sessions: ShellPanelsState['recentSessions'];
    }>
  >((groups, session) => {
    const existing = groups.find((entry) => entry.workspacePath === session.workspacePath);
    if (existing) {
      existing.sessions.push(session);
      return groups;
    }

    groups.push({
      workspacePath: session.workspacePath,
      workspaceLabel: getWorkspaceLabel(session.workspacePath),
      sessions: [session],
    });
    return groups;
  }, []);

  const labelCounts = groupedSessions.reduce<Map<string, number>>((counts, group) => {
    const key = group.workspaceLabel.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  const duplicateLeafLabels = new Set(
    [...labelCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([label]) => label),
  );

  return (
    <>
      {groupedSessions.map((group) => (
        <section key={group.workspacePath} className="rail-project-group">
          <div className="rail-project-header-row">
            <button
              type="button"
              className="rail-project-header"
              aria-expanded={!collapsedGroups[group.workspacePath]}
              onClick={() => {
                setCollapsedGroups((current) => ({
                  ...current,
                  [group.workspacePath]: !current[group.workspacePath],
                }));
              }}
            >
              <span
                className={`rail-project-caret${
                  collapsedGroups[group.workspacePath] ? ' is-collapsed' : ''
                }`}
                aria-hidden="true"
              >
                <ChevronDownIcon size={12} />
              </span>
              <span className="rail-project-icon" aria-hidden="true">
                <HomeIcon size={13} />
              </span>
              <span className="rail-project-info">
                <span className="rail-project-name">
                  {getWorkspaceDisplayLabel(group.workspacePath, duplicateLeafLabels)}
                </span>
                <span className="rail-project-path" title={group.workspacePath}>
                  {group.workspacePath}
                </span>
              </span>
            </button>
            <div
              className={`project-item-menu-shell${
                openMenuWorkspacePath === group.workspacePath ? ' open' : ''
              }`}
            >
              <button
                type="button"
                className="project-item-menu-trigger"
                aria-label={`Folder menu for ${group.workspacePath}`}
                title="Folder actions"
                aria-expanded={openMenuWorkspacePath === group.workspacePath}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenMenuSessionId(null);
                  setOpenMenuWorkspacePath((current) =>
                    current === group.workspacePath ? null : group.workspacePath,
                  );
                }}
              >
                <MoreIcon size={14} />
              </button>
              <div
                className="project-item-menu-popover"
                hidden={openMenuWorkspacePath !== group.workspacePath}
              >
                <button
                  type="button"
                  className="session-item-menu-action"
                  onClick={() => {
                    setOpenMenuWorkspacePath(null);
                    onDeleteWorkspaceGroup(group.workspacePath);
                  }}
                >
                  Delete folder
                </button>
              </div>
            </div>
          </div>

          {!collapsedGroups[group.workspacePath] ? (
            <div className="rail-project-threads">
              {group.sessions.map((session) => (
                <div key={session.id} className="rail-session-row">
                  <button
                    type="button"
                    title={session.workspacePath}
                    className={`session-item sb-project qw-session-row ${
                      selectedSessionId === session.id ? 'active sb-project-active' : ''
                    }`}
                    onClick={() => {
                      onSelectSession(session.id);
                    }}
                  >
                    <div className="session-item-head qw-session-row-head sidebar-item-title-row">
                      <span
                        className={`thread-tab-dot thread-tab-dot-${session.providerId}`}
                        aria-hidden="true"
                      ></span>
                      <strong className="sb-project-name">{getThreadTitle(session)}</strong>
                    </div>
                    <div className="qw-session-row-meta">
                      <span className="qw-session-row-provider">
                        {session.providerId}
                      </span>
                      <span className="qw-session-row-policy">
                        {session.approvalPolicy === 'allow'
                          ? 'auto'
                          : session.approvalPolicy === 'deny'
                            ? 'read-only'
                            : 'ask'}
                      </span>
                    </div>
                  </button>

                  <div
                    className={`session-item-menu-shell${
                      openMenuSessionId === session.id ? ' open' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="session-item-menu-trigger"
                      aria-label={`Thread menu for ${getThreadTitle(session)}`}
                      title="Thread actions"
                      aria-expanded={openMenuSessionId === session.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenMenuWorkspacePath(null);
                        setOpenMenuSessionId((current) =>
                          current === session.id ? null : session.id,
                        );
                      }}                      >
                        <MoreIcon size={14} />
                      </button>
                    <div
                      className="session-item-menu-popover"
                      hidden={openMenuSessionId !== session.id}
                    >
                      <button
                        type="button"
                        className="session-item-menu-action"
                        onClick={() => {
                          onDeleteSession(session.id);
                        }}
                      >
                        Delete thread
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </>
  );
}
