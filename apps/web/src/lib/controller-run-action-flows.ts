import type {
  ApprovalPolicy,
  OrchestrationRole,
  ProviderId,
  RoutingToolRequirement,
  RunMode,
  RunSnapshot,
} from '@codewave/protocol';
import { isRoutingToolRequirement } from '@codewave/protocol';
import type { DaemonApi } from './daemon-api.js';
import { formatRecommendation } from '../shell-status-summary.js';
import type { DelegateRole, FollowUpKind } from './shell-controls-state.js';
import type {
  ApprovalDecision,
  LoadArchive,
  RefreshRun,
  SelectRun,
  TransitionToNewSession,
} from './controller-contracts.js';
import type { ControllerRunActionState } from './controller-state-slices.js';

type ControllerRunActionFlowDeps = {
  state: ControllerRunActionState;
  api: DaemonApi;
  emitRunViewState: () => void;
  emitShellPanelsState: () => void;
  emitShellSummaryState: () => void;
  emitShellControlsState: () => void;
  syncRouteAction: () => void;
  syncResumeAction: () => void;
  syncApprovalPolicyControls: () => void;
  loadArchive: LoadArchive;
  selectRun: SelectRun;
  refreshRun: RefreshRun;
  transitionToNewSession: TransitionToNewSession;
  applyRunSnapshot: (snapshot: RunSnapshot) => void;
  getSelectedPrompt: () => string;
  getSelectedWorkspacePath: () => string;
  getPreferredProviderId: () => ProviderId;
  getRouteApprovalPolicy: () => ApprovalPolicy;
  getRequiredTools: () => RoutingToolRequirement[];
};

