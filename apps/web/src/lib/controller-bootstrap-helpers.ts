import type {
  WorkbenchSession,
} from '@codewave/protocol';
import { toast } from '../toasts.js';
import type {
  LoadArchive,
  RefreshRecommendation,
  SelectSession,
  TransitionToNewSession,
} from './controller-contracts.js';
import type { ControllerBootstrapState } from './controller-state-slices.js';

type ControllerBootstrapDeps = {
  state: ControllerBootstrapState;
  emitRunViewState: () => void;
  emitShellPanelsState: () => void;
  emitShellSummaryState: () => void;
  syncResumeAction: () => void;
  syncApprovalPolicyControls: () => void;
  syncRouteAction: () => void;
  syncRunAction: () => void;
  syncCancelAction: () => void;
  syncFollowUpActions: () => void;
  closeStream: () => void;
  loadArchive: LoadArchive;
  selectSession: SelectSession;
  refreshRecommendation: RefreshRecommendation;
};

export function createControllerBootstrapHelpers(
  deps: ControllerBootstrapDeps,
) {
  const {
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
    loadArchive,
    selectSession,
    refreshRecommendation,
  } = deps;

  function clearRunSelectionView(title: string) {
    state.selectedRun = null;
    state.events = [];
    state.transcript = null;
    state.contextChars = 0;
    state.undoAvailable = false;
    state.undoDetail = null;
    state.artifacts = [];
    state.approvals = [];
    state.checkpoints = [];
    state.tools = [];
    state.runTitleLabel = title;
    state.runStatusLabel = 'idle';
    state.runStatusClassName = 'status-pill status-idle';
    state.runStateNoteMessage =
      'Start a run to see normalized events, approvals, and artifacts.';
    state.runUpdateFeedbackMessage = null;
    emitRunViewState();
    emitShellPanelsState();
    syncCancelAction();
    syncFollowUpActions();
  }

  function resetRunInspector(title: string) {
    state.runSelectionToken += 1;
    closeStream();
    clearRunSelectionView(title);
    emitRunViewState();
    syncApprovalPolicyControls();
    syncRunAction();
    void refreshRecommendation();
  }

  function setArchiveUnavailableState(_message: string) {
    state.archiveSessions = [];
    state.orchestrationFlows = [];
    emitShellPanelsState();
  }

  function setSessionsUnavailableState(message: string) {
    state.sessions = [];
    state.recentSessionsMessage = message;
    emitShellPanelsState();
  }

  function setToolPlaneUnavailableState(message: string) {
    state.toolPlane = null;
    state.toolPlaneNoteMessage = message;
    emitShellPanelsState();
  }

  function clearSessionSelectionState(
    message: string,
    runTitle = 'No active session',
  ) {
    state.selectedSession = null;
    state.runs = [];
    state.providerSessionLabel = 'unbound';
    resetRunInspector(runTitle);
    syncResumeAction();
    syncApprovalPolicyControls();
    if (message) {
      state.selectedSessionNoteMessage = message;
    }
    emitShellPanelsState();
  }

  function setTransitionSelectionFailure(actionLabel: string) {
    state.recommendation = null;
    state.recommendationRequestToken += 1;
    state.orchestratorNoteMessage =
      `${actionLabel} created a new session, but switching to it failed. Retry when the daemon responds.`;
    toast.warning(
      `${actionLabel} created a new session, but switching to it failed.`,
    );
    emitShellSummaryState();
    syncRouteAction();
  }

  async function transitionToNewSession(
    session: WorkbenchSession,
    actionLabel: string,
  ): ReturnType<TransitionToNewSession> {
    state.sessions.unshift(session);
    state.recentSessionsMessage = null;
    emitShellPanelsState();

    try {
      await loadArchive();
    } catch {}

    const selected = await selectSession(session.id);
    if (selected) {
      return true;
    }

    setTransitionSelectionFailure(actionLabel);
    return false;
  }

  return {
    clearRunSelectionView,
    clearSessionSelectionState,
    setArchiveUnavailableState,
    setSessionsUnavailableState,
    setToolPlaneUnavailableState,
    transitionToNewSession,
  };
}
