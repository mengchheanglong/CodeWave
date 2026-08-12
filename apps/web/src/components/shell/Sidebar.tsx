import type { RefObject } from 'react';
import type { ShellControlsState } from '../../lib/shell-controls-state';
import type { ShellPanelsState } from '../../lib/shell-panels-state';
import type { ShellSummaryState } from '../../lib/shell-summary-state';
import type { RunViewState } from '../../lib/run-view-state';
import {
  getRailSectionLabel,
  parseApprovalPolicy,
  parseProviderId,
  railViewIcon,
  type RailView,
} from '../../lib/shell-format';
import {
  requestCreateSession,
  requestSessionDraftChange,
  requestWorkspaceDraftCommit,
} from '../../app-controller';
import { ArchiveSessionList } from '../ArchiveSessionList';
import { OrchestrationSwimlanes } from '../OrchestrationSwimlanes';
import { RecentSessionList } from '../RecentSessionList';
import { RunHistoryList } from '../RunHistoryList';
import { FolderIcon, PlusIcon, SearchIcon } from '../icons';
import {
  formatRunStatus,
  formatSessionOrchestration,
  formatSessionRecovery,
  formatTimestamp,
} from '../../shell-status-summary';

export type RailTab = {
  id: RailView;
  label: string;
  badge: number;
};

type SidebarProps = {
  shellControlsState: ShellControlsState;
  onAddFolder: () => void;
  shellPanelsState: ShellPanelsState;
  shellSummaryState: ShellSummaryState;
  runViewState: RunViewState;
  showSessionSetup: boolean;
  onToggleSessionSetup: () => void;
  railView: RailView;
  onRailViewChange: (view: RailView) => void;
  railFilter: string;
  onRailFilterChange: (value: string) => void;
  railSectionBadge: number;
  railTabs: RailTab[];
  filteredRecentSessions: ShellPanelsState['recentSessions'];
  filteredRuns: RunViewState['runs'];
  filteredArchiveSessions: ShellPanelsState['archiveSessions'];
  filteredOrchestrationFlows: ShellPanelsState['orchestrationFlows'];
  onSelectSession: (sessionId: string) => void;
  onSelectRun: (runId: string) => void;
  onDeleteWorkspaceGroup: (workspacePath: string) => void;
  onDeleteSession: (sessionId: string) => void;
  railFilterInputRef: RefObject<HTMLInputElement | null>;
};

