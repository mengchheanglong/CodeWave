import type { DaemonApi } from './daemon-api.js';
import { formatToolPlaneSummary } from '../tool-plane.js';
import { formatProviderHealthSummary } from '../shell-status-summary.js';
import type {
  RefreshRecommendation,
  SelectRun,
  TransitionToNewSession,
} from './controller-contracts.js';
import type { ControllerRuntimeSessionState } from './controller-state-slices.js';

type ControllerRuntimeSessionFlowDeps = {
  state: ControllerRuntimeSessionState;
  api: DaemonApi;
  emitRunViewState: () => void;
  emitShellPanelsState: () => void;
  syncResumeAction: () => void;
  syncApprovalPolicyControls: () => void;
  syncFollowUpActions: () => void;
  syncRunAction: () => void;
  syncSessionCreationControls: () => void;
  syncCancelAction: () => void;
  setSessionsUnavailableState: (message: string) => void;
  setArchiveUnavailableState: (message: string) => void;
  setToolPlaneUnavailableState: (message: string) => void;
  clearSessionSelectionState: (message: string, runTitle?: string) => void;
  clearRunSelectionView: (title: string) => void;
  closeStream: () => void;
  refreshRecommendation: RefreshRecommendation;
  selectRun: SelectRun;
  transitionToNewSession: TransitionToNewSession;
};

