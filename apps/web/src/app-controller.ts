import {
  mountToastContainer,
  toast,
} from './toasts.js';
import {
  buildRunViewState,
  buildShellPanelsState,
} from './lib/controller-state-mappers.js';
import { createDaemonApi } from './lib/daemon-api.js';
import { createControllerRuntimeSessionFlows } from './lib/controller-runtime-session-flows.js';
import { createControllerRunActionFlows } from './lib/controller-run-action-flows.js';
import { createControllerRunStreamFlows } from './lib/controller-run-stream-flows.js';
import { createControllerUiSync } from './lib/controller-ui-sync.js';
import { createControllerRequesters } from './lib/controller-requesters.js';
import {
  createInitialShellState,
  type ShellState,
} from './lib/controller-shell-state.js';
import {
  emitRunViewState as publishRunViewState,
  emitShellControlsState as publishShellControlsState,
  emitShellPanelsState as publishShellPanelsState,
  emitShellSummaryState as publishShellSummaryState,
  setControllerRequesters,
} from './lib/controller-bridge.js';
import { createControllerBootstrapHelpers } from './lib/controller-bootstrap-helpers.js';
import {
  startDaemonHeartbeat,
  subscribeDaemonHeartbeat,
  getDaemonConnectionState,
} from './lib/daemon-heartbeat.js';

export {
  requestApprovalResolution,
  requestApplySelectedSessionPolicy,
  requestCancelSelectedRun,
  requestCheckpointRecovery,
  requestCreateSession,
  requestDelegatePrompt,
  requestDelegateRoleChange,
  requestExecutePlan,
  requestFollowUpRun,
  requestHandoffPrompt,
  requestPromptDraftChange,
  requestRecoverSelectedSession,
  requestSessionDelete,
  requestRoutePrompt,
  requestRoutingToolsDraftChange,
  requestRunModeChange,
  requestRunSelection,
  requestRuntimeRefresh,
  requestSelectedSessionPolicyDraftChange,
  requestSessionDraftChange,
  requestSessionSelection,
  requestStartRun,
  requestUndoRun,
  requestWorkspaceDraftCommit,
  subscribeRunViewState,
  subscribeShellControlsState,
  subscribeShellPanelsState,
  subscribeShellSummaryState,
} from './lib/controller-bridge.js';

let initialized = false;

