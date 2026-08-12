import assert from 'node:assert/strict';
import type {
  ApprovalPolicy,
  ApprovalRecord,
  ArchiveSnapshot,
  CheckpointRecord,
  OrchestrationBoardSnapshot,
  OrchestrationRecommendation,
  ProviderCapabilities,
  ProviderId,
  RecoverSessionResponse,
  ResolveApprovalRequest,
  RoutePromptRequest,
  RoutePromptResponse,
  RunSnapshot,
  RuntimeInfo,
  StartRunRequest,
  ToolPlaneResponse,
  WorkbenchRun,
  WorkbenchSession,
} from '@qwemini/protocol';
import type { DaemonApi } from '../apps/web/src/lib/daemon-api.js';
import { createControllerRunActionFlows } from '../apps/web/src/lib/controller-run-action-flows.js';
import { createControllerRequesters } from '../apps/web/src/lib/controller-requesters.js';
import { createInitialShellState } from '../apps/web/src/lib/controller-shell-state.js';
import { createControllerUiSync } from '../apps/web/src/lib/controller-ui-sync.js';

const NOW = '2026-04-05T00:00:00.000Z';

function makeCapabilities(): ProviderCapabilities {
  return {
    daemonApprovalMediation: true,
    resumableSessions: true,
    checkpointEvents: true,
  };
}

function makeRuntime(): RuntimeInfo {
  return {
    defaultWorkspacePath: 'C:/workspace',
    dataDirectory: 'C:/workspace/.qwemini',
    providers: [
      {
        providerId: 'qwen',
        available: true,
        detail: 'Qwen ready',
        capabilities: makeCapabilities(),
      },
      {
        providerId: 'gemini',
        available: true,
        detail: 'Gemini ready',
        capabilities: makeCapabilities(),
      },
    ],
  };
}