export function createControllerRuntimeSessionFlows(
  deps: ControllerRuntimeSessionFlowDeps,
) {
  const {
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
    refreshRecommendation,
    selectRun,
    transitionToNewSession,
  } = deps;

  function requireProviderRevision(): string {
    const revision = state.runtime?.providerRegistry.revision;
    if (!revision) {
      throw new Error(
        'Provider policy is unavailable. Refresh the runtime, review the provider settings, and retry.',
      );
    }
    return revision;
  }

  async function loadToolPlane(workspacePath?: string) {
    const requestToken = state.toolPlaneRequestToken + 1;
    state.toolPlaneRequestToken = requestToken;
    const requestSessionId = state.selectedSession?.id || null;
    let response;
    try {
      response = await api.getToolPlane({
        workspacePath,
        sessionId: requestSessionId ?? undefined,
      });
    } catch {
      if (
        requestToken !== state.toolPlaneRequestToken ||
        (state.selectedSession?.id || null) !== requestSessionId
      ) {
        return;
      }

      setToolPlaneUnavailableState(
        'Tool plane unavailable. Showing no registration evidence until refresh succeeds.',
      );
      return;
    }

    if (
      requestToken !== state.toolPlaneRequestToken ||
      (state.selectedSession?.id || null) !== requestSessionId
    ) {
      return;
    }

    state.toolPlane = response.snapshot;
    state.toolPlaneNoteMessage = formatToolPlaneSummary(state.toolPlane);
    emitShellPanelsState();
  }

  async function loadArchive() {
    let archiveSnapshot;
    let boardSnapshot;

    try {
      [archiveSnapshot, boardSnapshot] = await Promise.all([
        api.getArchive(),
        api.getOrchestrationBoard(),
      ]);
    } catch {
      setArchiveUnavailableState(
        'Archive data is temporarily unavailable. Retry after the daemon responds.',
      );
      throw new Error('Archive refresh failed.');
    }

    state.archiveSessions = archiveSnapshot.sessions;
    state.orchestrationFlows = boardSnapshot.flows;
    emitShellPanelsState();
  }

  async function selectSession(sessionId: string) {
    const selectionToken = state.sessionSelectionToken + 1;
    state.sessionSelectionToken = selectionToken;
    state.runSelectionToken += 1;
    closeStream();

    let snapshot;
    try {
      snapshot = await api.getSession(sessionId);
    } catch {
      if (selectionToken !== state.sessionSelectionToken) {
        return false;
      }

      clearSessionSelectionState(
        'Session selection failed and the prior selection was cleared to avoid stale details.',
        'Session selection unavailable',
      );
      setToolPlaneUnavailableState(
        'Tool plane unavailable after failed session selection. Retry once the daemon responds.',
      );
      setArchiveUnavailableState(
        'Archive data is temporarily unavailable after failed session selection.',
      );
      emitShellPanelsState();
      return false;
    }

    if (selectionToken !== state.sessionSelectionToken) {
      return false;
    }

    state.selectedSession = snapshot.session;
    state.runs = snapshot.runs;
    state.workspacePathDraft = snapshot.session.workspacePath;
    state.providerSessionLabel = snapshot.session.providerSessionId || 'unbound';
    clearRunSelectionView(`Session ${snapshot.session.id.slice(0, 8)}`);

    await loadToolPlane(snapshot.session.workspacePath);
    if (selectionToken !== state.sessionSelectionToken) {
      return false;
    }

    state.sessions = state.sessions.map((session) =>
      session.id === snapshot.session.id ? snapshot.session : session,
    );
    state.recentSessionsMessage = null;
    emitRunViewState();
    emitShellPanelsState();
    syncResumeAction();
    syncApprovalPolicyControls();
    syncFollowUpActions();
    syncRunAction();
    await refreshRecommendation();
    if (selectionToken !== state.sessionSelectionToken) {
      return false;
    }

    if (snapshot.runs.length > 0) {
      await selectRun(snapshot.runs[0].id);
      return state.selectedSession?.id === sessionId;
    }

    return true;
  }

  async function loadRuntime() {
    let runtimeSnapshot;
    try {
      runtimeSnapshot = await api.getRuntime();
    } catch {
      state.runtime = null;
      state.providerHealthMessage =
        'Runtime is temporarily unavailable. Retry when the daemon responds.';
      state.dataDirectoryLabel = 'unavailable';
      clearSessionSelectionState(
        'Runtime unavailable. Session selection was cleared to prevent stale panes.',
        'Runtime unavailable',
      );
      setSessionsUnavailableState(
        'Session data is temporarily unavailable until runtime bootstrap succeeds.',
      );
      setToolPlaneUnavailableState(
        'Tool plane unavailable until runtime bootstrap succeeds.',
      );
      setArchiveUnavailableState(
        'Archive data is temporarily unavailable until runtime bootstrap succeeds.',
      );
      syncSessionCreationControls();
      syncApprovalPolicyControls();
      syncRunAction();
      return;
    }

    state.runtime = runtimeSnapshot;
    state.workspacePathDraft = state.runtime.defaultWorkspacePath;
    const draftedProviderReady = state.runtime.providers.some(
      (provider) =>
        provider.providerId === state.providerIdDraft && provider.available,
    );
    if (!draftedProviderReady) {
      state.providerIdDraft = state.runtime.recommendedProviderId;
      try {
        if (typeof window === 'undefined') {
          throw new Error('localStorage unavailable');
        }
        window.localStorage.setItem(
          'codewave.preferred_provider',
          state.providerIdDraft,
        );
      } catch {}
    }
    state.dataDirectoryLabel = state.runtime.dataDirectory;
    state.providerHealthMessage = formatProviderHealthSummary(
      state.runtime.providers,
    );
    syncSessionCreationControls();
    syncApprovalPolicyControls();
    syncRunAction();
    emitShellPanelsState();
    await loadToolPlane(state.runtime.defaultWorkspacePath);
    await refreshRecommendation();
  }

  async function loadSessions() {
    let sessionsSnapshot;
    try {
      sessionsSnapshot = await api.getSessions();
    } catch {
      clearSessionSelectionState(
        'Session data is temporarily unavailable. Selection was cleared to avoid stale state.',
        'Session data unavailable',
      );
      setSessionsUnavailableState(
        'Session list is temporarily unavailable. Retry when the daemon responds.',
      );
      setToolPlaneUnavailableState(
        'Tool plane unavailable while session data is unavailable.',
      );
      setArchiveUnavailableState(
        'Archive data is temporarily unavailable while session data is unavailable.',
      );
      return;
    }

    state.sessions = sessionsSnapshot;
    state.recentSessionsMessage = null;
    emitRunViewState();
    emitShellPanelsState();
    syncResumeAction();
    syncApprovalPolicyControls();
    syncCancelAction();
    syncFollowUpActions();
    syncRunAction();
    await refreshRecommendation();

    if (state.sessions.length > 0 && !state.selectedSession) {
      await selectSession(state.sessions[0].id);
    }
  }

  async function recoverSelectedSession() {
    if (!state.selectedSession?.providerSessionId) {
      return;
    }

    const response = await api.recoverSession(state.selectedSession.id, {
      expectedProviderRevision: requireProviderRevision(),
    });

    await transitionToNewSession(response.session, 'Session recovery');
  }

  async function recoverFromCheckpoint(checkpointId: string) {
    const response = await api.recoverCheckpointSession(checkpointId, {
      expectedProviderRevision: requireProviderRevision(),
    });

    await transitionToNewSession(response.session, 'Checkpoint recovery');
  }

  async function deleteSession(sessionId: string) {
    const deletingSelectedSession = state.selectedSession?.id === sessionId;
    await api.deleteSession(sessionId);

    if (deletingSelectedSession) {
      clearSessionSelectionState('Thread deleted.', 'No active thread');
      setToolPlaneUnavailableState(
        'Tool plane unavailable until you select or create a thread.',
      );
    }

    await loadSessions();
    try {
      await loadArchive();
    } catch {}

    if (!state.selectedSession) {
      await refreshRecommendation();
    }
  }

  return {
    deleteSession,
    loadArchive,
    loadRuntime,
    loadSessions,
    loadToolPlane,
    recoverFromCheckpoint,
    recoverSelectedSession,
    selectSession,
  };
}