export async function initializeShell() {
  if (initialized) {
    return;
  }

  initialized = true;

  const state: ShellState = createInitialShellState();

  const toastContainer = document.querySelector(
    '#toast-container',
  ) as HTMLDivElement;

  mountToastContainer(toastContainer);
  let refreshRuntimeAfterProviderConflict: (() => Promise<void>) | null = null;
  const api = createDaemonApi({
    onError: (message) => {
      toast.error(message);
    },
    onProviderRevisionConflict: async () => {
      await refreshRuntimeAfterProviderConflict?.();
    },
  });

function getSelectedPrompt() {
  return state.promptDraft.trim();
}

function getSelectedWorkspacePath() {
  return state.selectedSession?.workspacePath || state.workspacePathDraft.trim();
}

function getPreferredProviderId() {
  return state.selectedSession?.providerId || state.providerIdDraft;
}

function getRouteApprovalPolicy() {
  return state.selectedSession?.approvalPolicy || state.sessionApprovalPolicyDraft;
}

function getRequiredTools() {
  return [...state.routingToolsDraft];
}

function closeStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function emitRunViewState() {
  publishRunViewState(
    buildRunViewState({
      selectedSessionId: state.selectedSession?.id ?? null,
      runs: state.runs,
      selectedRun: state.selectedRun,
      events: state.events,
      transcript: state.transcript,
      contextChars: state.contextChars,
      undoAvailable: state.undoAvailable,
      undoDetail: state.undoDetail,
    }),
  );
}

function emitShellPanelsState() {
  publishShellPanelsState(
    buildShellPanelsState({
      selectedSessionId: state.selectedSession?.id ?? null,
      selectedProviderId: state.selectedSession?.providerId ?? null,
      selectedSessionCapabilities: state.selectedSession
        ? getProviderCapabilities(state.selectedSession.providerId)
        : null,
      runtime: state.runtime,
      recentSessions: state.sessions,
      recentSessionsMessage: state.recentSessionsMessage,
      archiveSessions: state.archiveSessions,
      orchestrationFlows: state.orchestrationFlows,
      checkpoints: state.checkpoints,
      approvals: state.approvals,
      artifacts: state.artifacts,
      tools: state.tools,
      toolPlane: state.toolPlane,
    }),
  );
  emitShellSummaryState();
}

function emitShellSummaryState() {
  const connState = getDaemonConnectionState();
  publishShellSummaryState({
    providerHealth: state.providerHealthMessage,
    providerSession: state.providerSessionLabel,
    dataDirectory: state.dataDirectoryLabel,
    toolPlaneNote: state.toolPlaneNoteMessage,
    sessionProviderNote: state.sessionProviderNoteMessage,
    selectedSessionNote: state.selectedSessionNoteMessage,
    runTitle: state.runTitleLabel,
    runStatusLabel: state.runStatusLabel,
    runStatusClassName: state.runStatusClassName,
    runStateNote: state.runStateNoteMessage,
    runUpdateFeedback: state.runUpdateFeedbackMessage,
    orchestratorNote: state.orchestratorNoteMessage,
    daemonConnectionLabel: connState.status,
  });

  // Update the menu bar connection indicator
  const connEl = document.querySelector('#daemon-connection-indicator') as HTMLElement | null;
  if (connEl) {
    connEl.className = `app-menu-status daemon-conn-${connState.status}`;
    if (connState.status === 'connected') {
      connEl.textContent = 'daemon';
      connEl.title = 'Daemon connected';
    } else if (connState.status === 'connecting') {
      connEl.textContent = 'connecting…';
      connEl.title = 'Connecting to daemon…';
    } else {
      connEl.textContent = 'offline';
      connEl.title = `Daemon disconnected (attempt ${connState.attempts})`;
    }
  }
}

function emitShellControlsState() {
  publishShellControlsState({
    workspacePath: state.workspacePathDraft,
    providerId: state.providerIdDraft,
    sessionApprovalPolicy: state.sessionApprovalPolicyDraft,
    sessionApprovalPolicyDisabled: state.sessionApprovalPolicyDraftDisabled,
    runMode: state.runModeDraft,
    prompt: state.promptDraft,
    promptDisabled: state.promptDraftDisabled,
    routingTools: [...state.routingToolsDraft],
    delegateRole: state.delegateRoleDraft,
    selectedSessionApprovalPolicy: state.selectedSessionApprovalPolicyDraft,
    selectedSessionApprovalPolicyDisabled:
      state.selectedSessionApprovalPolicyDraftDisabled,
    applySelectedSessionPolicyDisabled: state.applySelectedSessionPolicyDisabled,
    startRunDisabled: state.startRunDisabled,
    routeRunDisabled: state.routeRunDisabled,
    delegateRunDisabled: state.delegateRunDisabled,
    handoffRunDisabled: state.handoffRunDisabled,
    resumeSessionDisabled: state.resumeSessionDisabled,
    cancelRunDisabled: state.cancelRunDisabled,
    reviewRunDisabled: state.reviewRunDisabled,
    verifyRunDisabled: state.verifyRunDisabled,
  });
}

const {
  getProviderCapabilities,
  syncApprovalPolicyControls,
  syncCancelAction,
  syncFollowUpActions,
  syncResumeAction,
  syncRouteAction,
  syncRunAction,
  syncSessionCreationControls,
} = createControllerUiSync({
  state,
  emitShellControlsState,
  emitShellSummaryState,
  getSelectedPrompt,
});

const {
  clearRunSelectionView,
  clearSessionSelectionState,
  resetRunInspector,
  setArchiveUnavailableState,
  setSessionsUnavailableState,
  setToolPlaneUnavailableState,
  transitionToNewSession,
} = createControllerBootstrapHelpers({
  state,
  emitRunViewState,
  emitShellPanelsState,
  emitShellSummaryState,
  syncResumeAction,
  syncApprovalPolicyControls,
  syncRouteAction,
  syncRunAction,
  syncCancelAction,
  syncFollowUpActions,
  closeStream,
  loadArchive: () => loadArchive(),
  selectSession: (sessionId) => selectSession(sessionId),
  refreshRecommendation: () => refreshRecommendation(),
});

const {
  applyRunSnapshot,
  refreshRun,
  selectRun,
} = createControllerRunStreamFlows({
  state,
  api,
  emitRunViewState,
  emitShellPanelsState,
  emitShellSummaryState,
  syncCancelAction,
  syncFollowUpActions,
  syncRunAction,
  syncResumeAction,
  syncApprovalPolicyControls,
  clearRunSelectionView,
  closeStream,
  loadArchive: () => loadArchive(),
  refreshRecommendation: () => refreshRecommendation(),
});

const {
  deleteSession,
  loadArchive,
  loadRuntime,
  loadSessions,
  loadToolPlane,
  recoverFromCheckpoint,
  recoverSelectedSession,
  selectSession,
} = createControllerRuntimeSessionFlows({
  state,
  api,
  emitRunViewState,
  emitShellPanelsState,
  syncResumeAction,
  syncApprovalPolicyControls,
  syncFollowUpActions,
  syncRunAction,
  syncSessionCreationControls,
  syncCancelAction,
  setSessionsUnavailableState,
  setArchiveUnavailableState,
  setToolPlaneUnavailableState,
  clearSessionSelectionState,
  clearRunSelectionView,
  closeStream,
  refreshRecommendation: () => refreshRecommendation(),
  selectRun,
  transitionToNewSession,
});
refreshRuntimeAfterProviderConflict = loadRuntime;

const {
  cancelSelectedRun,
  createFollowUpRun,
  createSession,
  delegatePrompt,
  executePlanRun,
  handoffPrompt,
  refreshRecommendation,
  resolveApproval,
  routePrompt,
  startRun,
  undoSelectedRun,
  updateRunMode,
  updateSelectedSessionPolicy,
  updateSelectedSessionPolicyDraft,
} = createControllerRunActionFlows({
  state,
  api,
  emitRunViewState,
  emitShellPanelsState,
  emitShellSummaryState,
  emitShellControlsState,
  syncRouteAction,
  syncResumeAction,
  syncApprovalPolicyControls,
  loadArchive,
  selectRun,
  refreshRun,
  transitionToNewSession,
  applyRunSnapshot,
  getSelectedPrompt,
  getSelectedWorkspacePath,
  getPreferredProviderId,
  getRouteApprovalPolicy,
  getRequiredTools,
});

setControllerRequesters(createControllerRequesters({
  state,
  api,
  emitShellControlsState,
  syncSessionCreationControls,
  syncRunAction,
  syncRouteAction,
  loadToolPlane,
  refreshRecommendation,
  selectRun,
  selectSession,
  recoverFromCheckpoint,
  recoverSelectedSession,
  deleteSession,
  resolveApproval,
  updateSelectedSessionPolicyDraft,
  createSession,
  startRun,
  routePrompt,
  delegatePrompt,
  handoffPrompt,
  updateSelectedSessionPolicy,
  cancelSelectedRun,
  createFollowUpRun,
  executePlanRun,
  undoSelectedRun,
  updateRunMode,
  refreshRuntime: loadRuntime,
}));

emitRunViewState();
emitShellPanelsState();
emitShellControlsState();
await loadRuntime().catch(() => {});
await loadArchive().catch(() => {});
await loadSessions().catch(() => {});

// Start daemon heartbeat for connection monitoring
subscribeDaemonHeartbeat(() => {
  emitShellSummaryState();
});
startDaemonHeartbeat();
}
