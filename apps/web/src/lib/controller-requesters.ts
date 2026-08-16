import type {
  ApprovalPolicy,
  RoutingToolRequirement,
  RunMode,
} from '@codewave/protocol';
import type {
  DelegateRole,
  FollowUpKind,
} from './shell-controls-state.js';
import type {
  ApprovalDecision,
  CancelSelectedRun,
  ControllerRequesterMap,
  CreateFollowUpRun,
  CreateSession,
  HandoffPrompt,
  RecoverFromCheckpoint,
  RecoverSelectedSession,
  RefreshRecommendation,
  RefreshRuntime,
  ResolveApproval,
  RoutePrompt,
  DeleteSession,
  SelectRun,
  SelectSession,
  SessionDraftPatch,
  StartRun,
  UpdateSelectedSessionPolicy,
  DelegatePrompt,
} from './controller-contracts.js';
import type { DaemonApi } from './daemon-api.js';
import type { ControllerRequesterState } from './controller-state-slices.js';

type ControllerRequesterDeps = {
  state: ControllerRequesterState;
  api: DaemonApi;
  emitShellControlsState: () => void;
  syncSessionCreationControls: () => void;
  syncRunAction: () => void;
  syncRouteAction: () => void;
  loadToolPlane: (workspacePath?: string) => Promise<void>;
  refreshRecommendation: RefreshRecommendation;
  selectRun: SelectRun;
  selectSession: SelectSession;
  recoverFromCheckpoint: RecoverFromCheckpoint;
  recoverSelectedSession: RecoverSelectedSession;
  deleteSession: DeleteSession;
  resolveApproval: ResolveApproval;
  updateSelectedSessionPolicyDraft: (policy: ApprovalPolicy) => void;
  createSession: CreateSession;
  startRun: StartRun;
  routePrompt: RoutePrompt;
  delegatePrompt: DelegatePrompt;
  handoffPrompt: HandoffPrompt;
  updateSelectedSessionPolicy: UpdateSelectedSessionPolicy;
  cancelSelectedRun: CancelSelectedRun;
  createFollowUpRun: CreateFollowUpRun;
  executePlanRun: (planText: string) => Promise<void>;
  undoSelectedRun: () => Promise<void>;
  compactTranscript: () => Promise<void>;
  updateRunMode: (mode: RunMode) => void;
  refreshRuntime: RefreshRuntime;
};

export function createControllerRequesters(
  deps: ControllerRequesterDeps,
): ControllerRequesterMap {
  const {
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
    compactTranscript,
    updateRunMode,
    refreshRuntime,
  } = deps;

  function toApprovalPolicy(value: string): ApprovalPolicy {
    return value === 'allow' || value === 'deny' ? value : 'manual';
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

  return {
    runtimeRefreshRequester: async () => {
      await refreshRuntime();
    },
    approvalResolutionRequester: async (
      approvalId: string,
      decision: ApprovalDecision,
    ) => {
      await resolveApproval(approvalId, decision);
    },
    applySelectedSessionPolicyRequester: async () => {
      await updateSelectedSessionPolicy().catch(() => {});
    },
    cancelSelectedRunRequester: async () => {
      await cancelSelectedRun().catch(() => {});
    },
    undoRunRequester: async () => {
      await undoSelectedRun().catch(() => {});
    },
    transcriptCompactionRequester: async () => {
      await compactTranscript().catch(() => {});
    },
    runModeDraftChangeRequester: async (mode: RunMode) => {
      updateRunMode(mode);
    },
    executePlanRequester: async (planText: string) => {
      await executePlanRun(planText).catch(() => {});
    },
    checkpointRecoveryRequester: async (checkpointId: string) => {
      await recoverFromCheckpoint(checkpointId);
    },
    createSessionRequester: async () => {
      await createSession().catch(() => {});
    },
    delegatePromptRequester: async () => {
      await delegatePrompt().catch(() => {});
    },
    delegateRoleChangeRequester: async (role: DelegateRole) => {
      state.delegateRoleDraft = role;
      emitShellControlsState();
    },
    followUpRunRequester: async (kind: FollowUpKind) => {
      await createFollowUpRun(kind).catch(() => {});
    },
    handoffPromptRequester: async () => {
      await handoffPrompt().catch(() => {});
    },
    promptDraftChangeRequester: async (prompt: string) => {
      state.promptDraft = prompt;
      syncRunAction();
      await refreshRecommendation();
    },
    recoverSelectedSessionRequester: async () => {
      await recoverSelectedSession().catch(() => {});
    },
    sessionDeleteRequester: async (sessionId: string) => {
      await deleteSession(sessionId).catch(() => {});
    },
    routePromptRequester: async () => {
      await routePrompt().catch(() => {});
    },
    routingToolsDraftChangeRequester: async (tools: RoutingToolRequirement[]) => {
      state.routingToolsDraft = [...tools];
      syncRouteAction();
      await refreshRecommendation();
    },
    runSelectionRequester: async (runId: string) => {
      await selectRun(runId);
    },
    selectedSessionPolicyDraftChangeRequester: async (
      policy: ApprovalPolicy,
    ) => {
      updateSelectedSessionPolicyDraft(policy);
    },
    sessionDraftChangeRequester: async (
      patch: SessionDraftPatch,
    ) => {
      if (typeof patch.workspacePath === 'string') {
        state.workspacePathDraft = patch.workspacePath;
      }
      if (typeof patch.providerId === 'string') {
        state.providerIdDraft = patch.providerId;
        try {
          localStorage.setItem('codewave.preferred_provider', patch.providerId);
        } catch {}
        if (state.selectedSession) {
          const selectedSessionId = state.selectedSession.id;
          const previousProviderId = state.selectedSession.providerId;
          const expectedProviderRevision = requireProviderRevision();
          state.selectedSession.providerId = patch.providerId;
          void api
            .updateSession(selectedSessionId, {
              providerId: patch.providerId,
              expectedProviderRevision,
            })
            .then((updatedSession) => {
              if (state.selectedSession?.id === selectedSessionId) {
                state.selectedSession = updatedSession;
                emitShellControlsState();
              }
            })
            .catch(() => {
              if (
                state.selectedSession?.id === selectedSessionId &&
                state.selectedSession.providerId === patch.providerId
              ) {
                state.selectedSession.providerId = previousProviderId;
                emitShellControlsState();
              }
            });
        }
        syncSessionCreationControls();
      }
      if (typeof patch.sessionApprovalPolicy === 'string') {
        state.sessionApprovalPolicyDraft = toApprovalPolicy(
          patch.sessionApprovalPolicy,
        );
      }
      syncRunAction();
      emitShellControlsState();
    },
    sessionSelectionRequester: async (sessionId: string) => {
      return selectSession(sessionId);
    },
    startRunRequester: async () => {
      await startRun().catch(() => {});
    },
    workspaceDraftCommitRequester: async () => {
      syncRunAction();
      await loadToolPlane(state.workspacePathDraft.trim()).catch(() => {});
      await refreshRecommendation();
    },
  };
}
