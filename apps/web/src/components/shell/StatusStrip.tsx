import { Badge, ContextMeter } from '@qwemini/ui-kit';
import type { ShellControlsState } from '../../lib/shell-controls-state';
import type { ShellPanelsState } from '../../lib/shell-panels-state';
import type { ShellSummaryState } from '../../lib/shell-summary-state';
import { renderAccessLabel, renderProviderLabel } from '../../lib/shell-format';
import { BellIcon, BellOffIcon } from '../icons';

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
}: StatusStripProps) {
  const hasActiveSession = Boolean(shellPanelsState.selectedSessionId);
  const daemonConnection = shellSummaryState.daemonConnectionLabel;
  const daemonStatusLabel =
    daemonConnection === 'connected' ? 'daemon' : daemonConnection;
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
      <span className="status-strip-brand">
        <span className="status-strip-brand-mark" aria-hidden="true">
          <img src="/qwemini-mark.svg" alt="" className="app-menu-logo-mark" />
        </span>
        <span className="status-strip-brand-name">codewave</span>
      </span>
      <span className="status-strip-sep" aria-hidden="true">·</span>
      <span
        className={`status-strip-item status-strip-daemon status-dot-${daemonConnection}`}
        title={`Daemon ${daemonConnection}`}
      >
        <span
          className={`status-dot status-dot-${daemonConnection}`}
          aria-hidden="true"
        ></span>
        {daemonStatusLabel}
      </span>
      <span className="status-strip-sep" aria-hidden="true">·</span>
      <span className="status-strip-item status-strip-mode">
        <Badge tone="accent">{renderProviderLabel(activeProviderId)} · {renderAccessLabel(activeApprovalPolicy)}</Badge>
      </span>
      {hasActiveSession ? (
        <>
          <span className="status-strip-sep" aria-hidden="true">·</span>
          <span
            className={`status-strip-item status-strip-run ${runPhaseClassName}`}
            id="run-phase-status"
          >
            {shellSummaryState.runStatusLabel}
          </span>
        </>
      ) : null}
      <span className="status-strip-item status-strip-context">
        <ContextMeter
          percent={contextUsagePercent}
          label={contextUsagePercent > 0 ? `ctx ${contextUsagePercent}%` : 'ctx —'}
          title="Approximate context used by the selected run"
        />
      </span>
      <span className="status-strip-spacer" aria-hidden="true"></span>
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
  );
}
