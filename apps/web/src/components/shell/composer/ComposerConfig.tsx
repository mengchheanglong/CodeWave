import { useRef, type RefObject } from 'react';
import type { ApprovalPolicy, ProviderId } from '@codewave/protocol';
import type { ShellControlsState } from '../../../lib/shell-controls-state';
import type { ShellPanelsState } from '../../../lib/shell-panels-state';
import type { ShellSummaryState } from '../../../lib/shell-summary-state';
import {
  MODE_DESCRIPTIONS,
  parseDelegateRole,
  renderAccessLabel,
  renderProviderLabel,
  renderRoutingToolLabel,
} from '../../../lib/shell-format';
import {
  requestDelegatePrompt,
  requestDelegateRoleChange,
  requestHandoffPrompt,
  requestRoutePrompt,
  requestRoutingToolsDraftChange,
  requestRunModeChange,
  requestSessionDraftChange,
  requestWorkspaceDraftCommit,
} from '../../../app-controller';
import {
  CheckIcon,
  ChevronDownIcon,
  ListIcon,
  PlayIcon,
  PlusIcon,
} from '../../icons';

const PROVIDER_OPTIONS: ProviderId[] = ['freebuff', 'opencode', 'qwen', 'gemini'];
const POLICY_OPTIONS: ApprovalPolicy[] = ['manual', 'allow', 'deny'];
const ROUTING_TOOL_OPTIONS = [
  'workspace-read',
  'workspace-write',
  'shell',
  'network',
  'mcp',
] as const;

type ComposerConfigProps = {
  shellControlsState: ShellControlsState;
  shellPanelsState: ShellPanelsState;
  shellSummaryState: ShellSummaryState;
  hasActiveSession: boolean;
  conversationWorkspace: string;
  activeProviderId: ProviderId;
  activeApprovalPolicy: ApprovalPolicy;
  modeLocked: boolean;
  onPolicyChange: (policy: ApprovalPolicy) => void;
};

