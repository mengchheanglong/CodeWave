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
} from '@codewave/protocol';
import type { DaemonApi } from '../apps/web/src/lib/daemon-api.js';
import { createControllerRunActionFlows } from '../apps/web/src/lib/controller-run-action-flows.js';
import { createControllerRequesters } from '../apps/web/src/lib/controller-requesters.js';
import { createControllerRuntimeSessionFlows } from '../apps/web/src/lib/controller-runtime-session-flows.js';
import { createInitialShellState } from '../apps/web/src/lib/controller-shell-state.js';
import { createControllerUiSync } from '../apps/web/src/lib/controller-ui-sync.js';

const NOW = '2026-04-05T00:00:00.000Z';

function makeCapabilities(): ProviderCapabilities {
  return {
    daemonApprovalMediation: true,
    resumableSessions: true,
    checkpointEvents: true,
    inFlightSteering: 'native',
  };
}

function makeRuntime(): RuntimeInfo {
  const revision = 'sha256:shell-validation';
  return {
    defaultWorkspacePath: 'C:/workspace',
    dataDirectory: 'C:/workspace/.codewave',
    defaultProviderId: 'freebuff',
    recommendedProviderId: 'qwen',
    providerRegistry: {
      version: 1,
      revision,
      defaultProviderId: 'freebuff',
      configPath: 'C:/workspace/.codewave/providers.json',
      providers: [
        {
          providerId: 'qwen',
          displayName: 'Qwen Code',
          enabled: true,
          priority: 30,
          accessMode: 'paid-or-byok',
          dataBoundary: 'provider-managed',
          requiresExplicitEnable: true,
          command: null,
          configurationSource: 'file',
          setupHint: 'configured for validation',
          documentationUrl: 'https://example.test/qwen',
        },
        {
          providerId: 'gemini',
          displayName: 'Gemini CLI',
          enabled: true,
          priority: 40,
          accessMode: 'paid-or-byok',
          dataBoundary: 'provider-managed',
          requiresExplicitEnable: true,
          command: null,
          configurationSource: 'file',
          setupHint: 'configured for validation',
          documentationUrl: 'https://example.test/gemini',
        },
      ],
    },
    protocol: {
      version: 1,
      serverVersion: 'test',
      capabilities: ['scoped-handshake'],
      availableScopes: ['runtime:read'],
      limits: {
        maxRequestBytes: 2 * 1024 * 1024,
        maxSseReplayEvents: 500,
        maxSteeringPromptChars: 20_000,
        defaultTranscriptMessages: 100,
        maxTranscriptMessages: 200,
        idempotencyKeyMinLength: 8,
        idempotencyKeyMaxLength: 128,
        connectionTtlSeconds: 43_200,
        maxClientConnections: 256,
      },
    },
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
    providerConfigurationRevision: 'sha256:shell-validation',
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
    providerConfigurationRevision: 'sha256:shell-validation',
    prompt: 'hello',
    status: 'running',
    mode: 'execute',
    preRunCommit: null,
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
    transcript: {
      sessionId: run.sessionId,
      messages: [],
      hasMoreBefore: false,
      oldestSequence: null,
      newestSequence: null,
      totalCount: 0,
    },
    artifacts: [],
    approvals: [],
    checkpoints: [],
    steering: [],
    toolInvocations: [],
    contextChars: 0,
    undo: { available: false, detail: null },
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

async function validateSelectedSessionRestoresItsWorkspace() {
  const state = createInitialShellState();
  state.runtime = makeRuntime();
  state.workspacePathDraft = 'C:/daemon/startup-root';
  const session = makeSession({ workspacePath: 'C:/workspace/restored-thread' });
  const api: DaemonApi = {
    ...createUnusedDaemonApi(),
    getSession: async () => ({ session, runs: [] }),
    getToolPlane: async (query) => {
      loadedToolPlanePath = query?.workspacePath;
      return {
        snapshot: {
          generatedAt: NOW,
          scope: 'session',
          sessionId: session.id,
          workspacePath: query?.workspacePath ?? '',
          registryPath: null,
          registryEntries: [],
          mcpServers: [],
          registeredSessionTools: [],
          tools: [],
          providers: [],
        },
      };
    },
  };
  let loadedToolPlanePath: string | undefined;

  const flows = createControllerRuntimeSessionFlows({
    state,
    api,
    emitRunViewState: () => {},
    emitShellPanelsState: () => {},
    syncResumeAction: () => {},
    syncApprovalPolicyControls: () => {},
    syncFollowUpActions: () => {},
    syncRunAction: () => {},
    syncSessionCreationControls: () => {},
    syncCancelAction: () => {},
    setSessionsUnavailableState: () => {},
    setArchiveUnavailableState: () => {},
    setToolPlaneUnavailableState: () => {},
    clearSessionSelectionState: () => {},
    clearRunSelectionView: () => {},
    closeStream: () => {},
    refreshRecommendation: async () => {},
    selectRun: async () => {},
    transitionToNewSession: async () => true,
  });

  const selected = await flows.selectSession(session.id);

  assert.equal(selected, true);
  assert.equal(state.selectedSession?.workspacePath, 'C:/workspace/restored-thread');
  assert.equal(state.workspacePathDraft, 'C:/workspace/restored-thread');
  assert.equal(loadedToolPlanePath, 'C:/workspace/restored-thread');
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
        expectedProviderRevision: 'sha256:shell-validation',
        approvalPolicy: 'manual',
      },
    ],
    [
      'startRun',
      'session-1',
      {
        mode: 'execute',
        prompt: 'implement this',
        expectedProviderRevision: 'sha256:shell-validation',
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
        expectedProviderRevision: 'sha256:shell-validation',
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
    ['selected session restores its workspace', validateSelectedSessionRestoresItsWorkspace],
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