export function Sidebar({
  shellControlsState,
  onAddFolder,
  shellPanelsState,
  shellSummaryState,
  runViewState,
  showSessionSetup,
  onToggleSessionSetup,
  railView,
  onRailViewChange,
  railFilter,
  onRailFilterChange,
  railSectionBadge,
  railTabs,
  filteredRecentSessions,
  filteredRuns,
  filteredArchiveSessions,
  filteredOrchestrationFlows,
  onSelectSession,
  onSelectRun,
  onDeleteWorkspaceGroup,
  onDeleteSession,
  railFilterInputRef,
}: SidebarProps) {
  const normalizedRailFilter = railFilter.trim().toLowerCase();

  return (
    <aside className="workspace-column panes-sidebar">
      <div className="sidebar-top">
        <div className="sidebar-brand-block">
          <div className="sidebar-action-stack">
            <button
              type="button"
              className="sidebar-primary-button"
              onClick={() => {
                void requestCreateSession();
              }}
            >
              <PlusIcon size={14} /> New thread
            </button>
            <button
              type="button"
              className="sidebar-mode-button"
              onClick={onAddFolder}
            >
              <FolderIcon size={14} /> Add folder
            </button>
          </div>
        </div>
      </div>

      {showSessionSetup ? (
        <form
          id="session-form"
          className="session-dock panes-session-dock panes-session-dock-compact"
          onSubmit={(event) => {
            event.preventDefault();
            void requestCreateSession();
          }}
        >
          <label className="session-field session-field-workspace">
            <span>Workspace</span>
            <input
              id="workspace-path"
              name="workspacePath"
              type="text"
              required
              value={shellControlsState.workspacePath}
              onChange={(event) => {
                void requestSessionDraftChange({
                  workspacePath: event.target.value,
                });
              }}
              onBlur={() => {
                void requestWorkspaceDraftCommit();
              }}
            />
          </label>

          <div className="session-dock-grid">
            <label className="session-field">
              <span>Provider</span>
              <select
                id="provider-id"
                name="providerId"
                value={shellControlsState.providerId}
                onChange={(event) => {
                  void requestSessionDraftChange({
                    providerId: parseProviderId(event.target.value),
                  });
                }}
              >
                <option value="qwen">Qwen</option>
                <option value="gemini">Gemini</option>
                <option value="opencode">OpenCode</option>
                <option value="freebuff">Freebuff</option>
              </select>
            </label>

            <label className="session-field">
              <span>Policy</span>
              <select
                id="session-approval-policy-input"
                name="approvalPolicy"
                value={shellControlsState.sessionApprovalPolicy}
                disabled={shellControlsState.sessionApprovalPolicyDisabled}
                onChange={(event) => {
                  void requestSessionDraftChange({
                    sessionApprovalPolicy: parseApprovalPolicy(event.target.value),
                  });
                }}
              >
                <option value="manual">Manual</option>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </select>
            </label>
          </div>

          <p id="session-provider-note" className="chip-note session-dock-hint">
            {shellSummaryState.sessionProviderNote}
          </p>

          <div className="session-dock-actions">
            <button type="submit">Create Session</button>
          </div>
        </form>
      ) : null}

      <div className="rail-section panes-sidebar-section">
        <div className="sidebar-section-header">
          <span className="sidebar-section-label">
            {getRailSectionLabel(railView)}
            {railSectionBadge > 0 ? (
              <span className="sidebar-section-count">{railSectionBadge}</span>
            ) : null}
          </span>
          <button
            type="button"
            className="sidebar-section-action"
            onClick={() => {
              if (railView === 'recent') {
                onToggleSessionSetup();
                return;
              }
              onRailViewChange('recent');
            }}
          >
            {railView === 'recent' ? (showSessionSetup ? 'Hide setup' : 'Setup') : 'Back'}
          </button>
        </div>

        <div className="rail-filter-row">
          <SearchIcon size={13} className="rail-filter-icon" aria-hidden="true" />
          <input
            ref={railFilterInputRef}
            type="search"
            className="rail-filter-input"
            value={railFilter}
            placeholder={`Filter ${getRailSectionLabel(railView).toLowerCase()}...`}
            aria-label="Filter rail items"
            onChange={(event) => {
              onRailFilterChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && railFilter) {
                event.preventDefault();
                onRailFilterChange('');
              }
            }}
          />
          {railFilter ? (
            <button
              type="button"
              className="rail-filter-clear"
              onClick={() => {
                onRailFilterChange('');
                railFilterInputRef.current?.focus();
              }}
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="section-scroll dock-scroll">
          {railView === 'recent' ? (
            <div id="session-list" className="list rail-list">
              <RecentSessionList
                sessions={filteredRecentSessions}
                selectedSessionId={shellPanelsState.selectedSessionId}
                emptyMessage={
                  normalizedRailFilter
                    ? `No threads match "${railFilter.trim()}".`
                    : shellPanelsState.recentSessionsMessage ?? 'No sessions yet.'
                }
                onSelectSession={onSelectSession}
                onDeleteWorkspaceGroup={onDeleteWorkspaceGroup}
                onDeleteSession={onDeleteSession}
              />
            </div>
          ) : null}

          {railView === 'history' ? (
            <div id="run-history-list" className="list rail-list compact">
              <RunHistoryList
                selectedSessionId={runViewState.selectedSessionId}
                runs={filteredRuns}
                selectedRunId={runViewState.selectedRun?.id ?? null}
                emptyMessage={
                  normalizedRailFilter
                    ? `No runs match "${railFilter.trim()}".`
                    : undefined
                }
                formatRunStatus={formatRunStatus}
                formatTimestamp={formatTimestamp}
                onSelectRun={onSelectRun}
              />
            </div>
          ) : null}

          {railView === 'archive' ? (
            <div id="archive-list" className="list rail-list compact">
              <ArchiveSessionList
                archiveSessions={filteredArchiveSessions}
                selectedSessionId={shellPanelsState.selectedSessionId}
                emptyMessage={
                  normalizedRailFilter
                    ? `No archived sessions match "${railFilter.trim()}".`
                    : undefined
                }
                formatRunStatus={formatRunStatus}
                formatSessionOrchestration={formatSessionOrchestration}
                formatSessionRecovery={formatSessionRecovery}
                onSelectSession={onSelectSession}
              />
            </div>
          ) : null}

          {railView === 'flows' ? (
            <div id="orchestration-board" className="list rail-list compact">
              <OrchestrationSwimlanes
                orchestrationFlows={filteredOrchestrationFlows}
                selectedSessionId={shellPanelsState.selectedSessionId}
                emptyMessage={
                  normalizedRailFilter
                    ? `No flows match "${railFilter.trim()}".`
                    : undefined
                }
                formatTimestamp={formatTimestamp}
                formatRunStatus={formatRunStatus}
                onSelectSession={onSelectSession}
              />
            </div>
          ) : null}

          <div className="sidebar-nav-group">
            {railTabs
              .filter((item) => item.id !== railView)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="sidebar-nav-row"
                  onClick={() => {
                    onRailViewChange(item.id);
                  }}
                >
                  <span className="sidebar-nav-label">
                    {railViewIcon(item.id)}
                    {getRailSectionLabel(item.id)}
                  </span>
                  <span className="sidebar-nav-count">{item.badge ?? 0}</span>
                </button>
              ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