export function ComposerConfig({
  shellControlsState,
  shellPanelsState,
  shellSummaryState,
  hasActiveSession,
  conversationWorkspace,
  activeProviderId,
  activeApprovalPolicy,
  modeLocked,
  onPolicyChange,
}: ComposerConfigProps) {
  const composerPlusMenuRef = useRef<HTMLDetailsElement | null>(null);
  const composerProviderMenuRef = useRef<HTMLDetailsElement | null>(null);
  const composerAccessMenuRef = useRef<HTMLDetailsElement | null>(null);
  const providerOptions = PROVIDER_OPTIONS.map((providerId) => ({
    providerId,
    configuration: shellPanelsState.providerRegistry?.providers.find(
      (provider) => provider.providerId === providerId,
    ),
    health: shellPanelsState.providerHealth.find(
      (provider) => provider.providerId === providerId,
    ),
  }));

  function closeComposerPlusMenu() {
    if (composerPlusMenuRef.current) {
      composerPlusMenuRef.current.open = false;
    }
  }

  function closeComposerProviderMenu() {
    if (composerProviderMenuRef.current) {
      composerProviderMenuRef.current.open = false;
    }
  }

  function closeComposerAccessMenu() {
    if (composerAccessMenuRef.current) {
      composerAccessMenuRef.current.open = false;
    }
  }

  return (
    <div className="composer-config-strip">
      <details ref={composerPlusMenuRef} className="composer-plus-menu">
        <summary
          className="composer-plus-trigger"
          title="Thread settings"
          aria-label="Thread settings"
        >
          <PlusIcon size={14} />
        </summary>
        <div className="composer-plus-popover">
          {!hasActiveSession ? (
            <label className="composer-actions-field" htmlFor="composer-workspace-path">
              <span>Workspace</span>
              <input
                id="composer-workspace-path"
                type="text"
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
          ) : (
            <div className="composer-config-note">
              <strong>Thread settings are locked</strong>
              <span>
                This thread is already bound to {shellPanelsState.selectedProviderId ?? 'its provider'} in{' '}
                {conversationWorkspace}.
              </span>
            </div>
          )}

          <div className="tool-requirements composer-tools-popover">
            {ROUTING_TOOL_OPTIONS.map((tool) => (
              <label key={tool}>
                <input
                  type="checkbox"
                  name="routingTool"
                  value={tool}
                  checked={shellControlsState.routingTools.includes(tool)}
                  onChange={(event) => {
                    const nextTools = event.target.checked
                      ? [...shellControlsState.routingTools, tool]
                      : shellControlsState.routingTools.filter(
                          (entry) => entry !== tool,
                        );
                    void requestRoutingToolsDraftChange(nextTools);
                  }}
                />
                {renderRoutingToolLabel(tool)}
              </label>
            ))}
          </div>
          <p className="composer-config-note composer-config-note-muted">
            {hasActiveSession
              ? shellSummaryState.selectedSessionNote
              : shellSummaryState.sessionProviderNote}
          </p>
          <div className="composer-menu-divider" aria-hidden="true"></div>
          <div className="composer-popover-section">
            <span className="composer-popover-label">Advanced</span>
            <button
              id="route-run-button"
              type="button"
              className="secondary-button"
              disabled={shellControlsState.routeRunDisabled}
              onClick={() => {
                closeComposerPlusMenu();
                void requestRoutePrompt();
              }}
            >
              Route Prompt
            </button>
            <label className="composer-actions-field" htmlFor="delegate-role-select">
              <span>Delegate Role</span>
              <select
                id="delegate-role-select"
                className="secondary-select"
                value={shellControlsState.delegateRole}
                onChange={(event) => {
                  void requestDelegateRoleChange(
                    parseDelegateRole(event.target.value),
                  );
                }}
              >
                <option value="planner">Planner</option>
                <option value="researcher">Researcher</option>
                <option value="reviewer">Reviewer</option>
                <option value="verifier">Verifier</option>
              </select>
            </label>
            <div className="composer-popover-actions">
              <button
                id="delegate-run-button"
                type="button"
                className="secondary-button"
                disabled={shellControlsState.delegateRunDisabled}
                onClick={() => {
                  closeComposerPlusMenu();
                  void requestDelegatePrompt();
                }}
              >
                Delegate
              </button>
              <button
                id="handoff-run-button"
                type="button"
                className="secondary-button"
                disabled={shellControlsState.handoffRunDisabled}
                onClick={() => {
                  closeComposerPlusMenu();
                  void requestHandoffPrompt();
                }}
              >
                Handoff
              </button>
            </div>
          </div>
        </div>
      </details>

      <details
        ref={composerProviderMenuRef}
        className="composer-choice-menu"
      >
        <summary className="composer-choice-trigger">
          <span className="composer-choice-value">
            {renderProviderLabel(activeProviderId)}
          </span>
          <span className="composer-choice-caret" aria-hidden="true">
            <ChevronDownIcon size={11} />
          </span>
        </summary>
        <div className="composer-choice-popover">
          {providerOptions.map(({ providerId, configuration, health }) => {
            const selectable = Boolean(configuration?.enabled && health?.available);
            return (
            <button
              key={providerId}
              type="button"
              className={`composer-choice-option${
                activeProviderId === providerId ? ' active' : ''
              }`}
              disabled={!selectable}
              title={health?.detail ?? 'Provider status unavailable'}
              onClick={() => {
                closeComposerProviderMenu();
                void requestSessionDraftChange({ providerId });
              }}
            >
              <span className="composer-provider-option-copy">
                <span>{renderProviderLabel(providerId)}</span>
                <small>
                  {health?.available
                    ? configuration?.accessMode === 'free-cloud'
                      ? 'Free cloud'
                      : configuration?.accessMode === 'local-or-byok'
                        ? 'Local / BYOK'
                        : 'Paid / BYOK'
                    : configuration?.enabled
                      ? 'Setup required'
                      : 'Disabled'}
                </small>
              </span>
              {activeProviderId === providerId ? (
                <span className="composer-choice-check" aria-hidden="true">
                  <CheckIcon size={12} />
                </span>
              ) : null}
            </button>
            );
          })}
        </div>
      </details>

      {modeLocked ? (
        <div className="composer-choice-pill composer-choice-pill-locked">
          <span className="composer-mode-indicator" aria-hidden="true"></span>
          <span className="composer-choice-value">
            {renderAccessLabel(activeApprovalPolicy)}
          </span>
        </div>
      ) : (
        <details
          ref={composerAccessMenuRef}
          className="composer-choice-menu composer-mode-menu"
        >
          <summary
            className="composer-choice-trigger"
            title={
              shellControlsState.runMode === 'plan'
                ? 'Mode: Plan — read-only exploration (Ctrl+Space to cycle)'
                : `Mode: ${renderAccessLabel(activeApprovalPolicy)} — Ctrl+Space to cycle`
            }
          >
            <span
              className={`composer-mode-indicator composer-mode-${
                shellControlsState.runMode === 'plan'
                  ? 'plan'
                  : activeApprovalPolicy
              }`}
              aria-hidden="true"
            ></span>
            <span className="composer-choice-value">
              {shellControlsState.runMode === 'plan'
                ? 'Plan'
                : renderAccessLabel(activeApprovalPolicy)}
            </span>
            <span className="composer-choice-caret" aria-hidden="true">
              <ChevronDownIcon size={11} />
            </span>
          </summary>
          <div className="composer-choice-popover composer-mode-popover">
            <button
              type="button"
              className={`composer-mode-option${
                shellControlsState.runMode === 'plan' ? ' active' : ''
              }`}
              onClick={() => {
                closeComposerAccessMenu();
                void requestRunModeChange('plan');
              }}
              title="Read-only exploration; approve the plan to execute it"
            >
              <div className="composer-mode-text">
                <span className="composer-mode-title">
                  <ListIcon size={14} /> Plan
                </span>
                <span className="composer-mode-desc">
                  Read-only exploration; approve the plan to execute
                </span>
              </div>
              {shellControlsState.runMode === 'plan' ? (
                <span className="composer-choice-check" aria-hidden="true">
                  <CheckIcon size={12} />
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className={`composer-mode-option${
                shellControlsState.runMode === 'execute' ? ' active' : ''
              }`}
              onClick={() => {
                closeComposerAccessMenu();
                void requestRunModeChange('execute');
              }}
              title="Normal execution with the approval policy below"
            >
              <div className="composer-mode-text">
                <span className="composer-mode-title">
                  <PlayIcon size={14} /> Execute
                </span>
                <span className="composer-mode-desc">
                  Normal execution with the access policy below
                </span>
              </div>
              {shellControlsState.runMode === 'execute' ? (
                <span className="composer-choice-check" aria-hidden="true">
                  <CheckIcon size={12} />
                </span>
              ) : null}
            </button>
            <div className="composer-mode-divider" role="separator"></div>
            {POLICY_OPTIONS.map((policy) => (
              <button
                key={policy}
                type="button"
                className={`composer-mode-option${
                  activeApprovalPolicy === policy ? ' active' : ''
                }`}
                onClick={() => {
                  closeComposerAccessMenu();
                  onPolicyChange(policy);
                }}
              >
                <div className="composer-mode-text">
                  <span className="composer-mode-title">
                    {renderAccessLabel(policy)}
                  </span>
                  <span className="composer-mode-desc">
                    {MODE_DESCRIPTIONS[policy]}
                  </span>
                </div>
                {activeApprovalPolicy === policy ? (
                  <span className="composer-choice-check" aria-hidden="true">
                    <CheckIcon size={12} />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
