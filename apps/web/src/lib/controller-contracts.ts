import type {
  ApprovalPolicy,
  RoutingToolRequirement,
  RunMode,
  WorkbenchSession,
} from '@codewave/protocol';
import type {
  DelegateRole,
  FollowUpKind,
  ShellControlsState,
} from './shell-controls-state.js';

export type ApprovalDecision = 'approved' | 'denied';

export type SessionDraftPatch = Partial<
  Pick<ShellControlsState, 'workspacePath' | 'providerId' | 'sessionApprovalPolicy'>
>;

export type LoadArchive = () => Promise<void>;
export type RefreshRuntime = () => Promise<void>;
export type RefreshRecommendation = () => Promise<void>;
export type SelectRun = (runId: string) => Promise<void>;
export type SelectSession = (sessionId: string) => Promise<boolean>;
export type RefreshRun = (runId: string) => Promise<void>;
export type RecoverFromCheckpoint = (checkpointId: string) => Promise<void>;
export type RecoverSelectedSession = () => Promise<void>;
export type DeleteSession = (sessionId: string) => Promise<void>;
export type ResolveApproval = (
  approvalId: string,
  decision: ApprovalDecision,
) => Promise<void>;
export type UpdateSelectedSessionPolicy = () => Promise<void>;
export type CancelSelectedRun = () => Promise<void>;
export type CreateFollowUpRun = (kind: FollowUpKind) => Promise<void>;
export type CreateSession = () => Promise<WorkbenchSession | null>;
export type StartRun = () => Promise<void>;
export type RoutePrompt = () => Promise<void>;
export type DelegatePrompt = () => Promise<void>;
export type HandoffPrompt = () => Promise<void>;
export type TransitionToNewSession = (
  session: WorkbenchSession,
  actionLabel: string,
) => Promise<boolean>;

export type ControllerRequesterMap = {
  runtimeRefreshRequester: RefreshRuntime;
  runSelectionRequester: SelectRun;
  sessionSelectionRequester: SelectSession;
  approvalResolutionRequester: ResolveApproval;
  checkpointRecoveryRequester: RecoverFromCheckpoint;
  sessionDraftChangeRequester: (patch: SessionDraftPatch) => Promise<void>;
  workspaceDraftCommitRequester: () => Promise<void>;
  promptDraftChangeRequester: (prompt: string) => Promise<void>;
  routingToolsDraftChangeRequester: (
    tools: RoutingToolRequirement[],
  ) => Promise<void>;
  delegateRoleChangeRequester: (role: DelegateRole) => Promise<void>;
  selectedSessionPolicyDraftChangeRequester: (
    policy: ApprovalPolicy,
  ) => Promise<void>;
  createSessionRequester: () => Promise<void>;
  startRunRequester: () => Promise<void>;
  routePromptRequester: () => Promise<void>;
  delegatePromptRequester: () => Promise<void>;
  handoffPromptRequester: () => Promise<void>;
  recoverSelectedSessionRequester: () => Promise<void>;
  sessionDeleteRequester: (sessionId: string) => Promise<void>;
  applySelectedSessionPolicyRequester: () => Promise<void>;
  cancelSelectedRunRequester: () => Promise<void>;
  undoRunRequester: () => Promise<void>;
  runModeDraftChangeRequester: (mode: RunMode) => Promise<void>;
  executePlanRequester: (planText: string) => Promise<void>;
  followUpRunRequester: CreateFollowUpRun;
};
