import { Badge, ContextMeter } from '@codewave/ui-kit';
import type { Ref } from 'react';
import type { ShellControlsState } from '../../lib/shell-controls-state';
import type { ShellPanelsState } from '../../lib/shell-panels-state';
import type { ShellSummaryState } from '../../lib/shell-summary-state';
import { renderAccessLabel, renderProviderLabel } from '../../lib/shell-format';
import { BellIcon, BellOffIcon, FolderIcon, MenuIcon } from '../icons';

type StatusStripProps = {
  shellControlsState: ShellControlsState;
  shellPanelsState: ShellPanelsState;
  shellSummaryState: ShellSummaryState;
  workspaceLabel: string;
  workspaceTitle: string;
  contextUsagePercent: number;
  theme?: 'dark';
  onToggleTheme?: () => void;
  attentionBellOn: boolean;
  onToggleBell: () => void;
  compactNavigationOpen: boolean;
  onToggleCompactNavigation: () => void;
  compactNavigationToggleRef?: Ref<HTMLButtonElement>;
};

export function StatusStrip({
  shellControlsState,
  shellPanelsState,
  shellSummaryState,
  workspaceLabel,
  workspaceTitle,
  contextUsagePercent,
  attentionBellOn,
  onToggleBell,
  compactNavigationOpen,
  onToggleCompactNavigation,
  compactNavigationToggleRef,
}: StatusStripProps) {
  const hasActiveSession = Boolean(shellPanelsState.selectedSessionId);
  const daemonConnection = shellSummaryState.daemonConnectionLabel;
  const daemonStatusLabel =
    daemonConnection === 'connected' ? 'daemon' : daemonConnection;
  const daemonProtocol = shellPanelsState.daemonProtocol;
  const activeProviderId =
    shellPanelsState.selectedProviderId ?? shellControlsState.providerId;
  const activeApprovalPolicy = hasActiveSession
    ? shellControlsState.selectedSessionApprovalPolicy
    : shellControlsState.sessionApprovalPolicy;
  const runPhaseClassName = shellSummaryState.runStatusClassName
    .split(' ')
    .filter((token) => token.startsWith('status-'))
    .pop() ?? 'status-idle';

  return (
    <div className="status-strip app-status-strip" aria-label="Status">
      <div className="status-strip-group status-strip-group-primary">
        <button
          ref={compactNavigationToggleRef}
          type="button"
          className="status-strip-navigation-toggle"
          aria-label={compactNavigationOpen ? 'Close navigation' : 'Open navigation'}
          aria-controls="workspace-navigation"
          aria-expanded={compactNavigationOpen}
          onClick={onToggleCompactNavigation}
        >
          <MenuIcon size={16} />
        </button>
        <span className="status-strip-brand">
          <span className="status-strip-brand-mark" aria-hidden="true">
            <img src="/codewave-mark.svg" alt="" />
          </span>
          <span className="status-strip-brand-name">CodeWave</span>
          <span className="status-strip-brand-edition">local</span>
        </span>
        <span className="status-strip-divider" aria-hidden="true"></span>
        <span
          className="status-strip-workspace"
          title={workspaceTitle || workspaceLabel}
        >
          <FolderIcon size={13} />
          <span>{workspaceTitle || workspaceLabel}</span>
        </span>
      </div>

      <div className="status-strip-group status-strip-group-runtime">
        <span className="status-strip-item status-strip-mode">
          <Badge tone="accent" dot>
            {renderProviderLabel(activeProviderId)}
          </Badge>
          <span className="status-strip-access">
            {renderAccessLabel(activeApprovalPolicy)}
          </span>
        </span>
        {hasActiveSession ? (
          <span
            className={`status-strip-item status-strip-run ${runPhaseClassName}`}
            id="run-phase-status"
          >
            <span className="status-run-pulse" aria-hidden="true"></span>
            {shellSummaryState.runStatusLabel}
          </span>
        ) : null}
      </div>

      <div className="status-strip-group status-strip-group-actions">
        <span className="status-strip-item status-strip-context">
          <ContextMeter
            percent={contextUsagePercent}
            label={contextUsagePercent > 0 ? `${contextUsagePercent}%` : '—'}
            title="Approximate context used by the selected run"
          />
        </span>
        <span
          className={`status-strip-item status-strip-daemon status-dot-${daemonConnection}`}
          title={
            daemonProtocol
              ? `Daemon ${daemonConnection} · protocol v${daemonProtocol.version} · ${daemonProtocol.capabilities.length} capabilities · ${daemonProtocol.availableScopes.length} scopes`
              : `Daemon ${daemonConnection}`
          }
        >
          <span
            className={`status-dot status-dot-${daemonConnection}`}
            aria-hidden="true"
          ></span>
          {daemonStatusLabel}
        </span>
        <button
          type="button"
          className={`status-strip-item status-strip-bell${attentionBellOn ? '' : ' muted'}`}
          onClick={onToggleBell}
          title={
            attentionBellOn
              ? 'Desktop notifications on — click to mute'
              : 'Desktop notifications off — click to enable'
          }
          aria-pressed={attentionBellOn}
        >
          {attentionBellOn ? <BellIcon size={14} /> : <BellOffIcon size={14} />}
        </button>
      </div>
    </div>
  );
}
