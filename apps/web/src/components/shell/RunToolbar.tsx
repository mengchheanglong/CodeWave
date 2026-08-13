import type { ShellControlsState } from '../../lib/shell-controls-state';
import type { ShellPanelsState } from '../../lib/shell-panels-state';
import type { RunViewState } from '../../lib/run-view-state';
import { renderAccessLabel, renderProviderLabel } from '../../lib/shell-format';
import {
  requestCancelSelectedRun,
  requestFollowUpRun,
  requestRecoverSelectedSession,
} from '../../app-controller';
import {
  CheckIcon,
  CollapseIcon,
  ExpandIcon,
  FileTextIcon,
  MoreIcon,
  RefreshIcon,
  SearchIcon,
  UndoIcon,
  XIcon,
} from '../icons';

type RunToolbarProps = {
  runViewState: RunViewState;
  shellControlsState: ShellControlsState;
  shellPanelsState: ShellPanelsState;
  showRunToolbar: boolean;
  onToggleShowRunToolbar: (show: boolean) => void;
  timelineExpandedAll: boolean;
  onToggleExpandAll: () => void;
  runMenuOpen: boolean;
  onRunMenuOpenChange: (open: boolean) => void;
  onShowFiles: () => void;
  onRequestUndo: (detail: string) => void;
};

export function RunToolbar({
  runViewState,
  shellControlsState,
  shellPanelsState,
  showRunToolbar,
  onToggleShowRunToolbar,
  timelineExpandedAll,
  onToggleExpandAll,
  runMenuOpen,
  onRunMenuOpenChange,
  onShowFiles,
  onRequestUndo,
}: RunToolbarProps) {
  const hasActiveSession = Boolean(shellPanelsState.selectedSessionId);
  const activeProviderId =
    shellPanelsState.selectedProviderId ?? shellControlsState.providerId;
  const activeApprovalPolicy = hasActiveSession
    ? shellControlsState.selectedSessionApprovalPolicy
    : shellControlsState.sessionApprovalPolicy;

  if (!hasActiveSession) {
    return null;
  }

  if (!showRunToolbar) {
    return (
      <div className="action-row run-toolbar-compact">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            onToggleShowRunToolbar(true);
          }}
        >
          Show controls
        </button>
      </div>
    );
  }

  return (
    <div className="run-toolbar-v2">
      <div className="run-toolbar-v2-meta">
        {runViewState.selectedRun ? (
          <span
            className="run-toolbar-v2-id"
            title={`Run ${runViewState.selectedRun.id}`}
          >
            Run {runViewState.selectedRun.id.slice(0, 8)}
          </span>
        ) : null}
      </div>
      <div className="run-toolbar-v2-actions">
        <button
          type="button"
          className="run-toolbar-v2-btn"
          onClick={onToggleExpandAll}
          title={timelineExpandedAll ? 'Collapse all step cards' : 'Expand all step cards'}
        >
          {timelineExpandedAll ? (
            <CollapseIcon size={13} />
          ) : (
            <ExpandIcon size={13} />
          )}
          {timelineExpandedAll ? 'Collapse all' : 'Expand all'}
        </button>
        <button
          id="cancel-run-button"
          type="button"
          className="run-toolbar-v2-btn run-toolbar-v2-danger"
          disabled={shellControlsState.cancelRunDisabled}
          onClick={() => {
            void requestCancelSelectedRun();
          }}
          title="Stop the active run"
        >
          <XIcon size={12} />
          Cancel
        </button>
        <div className="run-toolbar-v2-menu">
          <button
            type="button"
            className="run-toolbar-v2-btn"
            aria-haspopup="menu"
            aria-expanded={runMenuOpen}
            onClick={() => {
              onRunMenuOpenChange(!runMenuOpen);
            }}
          >
            <MoreIcon size={14} />
            Run menu
          </button>
          {runMenuOpen ? (
            <div className="run-toolbar-v2-popover" role="menu">
              <button
                type="button"
                className="run-toolbar-v2-menu-item"
                onClick={onShowFiles}
              >
                <FileTextIcon size={14} /> Files
              </button>
              <button
                id="review-run-button"
                type="button"
                className="run-toolbar-v2-menu-item"
                disabled={shellControlsState.reviewRunDisabled}
                onClick={() => {
                  onRunMenuOpenChange(false);
                  void requestFollowUpRun('review');
                }}
              >
                <SearchIcon size={14} />
                Review
              </button>
              <button
                id="verify-run-button"
                type="button"
                className="run-toolbar-v2-menu-item"
                disabled={shellControlsState.verifyRunDisabled}
                onClick={() => {
                  onRunMenuOpenChange(false);
                  void requestFollowUpRun('verify');
                }}
              >
                <CheckIcon size={14} />
                Verify
              </button>
              <button
                id="resume-session-button"
                type="button"
                className="run-toolbar-v2-menu-item"
                disabled={shellControlsState.resumeSessionDisabled}
                onClick={() => {
                  onRunMenuOpenChange(false);
                  void requestRecoverSelectedSession();
                }}
              >
                <RefreshIcon size={14} />
                Recover
              </button>
              <div className="run-toolbar-v2-divider" role="separator"></div>
              <button
                id="undo-run-button"
                type="button"
                className="run-toolbar-v2-menu-item run-toolbar-v2-menu-danger"
                disabled={!runViewState.undoAvailable}
                onClick={() => {
                  onRunMenuOpenChange(false);
                  onRequestUndo(runViewState.undoDetail ?? '');
                }}
                title={runViewState.undoDetail ?? 'Undo this run'}
              >
                <UndoIcon size={14} /> Undo
              </button>
              <button
                type="button"
                className="run-toolbar-v2-menu-item"
                onClick={() => {
                  onRunMenuOpenChange(false);
                  onToggleShowRunToolbar(false);
                }}
              >
                Hide controls
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
