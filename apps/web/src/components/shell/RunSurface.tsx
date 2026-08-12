import type { RunViewState } from '../../lib/run-view-state';
import type { ShellControlsState } from '../../lib/shell-controls-state';
import type { ShellPanelsState } from '../../lib/shell-panels-state';
import type { ShellSummaryState } from '../../lib/shell-summary-state';
import type { RunViewTab } from '../../lib/shell-format';
import {
  requestApprovalResolution,
  requestExecutePlan,
} from '../../app-controller';
import { formatTimestamp } from '../../shell-status-summary';
import { RunTimelinePanel } from '../RunTimelinePanel';
import { RunTranscriptPanel } from '../RunTranscriptPanel';
import { TabBar } from '../TabBar';
import { BrainIcon, FolderIcon, SendIcon } from '../icons';

type RunSurfaceProps = {
  runViewState: RunViewState;
  shellControlsState: ShellControlsState;
  shellPanelsState: ShellPanelsState;
  shellSummaryState: ShellSummaryState;
  runViewTab: RunViewTab;
  onRunViewTabChange: (tab: RunViewTab) => void;
  showThinking: boolean;
  onToggleThinking: () => void;
  timelineExpandSignal: number;
  inspectorTimeline: RunViewState['events'];
  hasActiveRun: boolean;
  hasPromptDraft: boolean;
  onOpenFolder: () => void;
};

export function RunSurface({
  runViewState,
  shellControlsState,
  shellPanelsState,
  shellSummaryState,
  runViewTab,
  onRunViewTabChange,
  showThinking,
  onToggleThinking,
  timelineExpandSignal,
  inspectorTimeline,
  hasActiveRun,
  hasPromptDraft,
  onOpenFolder,
}: RunSurfaceProps) {
  const hasActiveSession = Boolean(shellPanelsState.selectedSessionId);

  return (
    <section className="run-surface panes-run-surface">
      {hasActiveSession ? (
        <>
          <div className="conversation-view-header">
            <div className="terminal-tabbar">
              <TabBar
                className="tab-bar-run"
                activeId={runViewTab}
                items={[
                  { id: 'chat' as const, label: 'Thread' },
                  {
                    id: 'timeline' as const,
                    label: 'Events',
                    badge: inspectorTimeline.length,
                  },
                ]}
                onSelect={(id) => {
                  onRunViewTabChange(id);
                }}
              />
            </div>
            <div className="conversation-view-note">
              <button
                type="button"
                className={`conversation-toggle-button${showThinking ? ' active' : ''}`}
                onClick={onToggleThinking}
                title="Toggle thinking blocks (Ctrl+T)"
              >
                <BrainIcon size={12} /> thinking {showThinking ? 'on' : 'off'}
              </button>
            </div>
          </div>

          <div className="section-scroll run-scroll panes-run-scroll">
            {runViewTab === 'chat' ? (
              <div id="thread-feed" className="timeline thread-view">
                <RunTranscriptPanel
                  selectedRun={runViewState.selectedRun}
                  events={runViewState.events}
                  approvals={shellPanelsState.approvals}
                  onResolveApproval={(approvalId, decision) => {
                    void requestApprovalResolution(approvalId, decision);
                  }}
                  onExecutePlan={(planText) => {
                    void requestExecutePlan(planText);
                  }}
                  showThinking={showThinking}
                  formatTimestamp={formatTimestamp}
                  expandAllSignal={timelineExpandSignal}
                />
              </div>
            ) : null}

            {runViewTab === 'timeline' ? (
              <div id="timeline" className="timeline timeline-secondary">
                <RunTimelinePanel
                  selectedRun={runViewState.selectedRun}
                  timeline={inspectorTimeline}
                  formatTimestamp={formatTimestamp}
                />
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="workspace-empty-state">
          <div className="workspace-empty-icon" aria-hidden="true">
            <span className="workspace-empty-glyph">
              <SendIcon size={20} />
            </span>
          </div>
          <strong className="workspace-empty-title">
            {hasActiveRun ? 'Continue the conversation' : 'Start a conversation'}
          </strong>
          <span className="workspace-empty-message">
            {!shellControlsState.workspacePath.trim()
              ? 'Open a folder to choose where Qwemini works, then send your first prompt.'
              : hasPromptDraft
                ? 'Press Enter or click Send — your thread is created automatically.'
                : 'Type your message below and press Enter to start — your thread is created automatically.'}
          </span>
          {!shellControlsState.workspacePath.trim() ? (
            <button
              type="button"
              className="workspace-empty-button"
              onClick={onOpenFolder}
            >
              <FolderIcon size={14} /> Open a folder
            </button>
          ) : null}
          <div className="workspace-empty-steps" aria-hidden="true">
            <span>1 · open a folder</span>
            <span>2 · pick provider &amp; mode</span>
            <span>3 · type and send</span>
          </div>
          {!hasPromptDraft && shellControlsState.promptDisabled ? (
            <div className="workspace-empty-hint">
              {!shellControlsState.providerId
                ? 'Choose a provider to get started.'
                : 'Draft a prompt to enable the Send button.'}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
