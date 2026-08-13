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
import { BrainIcon, FolderIcon } from '../icons';
import { renderAccessLabel, renderProviderLabel } from '../../lib/shell-format';

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

function compactPolicyRevision(revision: string): string {
  return revision === 'legacy-unversioned' ? 'legacy' : revision.slice(0, 15);
}

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
              {runViewState.selectedRun?.providerConfigurationRevision ? (
                <span
                  className="run-policy-revision"
                  title={`Provider policy ${runViewState.selectedRun.providerConfigurationRevision}`}
                >
                  policy {compactPolicyRevision(runViewState.selectedRun.providerConfigurationRevision)}
                </span>
              ) : null}
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
                  transcript={runViewState.transcript}
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
          <div className="workspace-empty-ambient" aria-hidden="true"></div>
          <div className="workspace-empty-icon" aria-hidden="true">
            <span className="workspace-empty-icon-ring"></span>
            <span className="workspace-empty-glyph">
              <img src="/codewave-mark.svg" alt="" />
            </span>
          </div>
          <span className="workspace-empty-eyebrow">CodeWave · Local agent workspace</span>
          <strong className="workspace-empty-title">
            {hasActiveRun ? 'Continue the conversation' : 'Build with the right agent'}
          </strong>
          <span className="workspace-empty-message">
            {!shellControlsState.workspacePath.trim()
              ? 'Bring your code, choose the best engine, and keep every tool call, decision, and diff in one focused workspace.'
              : hasPromptDraft
                ? 'Your workspace is ready. Press Enter or click Send to create the thread.'
                : 'Your workspace is ready. Describe what you want to build below.'}
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
          <div className="workspace-empty-capabilities" aria-label="Workspace capabilities">
            <div className="workspace-capability-card">
              <span className="workspace-capability-index">01</span>
              <strong>Choose an engine</strong>
              <span>{renderProviderLabel(shellControlsState.providerId)} now, switch per thread</span>
            </div>
            <div className="workspace-capability-card">
              <span className="workspace-capability-index">02</span>
              <strong>Stay in control</strong>
              <span>{renderAccessLabel(shellControlsState.sessionApprovalPolicy)} access with visible approvals</span>
            </div>
            <div className="workspace-capability-card">
              <span className="workspace-capability-index">03</span>
              <strong>Keep every step</strong>
              <span>Tools, diffs, checkpoints, and handoffs</span>
            </div>
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
