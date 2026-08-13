import type { Ref } from 'react';
import { PanelRightIcon, SearchIcon, TrashIcon } from '../icons';

type ConversationHeaderProps = {
  workspaceLabel: string;
  title: string;
  hasActiveSession: boolean;
  runCount: number;
  runPhaseClassName: string;
  runStatusLabel: string;
  selectedSessionNote: string;
  toolPlaneNote: string;
  onOpenQuickOpen: () => void;
  utilityCollapsed: boolean;
  utilityToggleRef?: Ref<HTMLButtonElement>;
  onToggleUtility: () => void;
  onDeleteSession?: () => void;
};

export function ConversationHeader({
  workspaceLabel,
  title,
  hasActiveSession,
  runCount,
  runPhaseClassName,
  runStatusLabel,
  selectedSessionNote,
  toolPlaneNote,
  onOpenQuickOpen,
  utilityCollapsed,
  utilityToggleRef,
  onToggleUtility,
  onDeleteSession,
}: ConversationHeaderProps) {
  return (
    <header className="conversation-header">
      <div className="conversation-header-copy">
        <div className="conversation-breadcrumbs">
          <span className="conversation-workspace">{workspaceLabel}</span>
          <span className="conversation-breadcrumb-separator">/</span>
          <strong id="run-title">{title}</strong>
          {hasActiveSession ? (
            <span className="conversation-badge">+{runCount} runs</span>
          ) : null}
          {hasActiveSession ? (
            <span className={`phase-chip ${runPhaseClassName}`} id="run-phase-chip">
              {runStatusLabel}
            </span>
          ) : null}
          {!hasActiveSession ? (
            <span className="conversation-inline-note" id="selected-session-note">
              Open a folder and send a message to begin.
            </span>
          ) : null}
        </div>
        {hasActiveSession ? (
          <div className="conversation-header-meta">
            <span id="selected-session-note">{selectedSessionNote}</span>
            <span className="conversation-meta-separator" aria-hidden="true"></span>
            <span title={toolPlaneNote}>Tools governed by CodeWave</span>
          </div>
        ) : null}
      </div>
      <div className="conversation-header-actions">
        {hasActiveSession && onDeleteSession ? (
          <button
            type="button"
            className="header-icon-button header-icon-button-danger"
            title="Delete thread"
            aria-label="Delete thread"
            onClick={onDeleteSession}
          >
            <TrashIcon size={15} />
          </button>
        ) : null}
        <button
          type="button"
          className="header-command-button"
          title="Quick open"
          aria-label="Quick open"
          onClick={onOpenQuickOpen}
        >
          <SearchIcon size={15} />
          <span>Search</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button
          ref={utilityToggleRef}
          type="button"
          className={`header-icon-button${!utilityCollapsed ? ' active' : ''}`}
          title={utilityCollapsed ? 'Open right rail' : 'Hide right rail'}
          aria-label={utilityCollapsed ? 'Open right rail' : 'Hide right rail'}
          aria-pressed={!utilityCollapsed}
          onClick={onToggleUtility}
        >
          <PanelRightIcon size={15} />
        </button>
      </div>
    </header>
  );
}
