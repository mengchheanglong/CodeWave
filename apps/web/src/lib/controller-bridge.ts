import type {
  ApprovalPolicy,
  RoutingToolRequirement,
  RunMode,
} from '@codewave/protocol';
import type { ShellPanelsState } from './shell-panels-state.js';
import type {
  DelegateRole,
  FollowUpKind,
  ShellControlsState,
} from './shell-controls-state.js';
import type { ShellSummaryState } from './shell-summary-state.js';
import type { RunViewState } from './run-view-state.js';
import type {
  ApprovalDecision,
  ControllerRequesterMap,
  SessionDraftPatch,
} from './controller-contracts.js';

const runViewListeners = new Set<(nextState: RunViewState) => void>();
const shellPanelsListeners = new Set<(nextState: ShellPanelsState) => void>();
const shellControlsListeners = new Set<(nextState: ShellControlsState) => void>();
const shellSummaryListeners = new Set<(nextState: ShellSummaryState) => void>();

const noopAsync = async () => {};
const requesters: ControllerRequesterMap = {
  runSelectionRequester: noopAsync,
  runtimeRefreshRequester: noopAsync,
  sessionSelectionRequester: async () => false,
  approvalResolutionRequester: noopAsync,
  checkpointRecoveryRequester: noopAsync,
  sessionDraftChangeRequester: noopAsync,
  workspaceDraftCommitRequester: noopAsync,
  promptDraftChangeRequester: noopAsync,
  routingToolsDraftChangeRequester: noopAsync,
  delegateRoleChangeRequester: noopAsync,
  selectedSessionPolicyDraftChangeRequester: noopAsync,
  createSessionRequester: noopAsync,
  startRunRequester: noopAsync,
  routePromptRequester: noopAsync,
  delegatePromptRequester: noopAsync,
  handoffPromptRequester: noopAsync,
  recoverSelectedSessionRequester: noopAsync,
  sessionDeleteRequester: noopAsync,
  applySelectedSessionPolicyRequester: noopAsync,
  cancelSelectedRunRequester: noopAsync,
  undoRunRequester: noopAsync,
  transcriptCompactionRequester: noopAsync,
  runModeDraftChangeRequester: noopAsync,
  executePlanRequester: noopAsync,
  followUpRunRequester: noopAsync,
};

export function setControllerRequesters(next: ControllerRequesterMap) {
  Object.assign(requesters, next);
}

export function emitRunViewState(nextState: RunViewState) {
  runViewListeners.forEach((listener) => listener(nextState));
}

export function emitShellPanelsState(nextState: ShellPanelsState) {
  shellPanelsListeners.forEach((listener) => listener(nextState));
}

export function emitShellControlsState(nextState: ShellControlsState) {
  shellControlsListeners.forEach((listener) => listener(nextState));
}

export function emitShellSummaryState(nextState: ShellSummaryState) {
  shellSummaryListeners.forEach((listener) => listener(nextState));
}

export function subscribeRunViewState(
  listener: (nextState: RunViewState) => void,
): () => void {
  runViewListeners.add(listener);
  return () => {
    runViewListeners.delete(listener);
  };
}

export function subscribeShellPanelsState(
  listener: (nextState: ShellPanelsState) => void,
): () => void {
  shellPanelsListeners.add(listener);
  return () => {
    shellPanelsListeners.delete(listener);
  };
}

export function subscribeShellControlsState(
  listener: (nextState: ShellControlsState) => void,
): () => void {
  shellControlsListeners.add(listener);
  return () => {
    shellControlsListeners.delete(listener);
  };
}

export function subscribeShellSummaryState(
  listener: (nextState: ShellSummaryState) => void,
): () => void {
  shellSummaryListeners.add(listener);
  return () => {
    shellSummaryListeners.delete(listener);
  };
}

export async function requestRunSelection(runId: string): Promise<void> {
  await requesters.runSelectionRequester(runId);
}

export async function requestRuntimeRefresh(): Promise<void> {
  await requesters.runtimeRefreshRequester();
}

export async function requestSessionSelection(
  sessionId: string,
): Promise<boolean> {
  return requesters.sessionSelectionRequester(sessionId);
}

export async function requestApprovalResolution(
  approvalId: string,
  decision: ApprovalDecision,
): Promise<void> {
  await requesters.approvalResolutionRequester(approvalId, decision);
}

export async function requestCheckpointRecovery(
  checkpointId: string,
): Promise<void> {
  await requesters.checkpointRecoveryRequester(checkpointId);
}

export async function requestSessionDraftChange(
  patch: SessionDraftPatch,
): Promise<void> {
  await requesters.sessionDraftChangeRequester(patch);
}

export async function requestWorkspaceDraftCommit(): Promise<void> {
  await requesters.workspaceDraftCommitRequester();
}

export async function requestPromptDraftChange(prompt: string): Promise<void> {
  await requesters.promptDraftChangeRequester(prompt);
}

export async function requestRoutingToolsDraftChange(
  tools: RoutingToolRequirement[],
): Promise<void> {
  await requesters.routingToolsDraftChangeRequester(tools);
}

export async function requestDelegateRoleChange(role: DelegateRole): Promise<void> {
  await requesters.delegateRoleChangeRequester(role);
}

export async function requestSelectedSessionPolicyDraftChange(
  policy: ApprovalPolicy,
): Promise<void> {
  await requesters.selectedSessionPolicyDraftChangeRequester(policy);
}

export async function requestCreateSession(): Promise<void> {
  await requesters.createSessionRequester();
}

export async function requestStartRun(): Promise<void> {
  await requesters.startRunRequester();
}

export async function requestRoutePrompt(): Promise<void> {
  await requesters.routePromptRequester();
}

export async function requestDelegatePrompt(): Promise<void> {
  await requesters.delegatePromptRequester();
}

export async function requestHandoffPrompt(): Promise<void> {
  await requesters.handoffPromptRequester();
}

export async function requestRecoverSelectedSession(): Promise<void> {
  await requesters.recoverSelectedSessionRequester();
}

export async function requestSessionDelete(sessionId: string): Promise<void> {
  await requesters.sessionDeleteRequester(sessionId);
}

export async function requestApplySelectedSessionPolicy(): Promise<void> {
  await requesters.applySelectedSessionPolicyRequester();
}

export async function requestCancelSelectedRun(): Promise<void> {
  await requesters.cancelSelectedRunRequester();
}

export async function requestUndoRun(): Promise<void> {
  await requesters.undoRunRequester();
}

export async function requestTranscriptCompaction(): Promise<void> {
  await requesters.transcriptCompactionRequester();
}

export async function requestRunModeChange(mode: RunMode): Promise<void> {
  await requesters.runModeDraftChangeRequester(mode);
}

export async function requestExecutePlan(planText: string): Promise<void> {
  await requesters.executePlanRequester(planText);
}

export async function requestFollowUpRun(kind: FollowUpKind): Promise<void> {
  await requesters.followUpRunRequester(kind);
}
