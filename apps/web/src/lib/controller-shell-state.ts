import type {
  ApprovalRecord,
  ArchiveSessionSummary,
  ArtifactRecord,
  CheckpointRecord,
  OrchestrationBoardSnapshot,
  OrchestrationRecommendation,
  RunMode,
  RuntimeInfo,
  ToolInvocationRecord,
  ToolPlaneSnapshot,
  TranscriptWindow,
  WorkbenchEvent,
  WorkbenchRun,
  WorkbenchSession,
} from '@codewave/protocol';
import {
  emptyShellControlsState,
  type DelegateRole,
} from './shell-controls-state.js';
import type {
  ApprovalPolicy,
  ProviderId,
  RoutingToolRequirement,
} from '@codewave/protocol';
import { emptyShellSummaryState } from './shell-summary-state.js';

export type ShellState = {
  runtime: RuntimeInfo | null;
  toolPlane: ToolPlaneSnapshot | null;
  sessions: WorkbenchSession[];
  recentSessionsMessage: string | null;
  archiveSessions: ArchiveSessionSummary[];
  orchestrationFlows: OrchestrationBoardSnapshot['flows'];
  selectedSession: WorkbenchSession | null;
  runs: WorkbenchRun[];
  selectedRun: WorkbenchRun | null;
  eventSource: EventSource | null;
  events: WorkbenchEvent[];
  transcript: TranscriptWindow | null;
  contextChars: number;
  undoAvailable: boolean;
  undoDetail: string | null;
  artifacts: ArtifactRecord[];
  approvals: ApprovalRecord[];
  checkpoints: CheckpointRecord[];
  tools: ToolInvocationRecord[];
  recommendation: OrchestrationRecommendation | null;
  workspacePathDraft: string;
  providerIdDraft: ProviderId;
  sessionApprovalPolicyDraft: ApprovalPolicy;
  sessionApprovalPolicyDraftDisabled: boolean;
  runModeDraft: RunMode;
  promptDraft: string;
  promptDraftDisabled: boolean;
  routingToolsDraft: RoutingToolRequirement[];
  delegateRoleDraft: DelegateRole;
  selectedSessionApprovalPolicyDraft: ApprovalPolicy;
  selectedSessionApprovalPolicyDraftDisabled: boolean;
  applySelectedSessionPolicyDisabled: boolean;
  startRunDisabled: boolean;
  routeRunDisabled: boolean;
  delegateRunDisabled: boolean;
  handoffRunDisabled: boolean;
  resumeSessionDisabled: boolean;
  cancelRunDisabled: boolean;
  reviewRunDisabled: boolean;
  verifyRunDisabled: boolean;
  providerHealthMessage: string;
  providerSessionLabel: string;
  dataDirectoryLabel: string;
  toolPlaneNoteMessage: string;
  sessionProviderNoteMessage: string;
  selectedSessionNoteMessage: string;
  runTitleLabel: string;
  runStatusLabel: string;
  runStatusClassName: string;
  runStateNoteMessage: string;
  runUpdateFeedbackMessage: string | null;
  orchestratorNoteMessage: string;
  runSelectionToken: number;
  sessionSelectionToken: number;
  recommendationRequestToken: number;
  toolPlaneRequestToken: number;
};

function getSavedProviderId(): ProviderId {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('codewave.preferred_provider');
      if (saved === 'qwen' || saved === 'gemini' || saved === 'opencode' || saved === 'freebuff') {
        return saved;
      }
    } catch {}
  }
  return emptyShellControlsState.providerId;
}

export function createInitialShellState(): ShellState {
  return {
    runtime: null,
    toolPlane: null,
    sessions: [],
    recentSessionsMessage: null,
    archiveSessions: [],
    orchestrationFlows: [],
    selectedSession: null,
    runs: [],
    selectedRun: null,
    eventSource: null,
    events: [],
    transcript: null,
    contextChars: 0,
    undoAvailable: false,
    undoDetail: null,
    artifacts: [],
    approvals: [],
    checkpoints: [],
    tools: [],
    recommendation: null,
    workspacePathDraft: emptyShellControlsState.workspacePath,
    providerIdDraft: getSavedProviderId(),
    sessionApprovalPolicyDraft: emptyShellControlsState.sessionApprovalPolicy,
    sessionApprovalPolicyDraftDisabled:
      emptyShellControlsState.sessionApprovalPolicyDisabled,
    runModeDraft: emptyShellControlsState.runMode,
    promptDraft: emptyShellControlsState.prompt,
    promptDraftDisabled: emptyShellControlsState.promptDisabled,
    routingToolsDraft: [...emptyShellControlsState.routingTools],
    delegateRoleDraft: emptyShellControlsState.delegateRole,
    selectedSessionApprovalPolicyDraft:
      emptyShellControlsState.selectedSessionApprovalPolicy,
    selectedSessionApprovalPolicyDraftDisabled:
      emptyShellControlsState.selectedSessionApprovalPolicyDisabled,
    applySelectedSessionPolicyDisabled:
      emptyShellControlsState.applySelectedSessionPolicyDisabled,
    startRunDisabled: emptyShellControlsState.startRunDisabled,
    routeRunDisabled: emptyShellControlsState.routeRunDisabled,
    delegateRunDisabled: emptyShellControlsState.delegateRunDisabled,
    handoffRunDisabled: emptyShellControlsState.handoffRunDisabled,
    resumeSessionDisabled: emptyShellControlsState.resumeSessionDisabled,
    cancelRunDisabled: emptyShellControlsState.cancelRunDisabled,
    reviewRunDisabled: emptyShellControlsState.reviewRunDisabled,
    verifyRunDisabled: emptyShellControlsState.verifyRunDisabled,
    providerHealthMessage: emptyShellSummaryState.providerHealth,
    providerSessionLabel: emptyShellSummaryState.providerSession,
    dataDirectoryLabel: emptyShellSummaryState.dataDirectory,
    toolPlaneNoteMessage: emptyShellSummaryState.toolPlaneNote,
    sessionProviderNoteMessage: emptyShellSummaryState.sessionProviderNote,
    selectedSessionNoteMessage: emptyShellSummaryState.selectedSessionNote,
    runTitleLabel: emptyShellSummaryState.runTitle,
    runStatusLabel: emptyShellSummaryState.runStatusLabel,
    runStatusClassName: emptyShellSummaryState.runStatusClassName,
    runStateNoteMessage: emptyShellSummaryState.runStateNote,
    runUpdateFeedbackMessage: emptyShellSummaryState.runUpdateFeedback,
    orchestratorNoteMessage: emptyShellSummaryState.orchestratorNote,
    runSelectionToken: 0,
    sessionSelectionToken: 0,
    recommendationRequestToken: 0,
    toolPlaneRequestToken: 0,
  };
}
