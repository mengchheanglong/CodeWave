import type { ReactNode } from 'react';
import type { ApprovalPolicy, ProviderId } from '@codewave/protocol';
import { Badge } from '@codewave/ui-kit';
import type { ShellControlsState } from '../../lib/shell-controls-state';
import type { ShellPanelsState } from '../../lib/shell-panels-state';
import { renderAccessLabel, renderProviderLabel, type UtilityView } from '../../lib/shell-format';
import {
  requestApprovalResolution,
  requestCheckpointRecovery,
} from '../../app-controller';
import { formatTimestamp } from '../../shell-status-summary';
import { ApprovalListPanel } from '../ApprovalListPanel';
import { ArtifactListPanel } from '../ArtifactListPanel';
import { CheckpointListPanel } from '../CheckpointListPanel';
import { TabBar } from '../TabBar';
import { ToolActivityList } from '../ToolActivityList';
import { ToolRegistrationEvidenceList } from '../ToolRegistrationEvidenceList';
import { WorkspaceFilePanel } from '../WorkspaceFilePanel';
import { BrainIcon, PanelRightIcon } from '../icons';

export type UtilityTab = {
  id: UtilityView;
  label: string;
  badge?: number;
  hot?: boolean;
  icon?: ReactNode;
};

type InspectorProps = {
  utilityCollapsed: boolean;
  onToggleUtilityCollapsed: () => void;
  utilityView: UtilityView;
  onUtilityViewChange: (view: UtilityView) => void;
  utilityTabs: UtilityTab[];
  activeProviderId: ProviderId;
  activeApprovalPolicy: ApprovalPolicy;
  activeSessionId: string;
  hasActiveRun: boolean;
  contextUsagePercent: number;
  shellPanelsState: ShellPanelsState;
  shellControlsState: ShellControlsState;
};

export function Inspector({
  utilityCollapsed,
  onToggleUtilityCollapsed,
  utilityView,
  onUtilityViewChange,
  utilityTabs,
  activeProviderId,
  activeApprovalPolicy,
  activeSessionId,
  hasActiveRun,
  contextUsagePercent,
  shellPanelsState,
  shellControlsState,
}: InspectorProps) {
  const workspacePath = shellControlsState.workspacePath;

  return (
    <aside
      className={`utility-column utility-shell${
        utilityCollapsed ? ' utility-shell-collapsed' : ''
      }`}
    >
      <div
        className={`section-header section-header-compact inspector-header${
          utilityCollapsed ? ' inspector-header-collapsed' : ''
        }`}
      >
        {!utilityCollapsed ? (
          <div className="inspector-heading">
            <div className="inspector-heading-top">
              <BrainIcon size={14} />
              <h2>Inspector</h2>
              <Badge tone="accent">
                {renderProviderLabel(activeProviderId)}
              </Badge>
              <span className="inspector-header-note">
                {shellPanelsState.selectedSessionId
                  ? `session ${activeSessionId}`
                  : 'no session'}
              </span>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          className="utility-toggle-button"
          title={utilityCollapsed ? 'Open inspector' : 'Collapse inspector'}
          aria-label={utilityCollapsed ? 'Open inspector' : 'Collapse inspector'}
          onClick={onToggleUtilityCollapsed}
        >
          <PanelRightIcon size={14} />
        </button>
      </div>

      {utilityCollapsed ? (
        <div className="utility-mini-stack" aria-label="Collapsed utility views">
          {utilityTabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`utility-mini-button${
                utilityView === item.id ? ' active' : ''
              }`}
              onClick={() => {
                onUtilityViewChange(item.id);
                onToggleUtilityCollapsed();
              }}
            >
              <span className="utility-mini-code">
                {item.label.slice(0, 3).toUpperCase()}
              </span>
              {item.badge !== undefined ? (
                <span className="utility-mini-count">{item.badge}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="inspector-nav">
            <TabBar
              className="tab-bar-utility"
              activeId={utilityView}
              items={utilityTabs}
              onSelect={(id) => {
                onUtilityViewChange(id);
              }}
            />
          </div>

          <div className="section-scroll utility-scroll">
            {utilityView === 'approvals' ? (
              <section className="utility-section">
                <div className="utility-section-heading">
                  <p className="eyebrow">Pending</p>
                  <h3>Decisions</h3>
                </div>
                <div id="approval-list" className="list compact">
                  <ApprovalListPanel
                    approvals={shellPanelsState.approvals}
                    capabilities={shellPanelsState.selectedSessionCapabilities}
                    onResolveApproval={(approvalId, decision) => {
                      void requestApprovalResolution(approvalId, decision);
                    }}
                  />
                </div>
              </section>
            ) : null}

            {utilityView === 'tools' ? (
              <section className="utility-section utility-stack">
                <div className="utility-section-heading">
                  <p className="eyebrow">Activity</p>
                  <h3>Tool calls</h3>
                </div>
                <div id="tool-list" className="list compact">
                  <ToolActivityList tools={shellPanelsState.tools} />
                </div>
                <div className="tool-plane-subsection">
                  <div className="section-title">Session Registration Evidence</div>
                  <div id="tool-registration-list" className="list compact">
                    <ToolRegistrationEvidenceList
                      snapshot={shellPanelsState.toolPlane}
                      selectedProviderId={shellPanelsState.selectedProviderId}
                    />
                  </div>
                </div>
              </section>
            ) : null}

            {utilityView === 'files' ? (
              <section className="utility-section utility-stack">
                <div className="utility-section-heading">
                  <p className="eyebrow">Workspace</p>
                  <h3>Files</h3>
                </div>
                <WorkspaceFilePanel workspacePath={workspacePath} />
              </section>
            ) : null}

            {utilityView === 'artifacts' ? (
              <section className="utility-section">
                <div className="utility-section-heading">
                  <p className="eyebrow">Artifacts</p>
                  <h3>Captured output</h3>
                </div>
                <div id="artifact-list" className="list compact">
                  <ArtifactListPanel
                    artifacts={shellPanelsState.artifacts}
                    formatTimestamp={formatTimestamp}
                  />
                </div>
              </section>
            ) : null}

            {utilityView === 'checkpoints' ? (
              <section className="utility-section utility-stack">
                <div className="utility-section-heading">
                  <p className="eyebrow">Session</p>
                  <h3>Context</h3>
                </div>
                <div className="session-context-card">
                  <div className="ctx-row">
                    <span>Provider</span>
                    <b>{renderProviderLabel(activeProviderId)}</b>
                  </div>
                  <div className="ctx-row">
                    <span>Mode</span>
                    <b>{renderAccessLabel(activeApprovalPolicy)}</b>
                  </div>
                  <div className="ctx-row">
                    <span>Session</span>
                    <b>{activeSessionId}</b>
                  </div>
                  <div className="ctx-row">
                    <span>Workspace</span>
                    <b className="ctx-row-path">
                      {workspacePath || '—'}
                    </b>
                  </div>
                  <div className="ctx-row">
                    <span>Context</span>
                    <b>{hasActiveRun ? `${contextUsagePercent}%` : '—'}</b>
                  </div>
                </div>
                <div className="tool-plane-subsection">
                  <div className="section-title">Checkpoints</div>
                  <div id="checkpoint-list" className="list compact">
                    <CheckpointListPanel
                      checkpoints={shellPanelsState.checkpoints}
                      capabilities={shellPanelsState.selectedSessionCapabilities}
                      formatTimestamp={formatTimestamp}
                      onRecoverCheckpoint={(checkpointId) => {
                        void requestCheckpointRecovery(checkpointId);
                      }}
                    />
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </>
      )}
    </aside>
  );
}
