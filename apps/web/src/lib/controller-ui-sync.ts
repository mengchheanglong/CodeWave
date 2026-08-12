import type {
  ProviderCapabilities,
  ProviderHealth,
  ProviderId,
} from '@codewave/protocol';
import {
  buildSelectedSessionNote,
  buildSessionProviderNote,
} from '../shell-status-summary.js';
import type { ControllerUiSyncState } from './controller-state-slices.js';

type ControllerUiSyncDeps = {
  state: ControllerUiSyncState;
  emitShellControlsState: () => void;
  emitShellSummaryState: () => void;
  getSelectedPrompt: () => string;
};

export function createControllerUiSync(deps: ControllerUiSyncDeps) {
  const { state, emitShellControlsState, emitShellSummaryState, getSelectedPrompt } =
    deps;

  function getProviderHealth(providerId: ProviderId): ProviderHealth | null {
    return (
      state.runtime?.providers.find(
        (provider) => provider.providerId === providerId,
      ) || null
    );
  }

  function getProviderCapabilities(providerId: ProviderId): ProviderCapabilities {
    return (
      getProviderHealth(providerId)?.capabilities || {
        daemonApprovalMediation: false,
        resumableSessions: false,
        checkpointEvents: false,
        inFlightSteering: 'unsupported',
      }
    );
  }

  function syncRouteAction() {
    const workspacePath =
      state.selectedSession?.workspacePath ?? state.workspacePathDraft;
    const availableProviders =
      state.runtime?.providers.filter((provider) => provider.available)
        .length || 0;
    state.routeRunDisabled =
      !workspacePath.trim() || !getSelectedPrompt() || availableProviders === 0;
    const canFork =
      state.selectedRun?.status === 'completed' &&
      Boolean(getSelectedPrompt()) &&
      availableProviders > 0;
    state.delegateRunDisabled = !canFork;
    state.handoffRunDisabled = !canFork;
    emitShellControlsState();
  }

  function syncResumeAction() {
    if (!state.selectedSession) {
      state.resumeSessionDisabled = true;
      emitShellControlsState();
      return;
    }

    const capabilities = getProviderCapabilities(state.selectedSession.providerId);
    state.resumeSessionDisabled =
      !capabilities.resumableSessions || !state.selectedSession.providerSessionId;
    emitShellControlsState();
  }

  function syncSessionCreationControls() {
    const providerId = state.providerIdDraft;
    const capabilities = getProviderCapabilities(providerId);

    if (!capabilities.daemonApprovalMediation) {
      state.sessionApprovalPolicyDraft = 'manual';
      state.sessionApprovalPolicyDraftDisabled = true;
    } else {
      state.sessionApprovalPolicyDraftDisabled = false;
    }

    state.sessionProviderNoteMessage = buildSessionProviderNote({
      selectedSession: state.selectedSession,
      providerId,
      capabilities,
    });
    emitShellControlsState();
    emitShellSummaryState();
  }

  function syncApprovalPolicyControls() {
    if (!state.selectedSession) {
      state.selectedSessionApprovalPolicyDraft = 'manual';
      state.selectedSessionApprovalPolicyDraftDisabled = true;
      state.applySelectedSessionPolicyDisabled = true;
      state.selectedSessionNoteMessage =
        'Select a session to inspect provider-specific controls.';
      emitShellControlsState();
      emitShellSummaryState();
      return;
    }

    const capabilities = getProviderCapabilities(state.selectedSession.providerId);
    state.selectedSessionApprovalPolicyDraft =
      state.selectedSession.approvalPolicy;
    state.selectedSessionApprovalPolicyDraftDisabled =
      !capabilities.daemonApprovalMediation;
    state.applySelectedSessionPolicyDisabled =
      !capabilities.daemonApprovalMediation ||
      state.selectedSessionApprovalPolicyDraft ===
        state.selectedSession.approvalPolicy;

    const provider = getProviderHealth(state.selectedSession.providerId);
    state.selectedSessionNoteMessage = buildSelectedSessionNote({
      session: state.selectedSession,
      capabilities,
      providerUnavailableDetail:
        provider?.available === false ? provider.detail : null,
    });
    emitShellControlsState();
    emitShellSummaryState();
  }

  function syncCancelAction() {
    const status = state.selectedRun?.status;
    state.cancelRunDisabled =
      !status || !['running', 'awaiting_approval'].includes(status);
    emitShellControlsState();
  }

  function syncFollowUpActions() {
    const enabled = state.selectedRun?.status === 'completed';
    state.reviewRunDisabled = !enabled;
    state.verifyRunDisabled = !enabled;
    emitShellControlsState();
  }

  function syncRunAction() {
    const providerId = state.selectedSession?.providerId ?? state.providerIdDraft;
    const workspacePath =
      state.selectedSession?.workspacePath ?? state.workspacePathDraft;
    const provider = getProviderHealth(providerId);
    const available = provider?.available ?? false;
    state.startRunDisabled =
      !available || !workspacePath.trim() || !getSelectedPrompt();
    state.promptDraftDisabled = !available;
    syncRouteAction();
    emitShellControlsState();
  }

  return {
    getProviderCapabilities,
    getProviderHealth,
    syncApprovalPolicyControls,
    syncCancelAction,
    syncFollowUpActions,
    syncResumeAction,
    syncRouteAction,
    syncRunAction,
    syncSessionCreationControls,
  };
}
