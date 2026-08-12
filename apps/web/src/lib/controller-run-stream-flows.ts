import type {
  RunSnapshot,
  WorkbenchEvent,
} from '@qwemini/protocol';
import type { DaemonApi } from './daemon-api.js';
import { notifyAttention } from './attention-notifications.js';
import { buildRunPresentation } from '../shell-status-summary.js';
import type {
  LoadArchive,
  RefreshRecommendation,
} from './controller-contracts.js';
import type { ControllerRunStreamState } from './controller-state-slices.js';

type ControllerRunStreamFlowDeps = {
  state: ControllerRunStreamState;
  api: DaemonApi;
  emitRunViewState: () => void;
  emitShellPanelsState: () => void;
  emitShellSummaryState: () => void;
  syncCancelAction: () => void;
  syncFollowUpActions: () => void;
  syncRunAction: () => void;
  syncResumeAction: () => void;
  syncApprovalPolicyControls: () => void;
  clearRunSelectionView: (title: string) => void;
  closeStream: () => void;
  loadArchive: LoadArchive;
  refreshRecommendation: RefreshRecommendation;
};

export function createControllerRunStreamFlows(
  deps: ControllerRunStreamFlowDeps,
) {
  const {
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
    loadArchive,
    refreshRecommendation,
  } = deps;

  function setRunRefreshWarning(message: string, closeActiveStream = false) {
    if (!state.selectedRun) {
      return;
    }

    state.runStateNoteMessage = message;
    emitShellSummaryState();
    if (closeActiveStream) {
      closeStream();
    }
  }

  function applyRunSnapshot(snapshot: RunSnapshot) {
    if (!snapshot || !snapshot.run || typeof snapshot.run.id !== 'string') {
      return;
    }

    state.selectedRun = snapshot.run;
    state.events = snapshot.events;
    state.contextChars = snapshot.contextChars ?? 0;
    state.undoAvailable = Boolean(snapshot.undo?.available);
    state.undoDetail = snapshot.undo?.detail ?? null;
    state.artifacts = snapshot.artifacts;
    state.approvals = snapshot.approvals;
    state.checkpoints = snapshot.checkpoints;
    state.tools = snapshot.toolInvocations;
    state.runTitleLabel = `Run ${snapshot.run.id.slice(0, 8)}`;
    const runPresentation = buildRunPresentation({
      run: snapshot.run,
      approvals: state.approvals,
    });
    state.runStatusLabel = runPresentation.statusLabel;
    state.runStatusClassName = runPresentation.statusClassName;
    state.runStateNoteMessage = runPresentation.stateNote;
    emitRunViewState();
    emitShellPanelsState();
    syncCancelAction();
    syncFollowUpActions();
    syncRunAction();
  }

  async function refreshRun(runId: string) {
    const selectionToken = state.runSelectionToken;
    let snapshot;
    try {
      snapshot = await api.getRun(runId);
    } catch {
      if (
        selectionToken === state.runSelectionToken &&
        state.selectedRun?.id === runId
      ) {
        setRunRefreshWarning(
          'Run refresh failed. Showing the last known snapshot until the daemon responds again.',
        );
      }
      return;
    }

    if (
      selectionToken !== state.runSelectionToken ||
      state.selectedRun?.id !== runId
    ) {
      return;
    }

    applyRunSnapshot(snapshot);

    if (state.selectedSession) {
      const selectedSessionId = state.selectedSession.id;
      let sessionSnapshot;
      try {
        sessionSnapshot = await api.getSession(selectedSessionId);
      } catch {
        if (
          selectionToken === state.runSelectionToken &&
          state.selectedRun?.id === runId &&
          state.selectedSession?.id === selectedSessionId
        ) {
          setRunRefreshWarning(
            'Run updated, but session metadata refresh failed. Showing the last known session summary.',
          );
        }
        return;
      }

      if (
        selectionToken !== state.runSelectionToken ||
        state.selectedRun?.id !== runId ||
        state.selectedSession?.id !== selectedSessionId
      ) {
        return;
      }

      state.selectedSession = sessionSnapshot.session;
      state.runs = sessionSnapshot.runs;
      state.providerSessionLabel = sessionSnapshot.session.providerSessionId || 'unbound';
      state.sessions = state.sessions.map((session) =>
        session.id === sessionSnapshot.session.id ? sessionSnapshot.session : session,
      );
      state.recentSessionsMessage = null;
      emitRunViewState();
      emitShellPanelsState();
      syncResumeAction();
      syncApprovalPolicyControls();
      syncRunAction();
    }

    try {
      await loadArchive();
    } catch {
      if (
        selectionToken === state.runSelectionToken &&
        state.selectedRun?.id === runId
      ) {
        setRunRefreshWarning(
          'Run updated, but archive refresh failed. Archive panes were cleared to avoid stale summaries.',
        );
      }
    }

    await refreshRecommendation();
  }

  async function selectRun(runId: string) {
    const selectionToken = state.runSelectionToken + 1;
    state.runSelectionToken = selectionToken;
    closeStream();
    let snapshot;
    try {
      snapshot = await api.getRun(runId);
    } catch {
      if (selectionToken !== state.runSelectionToken) {
        return;
      }

      clearRunSelectionView(`Run ${runId.slice(0, 8)} unavailable`);
      state.runStateNoteMessage =
        'Run details are temporarily unavailable. Select the run again after the daemon reconnects.';
      emitShellSummaryState();
      return;
    }

    if (selectionToken !== state.runSelectionToken) {
      return;
    }

    applyRunSnapshot(snapshot);
    if (state.selectedRun?.id !== runId) {
      return;
    }

    const eventSource = new EventSource(`/api/runs/${runId}/stream`);
    eventSource.onmessage = (message) => {
      if (
        selectionToken !== state.runSelectionToken ||
        state.selectedRun?.id !== runId
      ) {
        eventSource.close();
        return;
      }

      let event: WorkbenchEvent;
      try {
        event = JSON.parse(message.data) as WorkbenchEvent;
      } catch {
        return;
      }

      state.events.push(event);

      if (event.type === 'approval.requested') {
        const toolName =
          typeof event.payload.toolName === 'string' ? event.payload.toolName : 'tool';
        notifyAttention('approval', `${toolName} is waiting for your decision.`);
      } else if (event.type === 'run.completed') {
        notifyAttention('run-completed', 'The run finished. Review the result.');
      } else if (event.type === 'run.failed') {
        notifyAttention('run-failed', 'The run failed. Check the transcript.');
      }

      if (
        event.type.startsWith('tool.') ||
        event.type.startsWith('approval.') ||
        event.type === 'checkpoint.saved' ||
        event.type === 'artifact.created' ||
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled'
      ) {
        void refreshRun(runId).catch(() => {});
        return;
      }

      emitRunViewState();
    };

    eventSource.onerror = () => {
      if (
        selectionToken === state.runSelectionToken &&
        state.selectedRun?.id === runId
      ) {
        setRunRefreshWarning(
          'Live stream disconnected. Showing the last known run snapshot until refresh succeeds.',
        );
      }

      if (state.eventSource === eventSource) {
        state.eventSource = null;
      }
      eventSource.close();
    };

    if (selectionToken !== state.runSelectionToken) {
      eventSource.close();
      return;
    }

    state.eventSource = eventSource;
  }

  return {
    applyRunSnapshot,
    refreshRun,
    selectRun,
  };
}