function makeSession(
  overrides: Partial<WorkbenchSession> = {},
): WorkbenchSession {
  return {
    id: 'session-1',
    workspacePath: 'C:/workspace/demo',
    providerId: 'qwen',
    createdAt: NOW,
    providerSessionId: null,
    approvalPolicy: 'manual',
    recovery: null,
    orchestration: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<WorkbenchRun> = {}): WorkbenchRun {
  return {
    id: 'run-1',
    sessionId: 'session-1',
    providerId: 'qwen',
    prompt: 'hello',
    status: 'running',
    createdAt: NOW,
    startedAt: NOW,
    completedAt: null,
    errorMessage: null,
    ...overrides,
  };
}

function makeRunSnapshot(run: WorkbenchRun): RunSnapshot {
  return {
    run,
    events: [],
    artifacts: [],
    approvals: [],
    checkpoints: [],
    toolInvocations: [],
  };
}

function makeRecommendation(
  overrides: Partial<OrchestrationRecommendation> = {},
): OrchestrationRecommendation {
  return {
    prompt: 'route me',
    workspacePath: 'C:/workspace/demo',
    preferredProviderId: null,
    requiredTools: [],
    primaryProviderId: 'qwen',
    fallbackProviderId: 'gemini',
    strategy: 'balanced',
    confidence: 0.92,
    reason: 'test recommendation',
    signals: ['usable'],
    ...overrides,
  };
}

function createUnusedDaemonApi(): DaemonApi {
  const unused = async (): Promise<never> => {
    throw new Error('unused');
  };

  return {
    getRuntime: unused,
    getToolPlane: unused as () => Promise<ToolPlaneResponse>,
    getSessions: unused as () => Promise<WorkbenchSession[]>,
    createSession: unused as (
      input: { workspacePath: string; providerId: ProviderId; approvalPolicy?: ApprovalPolicy },
    ) => Promise<WorkbenchSession>,
    getSession: unused as (sessionId: string) => Promise<never>,
    updateSession: unused as (
      sessionId: string,
      input: { approvalPolicy: ApprovalPolicy },
    ) => Promise<WorkbenchSession>,
    recoverSession: unused as (sessionId: string) => Promise<RecoverSessionResponse>,
    startRun: unused as (
      sessionId: string,
      input: StartRunRequest,
    ) => Promise<RunSnapshot>,
    getRun: unused as (runId: string) => Promise<RunSnapshot>,
    cancelRun: unused as (runId: string) => Promise<RunSnapshot>,
    getArchive: unused as () => Promise<ArchiveSnapshot>,
    getOrchestrationBoard: unused as () => Promise<OrchestrationBoardSnapshot>,
    recommendPrompt: unused as (
      input: {
        prompt: string;
        workspacePath: string;
        sessionId?: string | null;
        preferredProviderId?: ProviderId | null;
        requiredTools?: string[];
      },
    ) => Promise<{ recommendation: OrchestrationRecommendation }>,
    routePrompt: unused as (input: RoutePromptRequest) => Promise<RoutePromptResponse>,
    createFollowUpRun: unused as (runId: string, input: unknown) => Promise<never>,
    delegateRun: unused as (runId: string, input: unknown) => Promise<never>,
    handoffRun: unused as (runId: string, input: unknown) => Promise<never>,
    resolveApproval: unused as (
      approvalId: string,
      input: ResolveApprovalRequest,
    ) => Promise<ApprovalRecord>,
    recoverCheckpointSession: unused as (
      checkpointId: string,
    ) => Promise<RecoverSessionResponse>,
  };
}

async function validateControlsEnableFromDraftState() {
  const state = createInitialShellState();
  state.runtime = makeRuntime();
  state.workspacePathDraft = 'C:/workspace/demo';
  state.providerIdDraft = 'qwen';

  const sync = createControllerUiSync({
    state,
    emitShellControlsState: () => {},
    emitShellSummaryState: () => {},
    getSelectedPrompt: () => 'implement this',
  });

  sync.syncRunAction();

  assert.equal(state.startRunDisabled, false);
  assert.equal(state.promptDraftDisabled, false);
  assert.equal(state.routeRunDisabled, false);
}

async function validateRequestersResyncRunAvailability() {
  const state = createInitialShellState();
  let syncRunActionCount = 0;
  let refreshRecommendationCount = 0;
  let loadToolPlaneArg: string | undefined;

  const requesters = createControllerRequesters({
    state,
    emitShellControlsState: () => {},
    syncSessionCreationControls: () => {},
    syncRunAction: () => {
      syncRunActionCount += 1;
    },
    syncRouteAction: () => {},
    loadToolPlane: async (workspacePath?: string) => {
      loadToolPlaneArg = workspacePath;
    },
    refreshRecommendation: async () => {
      refreshRecommendationCount += 1;
    },
    selectRun: async () => {},
    selectSession: async () => false,
    recoverFromCheckpoint: async () => {},
    recoverSelectedSession: async () => {},
    resolveApproval: async (
      _approvalId: string,
      _decision: 'approved' | 'denied',
    ) => {},
    updateSelectedSessionPolicyDraft: () => {},
    createSession: async () => null,
    startRun: async () => {},
    routePrompt: async () => {},
    delegatePrompt: async () => {},
    handoffPrompt: async () => {},
    updateSelectedSessionPolicy: async () => {},
    cancelSelectedRun: async () => {},
    createFollowUpRun: async () => {},
  });

  await requesters.promptDraftChangeRequester('hello');
  await requesters.sessionDraftChangeRequester({
    workspacePath: ' C:/workspace/demo ',
  });
  await requesters.workspaceDraftCommitRequester();

  assert.equal(syncRunActionCount, 3);
  assert.equal(refreshRecommendationCount, 2);
  assert.equal(loadToolPlaneArg, 'C:/workspace/demo');
}

async function validateStartRunCreatesSessionOnDemand() {
  const state = createInitialShellState();
  state.runtime = makeRuntime();
  state.workspacePathDraft = 'C:/workspace/demo';
  state.providerIdDraft = 'qwen';
  state.sessionApprovalPolicyDraft = 'manual';
  state.promptDraft = 'implement this';

  const calls: unknown[] = [];
  const session = makeSession();
  const run = makeRun();
  const api: DaemonApi = {
    ...createUnusedDaemonApi(),
    createSession: async (input) => {
      calls.push(['createSession', input]);
      return session;
    },
    startRun: async (sessionId, input) => {
      calls.push(['startRun', sessionId, input]);
      return makeRunSnapshot(run);
    },
  };

  const flows = createControllerRunActionFlows({
    state,
    api,
    emitRunViewState: () => {},
    emitShellPanelsState: () => {},
    emitShellSummaryState: () => {},
    emitShellControlsState: () => {},
    syncRouteAction: () => {},
    syncResumeAction: () => {},
    syncApprovalPolicyControls: () => {},
    loadArchive: async () => {},
    selectRun: async () => {},
    refreshRun: async () => {},
    transitionToNewSession: async (nextSession) => {
      state.selectedSession = nextSession;
      return true;
    },
    applyRunSnapshot: () => {},
    getSelectedPrompt: () => state.promptDraft.trim(),
    getSelectedWorkspacePath: () =>
      state.selectedSession?.workspacePath || state.workspacePathDraft.trim(),
    getPreferredProviderId: () =>
      state.selectedSession?.providerId || state.providerIdDraft,
    getRouteApprovalPolicy: () =>
      state.selectedSession?.approvalPolicy || state.sessionApprovalPolicyDraft,
    getRequiredTools: () => [...state.routingToolsDraft],
  });

  await flows.startRun();

  assert.deepEqual(calls, [
    [
      'createSession',
      {
        workspacePath: 'C:/workspace/demo',
        providerId: 'qwen',
        approvalPolicy: 'manual',
      },
    ],
    [
      'startRun',
      'session-1',
      {
        mode: 'execute',
        prompt: 'implement this',
      },
    ],
  ]);
  assert.equal(state.selectedSession?.id, 'session-1');
  assert.equal(state.promptDraft, '');
  assert.equal(state.runs.length, 1);
}

async function validateDraftRoutingWithoutSelectedSession() {
  const state = createInitialShellState();
  state.runtime = makeRuntime();
  state.workspacePathDraft = 'C:/workspace/demo';
  state.providerIdDraft = 'gemini';
  state.sessionApprovalPolicyDraft = 'manual';
  state.promptDraft = 'route me';
  state.routingToolsDraft = ['workspace-read'];

  const calls: unknown[] = [];
  const recommendation = makeRecommendation({
    workspacePath: 'C:/workspace/demo',
    preferredProviderId: 'gemini',
    requiredTools: ['workspace-read'],
    primaryProviderId: 'gemini',
  });
  const routedSession = makeSession({
    id: 'session-routed',
    providerId: 'gemini',
  });
  const routedRun = makeRun({
    id: 'run-routed',
    sessionId: routedSession.id,
    providerId: 'gemini',
    prompt: 'route me',
  });

  const api: DaemonApi = {
    ...createUnusedDaemonApi(),
    recommendPrompt: async (input) => {
      calls.push(['recommendPrompt', input]);
      return { recommendation };
    },
    routePrompt: async (input) => {
      calls.push(['routePrompt', input]);
      return {
        recommendation,
        session: routedSession,
        runSnapshot: makeRunSnapshot(routedRun),
      };
    },
  };

  const flows = createControllerRunActionFlows({
    state,
    api,
    emitRunViewState: () => {},
    emitShellPanelsState: () => {},
    emitShellSummaryState: () => {},
    emitShellControlsState: () => {},
    syncRouteAction: () => {},
    syncResumeAction: () => {},
    syncApprovalPolicyControls: () => {},
    loadArchive: async () => {},
    selectRun: async () => {},
    refreshRun: async () => {},
    transitionToNewSession: async () => true,
    applyRunSnapshot: () => {},
    getSelectedPrompt: () => state.promptDraft.trim(),
    getSelectedWorkspacePath: () =>
      state.selectedSession?.workspacePath || state.workspacePathDraft.trim(),
    getPreferredProviderId: () =>
      state.selectedSession?.providerId || state.providerIdDraft,
    getRouteApprovalPolicy: () =>
      state.selectedSession?.approvalPolicy || state.sessionApprovalPolicyDraft,
    getRequiredTools: () => [...state.routingToolsDraft],
  });

  await flows.refreshRecommendation();
  await flows.routePrompt();

  assert.deepEqual(calls, [
    [
      'recommendPrompt',
      {
        prompt: 'route me',
        workspacePath: 'C:/workspace/demo',
        sessionId: null,
        preferredProviderId: 'gemini',
        requiredTools: ['workspace-read'],
      },
    ],
    [
      'routePrompt',
      {
        prompt: 'route me',
        workspacePath: 'C:/workspace/demo',
        sessionId: null,
        preferredProviderId: 'gemini',
        approvalPolicy: 'manual',
        requiredTools: ['workspace-read'],
      },
    ],
  ]);
}

async function main() {
  const checks: Array<[string, () => Promise<void>]> = [
    ['controls enable from draft state', validateControlsEnableFromDraftState],
    ['requesters resync run availability', validateRequestersResyncRunAvailability],
    ['start run creates session on demand', validateStartRunCreatesSessionOnDemand],
    ['draft routing works without a selected session', validateDraftRoutingWithoutSelectedSession],
  ];

  for (const [label, check] of checks) {
    await check();
    console.log(`ok - ${label}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
