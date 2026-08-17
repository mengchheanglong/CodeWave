import type {
  DaemonProtocolInfo,
  ApprovalRecord,
  ArchiveSessionSummary,
  CheckpointRecord,
  McpServerStatus,
  OrchestrationFlowSessionSummary,
  OrchestrationFlowSummary,
  ProviderCapabilities,
  ProviderHealth,
  ProviderId,
  ProviderRegistrySnapshot,
  RoutingToolRequirement,
  SessionOrchestrationMetadata,
  SessionRecoveryMetadata,
  ToolInvocationRecord,
  ToolPlaneProviderSignal,
  ToolPlaneSnapshot,
  WorkbenchRun,
  WorkbenchSession,
} from '@codewave/protocol';

type SessionProjection = Pick<
  WorkbenchSession,
  'id' | 'providerId' | 'workspacePath' | 'approvalPolicy' | 'providerSessionId'
>;

type SessionOrchestrationView = Pick<
  SessionOrchestrationMetadata,
  'kind' | 'role' | 'sourceRunId'
>;

type SessionRecoveryView = Pick<
  SessionRecoveryMetadata,
  'kind' | 'sourceSessionId' | 'sourceCheckpointId'
>;

type SessionSummaryView = SessionProjection & {
  latestRunPrompt: string | null;
  orchestration: SessionOrchestrationView | null;
  recovery: SessionRecoveryView | null;
};

type CheckpointView = Pick<
  CheckpointRecord,
  'id' | 'title' | 'createdAt' | 'providerSessionId'
> & {
  metadata: unknown;
};

type ArtifactView = {
  id: string | null;
  title: string;
  createdAt: string;
  content: string;
};

type RunPromptProjection = Pick<WorkbenchRun, 'status' | 'prompt'>;

type ArchiveRunSummaryView = RunPromptProjection;

type ArchiveSessionSummaryView = Pick<
  ArchiveSessionSummary,
  'runCount' | 'completedRunCount' | 'failedRunCount'
> & {
  session: SessionSummaryView;
  latestRun: ArchiveRunSummaryView | null;
};

type OrchestrationFlowSessionView = Pick<
  OrchestrationFlowSessionSummary,
  'runCount' | 'depth'
> & {
  session: SessionSummaryView;
  latestRun: ArchiveRunSummaryView | null;
};

type OrchestrationFlowView = Pick<
  OrchestrationFlowSummary,
  'latestActivityAt'
> & {
  rootSession: SessionSummaryView;
  rootLatestRun: ArchiveRunSummaryView | null;
  sessions: OrchestrationFlowSessionView[];
};

type ApprovalSuggestionView = {
  label: string | null;
};

type ApprovalPayloadMetadataView = {
  permissionSuggestions: ApprovalSuggestionView[];
};

type ApprovalPayloadView = {
  input: unknown;
  metadata: ApprovalPayloadMetadataView | null;
};

type ApprovalView = Pick<
  ApprovalRecord,
  'id' | 'toolName' | 'status' | 'reason'
> & {
  payload: ApprovalPayloadView | null;
};

type ToolInvocationView = Pick<
  ToolInvocationRecord,
  'id' | 'toolUseId' | 'detail'
> & {
  toolName: string | null;
  status: ToolInvocationRecord['status'] | null;
  input: unknown;
  output: unknown;
};

type SessionToolRegistrationMetadataView = {
  confirmedBy: string | null;
  registrationKind: string | null;
};

type SessionToolRegistrationView = {
  providerId: ProviderId;
  requirement: RoutingToolRequirement | null;
  metadata: SessionToolRegistrationMetadataView | null;
};

type ToolPlaneProviderView = Pick<
  ToolPlaneProviderSignal,
  'providerId' | 'readyTools'
>;

type ToolPlaneMcpServerView = Pick<McpServerStatus, 'enabled' | 'available'>;

type ToolPlaneSnapshotProjection = Pick<
  ToolPlaneSnapshot,
  'scope' | 'sessionId' | 'registryPath'
>;

type ToolPlaneSnapshotView = ToolPlaneSnapshotProjection & {
  mcpServers: ToolPlaneMcpServerView[];
  providers: ToolPlaneProviderView[];
  registeredSessionTools: SessionToolRegistrationView[];
};

export type ShellPanelsState = {
  selectedSessionId: string | null;
  selectedProviderId: ProviderId | null;
  selectedSessionCapabilities: ProviderCapabilities | null;
  providerRegistry: ProviderRegistrySnapshot | null;
  daemonProtocol: DaemonProtocolInfo | null;
  providerHealth: ProviderHealth[];
  recentSessions: SessionSummaryView[];
  recentSessionsMessage: string | null;
  archiveSessions: ArchiveSessionSummaryView[];
  orchestrationFlows: OrchestrationFlowView[];
  checkpoints: CheckpointView[];
  approvals: ApprovalView[];
  artifacts: ArtifactView[];
  tools: ToolInvocationView[];
  toolPlane: ToolPlaneSnapshotView | null;
};

export const emptyShellPanelsState: ShellPanelsState = {
  selectedSessionId: null,
  selectedProviderId: null,
  selectedSessionCapabilities: null,
  providerRegistry: null,
  daemonProtocol: null,
  providerHealth: [],
  recentSessions: [],
  recentSessionsMessage: null,
  archiveSessions: [],
  orchestrationFlows: [],
  checkpoints: [],
  approvals: [],
  artifacts: [],
  tools: [],
  toolPlane: null,
};