export function createControllerRunActionFlows(
  deps: ControllerRunActionFlowDeps,
) {
  const {
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
  } = deps;

  function toApprovalPolicy(value: ApprovalPolicy): ApprovalPolicy {
    return value === 'allow' || value === 'deny' ? value : 'manual';
  }

  function toDelegateRole(
    value: DelegateRole,
  ): Exclude<OrchestrationRole, 'main'> {
    return value === 'reviewer' ||
      value === 'verifier' ||
      value === 'researcher'
      ? value
      : 'planner';
  }

  function toRoutingToolRequirements(
    values: RoutingToolRequirement[],
  ): RoutingToolRequirement[] {
    return values.filter((value): value is RoutingToolRequirement =>
      isRoutingToolRequirement(value),
    );
  }

  function requireProviderRevision(): string {
    const revision = state.runtime?.providerRegistry.revision;
    if (!revision) {
      throw new Error(
        'Provider policy is unavailable. Refresh the runtime, review the provider settings, and retry.',
      );
    }
    return revision;
  }

  async function refreshRecommendation() {
    const requestToken = state.recommendationRequestToken + 1;
    state.recommendationRequestToken = requestToken;
    const sessionId = state.selectedSession?.id ?? null;
    const workspacePath = getSelectedWorkspacePath();

    if (!sessionId && !workspacePath) {
      if (requestToken !== state.recommendationRequestToken) {
        return;
      }

      state.recommendation = null;
      state.orchestratorNoteMessage =
        'Choose a workspace path and enter a prompt to preview daemon-owned provider routing.';
      emitShellSummaryState();
      syncRouteAction();
      return;
    }

    const prompt = getSelectedPrompt();
    if (!prompt) {
      if (requestToken !== state.recommendationRequestToken) {
        return;
      }

      state.recommendation = null;
      state.orchestratorNoteMessage =
        'Enter a prompt to preview provider routing before creating a routed session.';
      emitShellSummaryState();
      syncRouteAction();
      return;
    }

    const preferredProviderId = getPreferredProviderId();
    const requiredTools = getRequiredTools();

    try {
      const response = await api.recommendPrompt({
        prompt,
        workspacePath,
        sessionId,
        preferredProviderId,
        requiredTools: toRoutingToolRequirements(requiredTools),
      });

      if (
        requestToken !== state.recommendationRequestToken ||
        (state.selectedSession?.id ?? null) !== sessionId ||
        getSelectedPrompt() !== prompt
      ) {
        return;
      }

      state.recommendation = response.recommendation;
      state.orchestratorNoteMessage = formatRecommendation(response.recommendation);
      emitShellSummaryState();
    } catch {}

    if (requestToken !== state.recommendationRequestToken) {
      return;
    }

    syncRouteAction();
  }

  async function createSession() {
    const workspacePath = state.workspacePathDraft.trim();
    if (!workspacePath) {
      return null;
    }

    const payload = {
      workspacePath,
      providerId: state.providerIdDraft,
      expectedProviderRevision: requireProviderRevision(),
      approvalPolicy: toApprovalPolicy(state.sessionApprovalPolicyDraft),
    };

    const session = await api.createSession(payload);

    await transitionToNewSession(session, 'Session creation');
    return session;
  }

  async function startRun() {
    const prompt = state.promptDraft.trim();
    if (!prompt) {
      return;
    }

    if (
      state.selectedRun &&
      ['queued', 'running', 'awaiting_approval'].includes(state.selectedRun.status)
    ) {
      const response = await api.steerRun(state.selectedRun.id, {
        prompt,
        expectedRunId: state.selectedRun.id,
        expectedProviderRevision: requireProviderRevision(),
      });
      state.promptDraft = '';
      applyRunSnapshot(response.runSnapshot);
      state.runUpdateFeedbackMessage =
        response.delivery === 'native'
          ? 'Update delivered to the active run.'
          : 'Update queued safely. CodeWave will continue it in this thread when the active run settles.';
      emitShellSummaryState();
      syncRouteAction();
      return;
    }

    let session = state.selectedSession;
    if (!session) {
      const createdSession = await createSession();
      if (!createdSession) {
        return;
      }
      session =
        state.selectedSession?.id === createdSession.id
          ? state.selectedSession
          : createdSession;
    }

    if (!session) {
      return;
    }

    const snapshot = await api.startRun(session.id, {
      prompt,
      mode: state.runModeDraft,
      expectedProviderRevision: requireProviderRevision(),
    });

    state.promptDraft = '';
    syncRouteAction();
    state.runs.unshift(snapshot.run);
    emitRunViewState();
    await loadArchive();
    await selectRun(snapshot.run.id);
  }

  async function routePrompt() {
    const prompt = getSelectedPrompt();
    const workspacePath = getSelectedWorkspacePath();
    if (!prompt || !workspacePath) {
      return;
    }

    const response = await api.routePrompt({
      prompt,
      workspacePath,
      expectedProviderRevision: requireProviderRevision(),
      sessionId: state.selectedSession?.id || null,
      preferredProviderId: getPreferredProviderId(),
      approvalPolicy: toApprovalPolicy(getRouteApprovalPolicy()),
      requiredTools: toRoutingToolRequirements(getRequiredTools()),
    });

    state.promptDraft = '';
    syncRouteAction();
    state.recommendation = response.recommendation;
    state.orchestratorNoteMessage = formatRecommendation(response.recommendation);
    emitShellSummaryState();
    await transitionToNewSession(response.session, 'Routing');
  }

  async function createFollowUpRun(kind: FollowUpKind) {
    if (!state.selectedRun || state.selectedRun.status !== 'completed') {
      return;
    }

    const response = await api.createFollowUpRun(state.selectedRun.id, {
      kind,
      expectedProviderRevision: requireProviderRevision(),
      preferredProviderId: state.selectedSession?.providerId || null,
      approvalPolicy: toApprovalPolicy(getRouteApprovalPolicy()),
    });

    const actionLabel =
      kind === 'verify' ? 'Verify follow-up' : 'Review follow-up';
    await transitionToNewSession(response.session, actionLabel);
  }

  async function delegatePrompt() {
    if (!state.selectedRun || state.selectedRun.status !== 'completed') {
      return;
    }

    const prompt = getSelectedPrompt();
    if (!prompt) {
      return;
    }

    const response = await api.delegateRun(state.selectedRun.id, {
      prompt,
      role: toDelegateRole(state.delegateRoleDraft),
      expectedProviderRevision: requireProviderRevision(),
      preferredProviderId: state.selectedSession?.providerId || null,
      approvalPolicy: toApprovalPolicy(getRouteApprovalPolicy()),
      requiredTools: toRoutingToolRequirements(getRequiredTools()),
    });

    state.promptDraft = '';
    syncRouteAction();
    await transitionToNewSession(response.session, 'Delegation');
  }

  async function handoffPrompt() {
    if (!state.selectedRun || state.selectedRun.status !== 'completed') {
      return;
    }

    const prompt = getSelectedPrompt();
    if (!prompt) {
      return;
    }

    const response = await api.handoffRun(state.selectedRun.id, {
      prompt,
      expectedProviderRevision: requireProviderRevision(),
      preferredProviderId: state.selectedSession?.providerId || null,
      approvalPolicy: toApprovalPolicy(getRouteApprovalPolicy()),
      requiredTools: toRoutingToolRequirements(getRequiredTools()),
    });

    state.promptDraft = '';
    syncRouteAction();
    await transitionToNewSession(response.session, 'Handoff');
  }

  async function resolveApproval(
    approvalId: string,
    decision: ApprovalDecision,
  ) {
    await api.resolveApproval(approvalId, { decision });

    if (state.selectedRun) {
      await refreshRun(state.selectedRun.id);
    }
  }

  async function cancelSelectedRun() {
    if (!state.selectedRun) {
      return;
    }

    const snapshot = await api.cancelRun(state.selectedRun.id);
    applyRunSnapshot(snapshot);
  }

  async function updateSelectedSessionPolicy() {
    if (!state.selectedSession) {
      return;
    }

    const session = await api.updateSession(state.selectedSession.id, {
      expectedProviderRevision: requireProviderRevision(),
      approvalPolicy: toApprovalPolicy(state.selectedSessionApprovalPolicyDraft),
    });

    state.selectedSession = session;
    state.sessions = state.sessions.map((entry) =>
      entry.id === session.id ? session : entry,
    );
    state.recentSessionsMessage = null;
    emitShellPanelsState();
    syncResumeAction();
    syncApprovalPolicyControls();
    await loadArchive();
  }

  function updateSelectedSessionPolicyDraft(policy: ApprovalPolicy) {
    state.selectedSessionApprovalPolicyDraft = policy;
    state.applySelectedSessionPolicyDisabled =
      state.selectedSessionApprovalPolicyDraftDisabled ||
      !state.selectedSession ||
      policy === state.selectedSession.approvalPolicy;
    emitShellControlsState();
  }

  function updateRunMode(mode: RunMode) {
    state.runModeDraft = mode;
    emitShellControlsState();
  }

  async function executePlanRun(planText: string) {
    const trimmed = planText.trim();
    if (!trimmed) {
      return;
    }

    state.runModeDraft = 'execute';
    state.promptDraft = trimmed;
    emitShellControlsState();
    await startRun();
  }

  async function undoSelectedRun() {
    if (!state.selectedRun) {
      return;
    }
    const runId = state.selectedRun.id;
    const response = await api.undoRun(runId);
    state.undoAvailable = false;
    state.undoDetail = response.detail;
    if (state.selectedRun?.id === runId) {
      state.selectedRun = response.run;
    }
    emitRunViewState();
    await refreshRun(runId);
  }

  return {
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
  };
}
