export const DEFAULT_DAEMON_PORT = 4120;
export const DEFAULT_PROVIDER_ID = 'freebuff';
export const CODEWAVE_PROTOCOL_VERSION = 1;
export const CODEWAVE_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const CODEWAVE_MAX_SSE_REPLAY_EVENTS = 500;
export const CODEWAVE_MAX_STEERING_PROMPT_CHARS = 20_000;
export const CODEWAVE_DEFAULT_TRANSCRIPT_MESSAGES = 100;
export const CODEWAVE_MAX_TRANSCRIPT_MESSAGES = 200;
export const CODEWAVE_MAX_WORKSPACE_PREVIEW_BYTES = 256 * 1024;
export const CODEWAVE_MAX_WORKSPACE_FILE_BYTES = 1024 * 1024;

export const DAEMON_CLIENT_SCOPES = [
  'runtime:read',
  'providers:read',
  'providers:write',
  'sessions:read',
  'sessions:write',
  'runs:read',
  'runs:write',
  'orchestration:read',
  'orchestration:write',
  'tools:read',
  'workspace:read',
  'workspace:write',
  'approvals:write',
] as const;
export type DaemonClientScope = (typeof DAEMON_CLIENT_SCOPES)[number];

export const DAEMON_CAPABILITIES = [
  'scoped-handshake',
  'durable-idempotency',
  'provider-policy-revisions',
  'event-cursor-replay',
  'queued-steering',
  'session-recovery',
  'orchestration',
  'workspace-files',
  'append-only-transcripts',
] as const;
export type DaemonCapability = (typeof DAEMON_CAPABILITIES)[number];

export interface ClientHandshakeRequest {
  clientName: string;
  clientVersion: string;
  protocolVersion: number;
  requestedScopes: DaemonClientScope[];
}

export interface DaemonProtocolLimits {
  maxRequestBytes: number;
  maxSseReplayEvents: number;
  maxSteeringPromptChars: number;
  defaultTranscriptMessages: number;
  maxTranscriptMessages: number;
  idempotencyKeyMinLength: number;
  idempotencyKeyMaxLength: number;
  connectionTtlSeconds: number;
  maxClientConnections: number;
  maxWorkspacePreviewBytes: number;
  maxWorkspaceFileBytes: number;
}

export interface ClientHandshakeResponse {
  connectionId: string;
  protocolVersion: number;
  serverName: 'CodeWave daemon';
  serverVersion: string;
  capabilities: DaemonCapability[];
  availableScopes: DaemonClientScope[];
  grantedScopes: DaemonClientScope[];
  limits: DaemonProtocolLimits;
  issuedAt: string;
  expiresAt: string;
}

export interface DaemonProtocolInfo {
  version: number;
  serverVersion: string;
  capabilities: DaemonCapability[];
  availableScopes: DaemonClientScope[];
  limits: DaemonProtocolLimits;
}

export type BuiltinProviderId = 'qwen' | 'gemini' | 'opencode' | 'freebuff';
export type CustomAcpProviderId = `acp.${string}`;
export type ProviderId = BuiltinProviderId | CustomAcpProviderId;
export const PROVIDER_IDS: BuiltinProviderId[] = [
  'freebuff',
  'opencode',
  'qwen',
  'gemini',
];
export function isBuiltinProviderId(value: unknown): value is BuiltinProviderId {
  return (
    typeof value === 'string' &&
    PROVIDER_IDS.includes(value as BuiltinProviderId)
  );
}
export function isCustomAcpProviderId(
  value: unknown,
): value is CustomAcpProviderId {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    /^acp\.[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value)
  );
}
export function isProviderId(value: unknown): value is ProviderId {
  return isBuiltinProviderId(value) || isCustomAcpProviderId(value);
}
export type ProviderAccessMode =
  | 'free-cloud'
  | 'local-or-byok'
  | 'paid-or-byok';
export type ProviderDataBoundary =
  | 'cloud-ad-supported'
  | 'local-or-user-configured'
  | 'provider-managed';
export type ProviderConfigurationSource =
  | 'default'
  | 'file'
  | 'environment';
export type ProviderRuntimeStatus =
  | 'ready'
  | 'disabled'
  | 'setup-required'
  | 'unavailable';
export type EventSource = ProviderId | 'system' | 'plugin';
export type RoutingToolRequirement =
  | 'workspace-read'
  | 'workspace-write'
  | 'shell'
  | 'network'
  | 'mcp';
export type ToolDescriptorSource = 'internal' | 'mcp' | 'provider' | 'plugin';
export type ToolPermissionModel = 'auto' | 'ask' | 'deny';
export type McpServerTransport = 'stdio' | 'http';
export type ToolPlaneScope = 'workspace' | 'session';
export type OrchestrationStrategy =
  | 'balanced'
  | 'tool-first'
  | 'analysis-first'
  | 'checkpoint-first';
export type OrchestrationRole =
  | 'main'
  | 'planner'
  | 'reviewer'
  | 'verifier'
  | 'researcher';
export type OrchestrationKind =
  | 'route'
  | 'review'
  | 'verify'
  | 'delegate'
  | 'handoff';
export type RunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type ArtifactKind = 'text' | 'json' | 'transcript' | 'plan';
export type ApprovalStatus = 'requested' | 'approved' | 'denied';
export type ApprovalBehavior = 'allow' | 'deny';
export type ApprovalPolicy = 'manual' | 'allow' | 'deny';
export type RunMode = 'execute' | 'plan';
export type RunSteeringStatus = 'queued' | 'applied' | 'failed' | 'cancelled';
export type ProviderSteeringSupport =
  | 'unsupported'
  | 'runtime-negotiated'
  | 'native';
export type ProviderSteeringDisposition =
  | 'accepted'
  | 'rejected'
  | 'unavailable';
export type SessionRecoveryKind = 'session' | 'checkpoint';
export type ToolInvocationStatus =
  | 'requested'
  | 'started'
  | 'completed'
  | 'denied';
export type TranscriptRole = 'user' | 'assistant' | 'system';

export type WorkbenchEventType =
  | 'run.started'
  | 'run.provider.launched'
  | 'run.steering.queued'
  | 'run.steering.applied'
  | 'run.steering.failed'
  | 'run.output.delta'
  | 'message.created'
  | 'tool.registered'
  | 'tool.requested'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.denied'
  | 'approval.requested'
  | 'approval.resolved'
  | 'artifact.created'
  | 'checkpoint.saved'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'run.undo';

export interface SessionRecoveryMetadata {
  kind: SessionRecoveryKind;
  sourceSessionId: string;
  sourceCheckpointId: string | null;
  sourceProviderSessionId: string | null;
  sourceRunId: string | null;
}

export interface SessionOrchestrationMetadata {
  kind: OrchestrationKind;
  role: OrchestrationRole;
  sourceSessionId: string | null;
  sourceRunId: string | null;
  sourceProviderId: ProviderId | null;
}

export interface WorkbenchSession {
  id: string;
  workspacePath: string;
  providerId: ProviderId;
  providerConfigurationRevision: string;
  createdAt: string;
  providerSessionId: string | null;
  approvalPolicy: ApprovalPolicy;
  recovery: SessionRecoveryMetadata | null;
  orchestration: SessionOrchestrationMetadata | null;
}

export interface WorkbenchRun {
  id: string;
  sessionId: string;
  providerId: ProviderId;
  providerConfigurationRevision: string;
  prompt: string;
  status: RunStatus;
  mode: RunMode;
  preRunCommit: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface RunSteeringInput {
  id: string;
  sessionId: string;
  targetRunId: string;
  expectedRunId: string;
  providerConfigurationRevision: string;
  prompt: string;
  status: RunSteeringStatus;
  createdAt: string;
  appliedRunId: string | null;
  appliedAt: string | null;
  errorMessage: string | null;
}

export interface WorkbenchEvent {
  id: string;
  sequence?: number;
  sessionId: string;
  runId: string;
  timestamp: string;
  source: EventSource;
  type: WorkbenchEventType;
  payload: Record<string, unknown>;
}

export interface TranscriptMessage {
  id: string;
  sessionId: string;
  runId: string;
  sequence: number;
  parentMessageId: string | null;
  role: TranscriptRole;
  content: string;
  createdAt: string;
  sourceEventId: string | null;
  metadata: Record<string, unknown>;
}

export interface TranscriptWindow {
  sessionId: string;
  messages: TranscriptMessage[];
  hasMoreBefore: boolean;
  oldestSequence: number | null;
  newestSequence: number | null;
  totalCount: number;
}

export interface ArtifactRecord {
  id: string;
  sessionId: string;
  runId: string;
  kind: ArtifactKind;
  title: string;
  createdAt: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface ApprovalRecord {
  id: string;
  sessionId: string;
  runId: string;
  toolName: string;
  toolUseId: string | null;
  status: ApprovalStatus;
  reason: string | null;
  createdAt: string;
  resolvedAt: string | null;
  payload: Record<string, unknown>;
}

export interface CheckpointRecord {
  id: string;
  sessionId: string;
  runId: string;
  providerSessionId: string | null;
  createdAt: string;
  title: string;
  metadata: Record<string, unknown>;
}

export interface ToolInvocationRecord {
  id: string;
  sessionId: string;
  runId: string;
  toolUseId: string | null;
  toolName: string;
  status: ToolInvocationStatus;
  createdAt: string;
  updatedAt: string;
  input: Record<string, unknown>;
  output: unknown;
  detail: string | null;
  metadata: Record<string, unknown>;
}

export interface SessionToolRegistration {
  id: string;
  sessionId: string;
  providerId: ProviderId;
  toolName: string;
  requirement: RoutingToolRequirement;
  source: ToolDescriptorSource;
  firstSeenAt: string;
  lastSeenAt: string;
  lastRunId: string;
  lastStatus: ToolInvocationStatus;
  seenCount: number;
  metadata: Record<string, unknown>;
}

export interface ProviderCapabilities {
  daemonApprovalMediation: boolean;
  resumableSessions: boolean;
  checkpointEvents: boolean;
  inFlightSteering: ProviderSteeringSupport;
}

export interface ProviderHealth {
  providerId: ProviderId;
  available: boolean;
  detail: string;
  capabilities: ProviderCapabilities;
  enabled?: boolean;
  configured?: boolean;
  status?: ProviderRuntimeStatus;
  accessMode?: ProviderAccessMode;
  priority?: number;
  isDefault?: boolean;
  lastCheckedAt?: string;
  latencyMs?: number;
}

export interface ProviderConfiguration {
  providerId: ProviderId;
  displayName: string;
  profileKind: 'builtin' | 'custom';
  adapterKind: 'native' | 'acp-v1';
  enabled: boolean;
  priority: number;
  accessMode: ProviderAccessMode;
  dataBoundary: ProviderDataBoundary;
  requiresExplicitEnable: boolean;
  command: string | null;
  args: string[];
  setupHint: string;
  documentationUrl: string;
  configurationSource: ProviderConfigurationSource;
}

export interface ProviderRegistrySnapshot {
  version: 2;
  revision: string;
  defaultProviderId: ProviderId;
  configPath: string;
  providers: ProviderConfiguration[];
}

export interface ToolDescriptor {
  id: string;
  name: string;
  providerId: ProviderId | null;
  source: ToolDescriptorSource;
  requirement: RoutingToolRequirement;
  permissionModel: ToolPermissionModel;
  available: boolean;
  detail: string;
  observedInvocationCount: number;
  observedSuccessCount: number;
}

export interface ProviderToolCapability {
  name: string;
  requirement: RoutingToolRequirement;
  source: ToolDescriptorSource;
  permissionModel: ToolPermissionModel;
  detail: string;
}

export interface ProviderConnectedTool {
  name: string;
  requirement: RoutingToolRequirement;
  source: ToolDescriptorSource;
  detail: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderConnectedToolQuery {
  workspacePath: string;
  sessionId: string;
  providerSessionId: string | null;
}

export interface ToolPlaneProviderSignal {
  providerId: ProviderId;
  available: boolean;
  readyTools: RoutingToolRequirement[];
  missingTools: RoutingToolRequirement[];
  recentInvocationCount: number;
  recentSuccessCount: number;
  sessionRegisteredTools: RoutingToolRequirement[];
  sessionRegisteredCount: number;
  summary: string;
}

export interface ToolRegistryEntry {
  requirement: RoutingToolRequirement;
  enabled: boolean;
  permissionModel: ToolPermissionModel;
  source: 'default' | 'workspace';
  detail: string;
}

export interface McpServerStatus {
  id: string;
  enabled: boolean;
  transport: McpServerTransport;
  command: string | null;
  url: string | null;
  available: boolean;
  detail: string;
}

export interface ToolPlaneSnapshot {
  generatedAt: string;
  scope: ToolPlaneScope;
  sessionId: string | null;
  workspacePath: string;
  registryPath: string | null;
  registryEntries: ToolRegistryEntry[];
  mcpServers: McpServerStatus[];
  registeredSessionTools: SessionToolRegistration[];
  tools: ToolDescriptor[];
  providers: ToolPlaneProviderSignal[];
}

export interface ProviderApprovalRequest {
  toolName: string;
  toolUseId: string | null;
  input: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ProviderApprovalDecision {
  behavior: ApprovalBehavior | 'cancel';
  message?: string;
  updatedInput?: Record<string, unknown>;
}

export interface ProviderSessionUpdate {
  providerSessionId?: string | null;
}

export interface ProviderRunContext {
  launchAttemptId: string;
  session: WorkbenchSession;
  run: WorkbenchRun;
  emitEvent: (event: WorkbenchEvent) => Promise<void>;
  updateSession: (updates: ProviderSessionUpdate) => Promise<void>;
  requestApproval: (
    request: ProviderApprovalRequest,
  ) => Promise<ProviderApprovalDecision>;
}

export interface ProviderRunHandle {
  cancel: () => Promise<void>;
  launched?: Promise<{
    launchId: string;
    protocol: string;
    acknowledgedAt: string;
  }>;
  steer?: (input: {
    steeringId: string;
    prompt: string;
    createdAt: string;
  }) => Promise<{
    disposition: ProviderSteeringDisposition;
    detail?: string;
  }>;
}

export interface ProviderAdapter {
  id: ProviderId;
  displayName: string;
  capabilities: () => Promise<ProviderCapabilities>;
  healthCheck: () => Promise<ProviderHealth>;
  toolCatalog: () => Promise<ProviderToolCapability[]>;
  enumerateConnectedTools: (
    query: ProviderConnectedToolQuery,
  ) => Promise<ProviderConnectedTool[]>;
  startRun: (context: ProviderRunContext) => Promise<ProviderRunHandle>;
}

export interface RuntimeInfo {
  defaultWorkspacePath: string;
  dataDirectory: string;
  defaultProviderId: ProviderId;
  recommendedProviderId: ProviderId;
  providerRegistry: ProviderRegistrySnapshot;
  providers: ProviderHealth[];
  protocol: DaemonProtocolInfo;
}

export interface UpdateProviderConfigurationRequest {
  expectedProviderRevision: string;
  enabled?: boolean;
  priority?: number;
  command?: string | null;
  args?: string[];
  displayName?: string;
}

export interface CreateAcpProviderRequest {
  expectedProviderRevision: string;
  providerId: CustomAcpProviderId;
  displayName: string;
  command: string;
  args?: string[];
  priority?: number;
}

export interface UpdateDefaultProviderRequest {
  providerId: ProviderId;
  expectedProviderRevision: string;
}

export interface WorkspaceEntryRecord {
  name: string;
  relativePath: string;
  kind: 'file' | 'folder';
}

export interface WorkspaceEntriesResponse {
  workspacePath: string;
  relativePath: string;
  entries: WorkspaceEntryRecord[];
}

export interface WorkspaceFilePreviewResponse {
  workspacePath: string;
  relativePath: string;
  name: string;
  content: string;
  encoding: 'utf-8';
  byteLength: number;
  contentByteLength: number;
  truncated: boolean;
  maxPreviewBytes: number;
  version: string;
}

export interface CreateWorkspaceFileRequest {
  workspacePath: string;
  parentPath?: string | null;
  name: string;
  content?: string;
}

export interface CreateWorkspaceFileResponse {
  workspacePath: string;
  relativePath: string;
  name: string;
  byteLength: number;
  created: true;
  version: string;
}

export interface MutationReceiptStatusResponse {
  key: string;
  operation: string;
  requestHash: string;
  state: 'pending' | 'completed' | 'outcome_unknown' | 'response_redacted';
  statusCode: number | null;
  createdAt: string;
  finalizedAt: string | null;
  provenance: {
    protocolVersion: number;
    clientName: string;
    clientVersion: string;
    canonicalizationVersion: 'codewave-canonical-json-v1';
    requestSchemaVersion: 'codewave-daemon-mutation-v1';
  };
}

export interface UpdateWorkspaceFileRequest {
  workspacePath: string;
  targetPath: string;
  content: string;
  expectedVersion: string;
}

export interface UpdateWorkspaceFileResponse {
  workspacePath: string;
  relativePath: string;
  name: string;
  byteLength: number;
  version: string;
  updated: true;
}

export interface OrchestrationRecommendation {
  prompt: string;
  workspacePath: string;
  preferredProviderId: ProviderId | null;
  requiredTools: RoutingToolRequirement[];
  primaryProviderId: ProviderId;
  fallbackProviderId: ProviderId | null;
  strategy: OrchestrationStrategy;
  confidence: number;
  reason: string;
  signals: string[];
}

export interface SessionSnapshot {
  session: WorkbenchSession;
  runs: WorkbenchRun[];
}

export interface RunUndoInfo {
  available: boolean;
  detail: string | null;
}

export interface RunSnapshot {
  run: WorkbenchRun;
  events: WorkbenchEvent[];
  transcript: TranscriptWindow;
  artifacts: ArtifactRecord[];
  approvals: ApprovalRecord[];
  checkpoints: CheckpointRecord[];
  steering: RunSteeringInput[];
  toolInvocations: ToolInvocationRecord[];
  contextChars: number;
  undo: RunUndoInfo;
}

export interface ArchiveSessionSummary {
  session: WorkbenchSession;
  runCount: number;
  completedRunCount: number;
  failedRunCount: number;
  latestRun: WorkbenchRun | null;
}

export interface ArchiveSnapshot {
  sessions: ArchiveSessionSummary[];
}

export interface ToolPlaneResponse {
  snapshot: ToolPlaneSnapshot;
}

export interface OrchestrationFlowSessionSummary
  extends ArchiveSessionSummary {
  depth: number;
  parentSessionId: string | null;
}

export interface OrchestrationFlowSummary {
  flowId: string;
  rootSession: WorkbenchSession;
  rootLatestRun: WorkbenchRun | null;
  latestActivityAt: string;
  sessions: OrchestrationFlowSessionSummary[];
}

export interface OrchestrationBoardSnapshot {
  flows: OrchestrationFlowSummary[];
}

export interface CreateSessionRequest {
  workspacePath: string;
  providerId: ProviderId;
  expectedProviderRevision: string;
  approvalPolicy?: ApprovalPolicy;
  orchestration?: SessionOrchestrationMetadata | null;
}

export interface RecommendPromptRequest {
  prompt: string;
  workspacePath: string;
  sessionId?: string | null;
  preferredProviderId?: ProviderId | null;
  requiredTools?: RoutingToolRequirement[];
}

export interface RecommendPromptResponse {
  recommendation: OrchestrationRecommendation;
}

export interface UpdateSessionRequest {
  expectedProviderRevision: string;
  approvalPolicy?: ApprovalPolicy;
  providerId?: ProviderId;
}

export interface StartRunRequest {
  prompt: string;
  expectedProviderRevision: string;
  mode?: RunMode;
}

export interface SteerRunRequest {
  prompt: string;
  expectedRunId: string;
  expectedProviderRevision: string;
}

export interface SteerRunResponse {
  steering: RunSteeringInput;
  delivery: 'native' | 'queued';
  runSnapshot: RunSnapshot;
}

export interface UndoRunResponse {
  run: WorkbenchRun;
  detail: string;
}

export interface CompareRunLane {
  sessionId: string;
  providerId: ProviderId;
  runSnapshot: RunSnapshot;
}

export interface CompareRunRequest {
  prompt: string;
  workspacePath: string;
  providers: ProviderId[];
  expectedProviderRevision: string;
  approvalPolicy?: ApprovalPolicy;
}

export interface CompareRunResponse {
  lanes: CompareRunLane[];
}

export interface RoutePromptRequest {
  prompt: string;
  workspacePath: string;
  expectedProviderRevision: string;
  sessionId?: string | null;
  preferredProviderId?: ProviderId | null;
  approvalPolicy?: ApprovalPolicy;
  requiredTools?: RoutingToolRequirement[];
}

export interface RoutePromptResponse {
  recommendation: OrchestrationRecommendation;
  session: WorkbenchSession;
  runSnapshot: RunSnapshot;
}

export interface FollowUpRunRequest {
  kind: Extract<OrchestrationKind, 'review' | 'verify'>;
  expectedProviderRevision: string;
  preferredProviderId?: ProviderId | null;
  approvalPolicy?: ApprovalPolicy;
}

export interface FollowUpRunResponse {
  recommendation: OrchestrationRecommendation;
  session: WorkbenchSession;
  runSnapshot: RunSnapshot;
}

export interface DelegateRunRequest {
  prompt: string;
  role: Exclude<OrchestrationRole, 'main'>;
  expectedProviderRevision: string;
  preferredProviderId?: ProviderId | null;
  approvalPolicy?: ApprovalPolicy;
  requiredTools?: RoutingToolRequirement[];
}

export interface DelegateRunResponse {
  recommendation: OrchestrationRecommendation;
  session: WorkbenchSession;
  runSnapshot: RunSnapshot;
}

export interface HandoffRunRequest {
  prompt: string;
  expectedProviderRevision: string;
  preferredProviderId?: ProviderId | null;
  approvalPolicy?: ApprovalPolicy;
  requiredTools?: RoutingToolRequirement[];
}

export interface HandoffRunResponse {
  recommendation: OrchestrationRecommendation;
  session: WorkbenchSession;
  runSnapshot: RunSnapshot;
}

export interface ResolveApprovalRequest {
  decision: Exclude<ApprovalStatus, 'requested'>;
  reason?: string;
}

export interface RecoverSessionResponse {
  session: WorkbenchSession;
}

export interface RecoverSessionRequest {
  expectedProviderRevision: string;
}

export interface DeleteSessionResponse {
  deletedSessionId: string;
}

export interface JsonError {
  error: string;
  code?: string;
  currentProviderRevision?: string;
  requiredScope?: DaemonClientScope;
  supportedProtocolVersions?: number[];
}

export function isDaemonClientScope(
  value: unknown,
): value is DaemonClientScope {
  return (
    typeof value === 'string' &&
    DAEMON_CLIENT_SCOPES.includes(value as DaemonClientScope)
  );
}

const ROUTING_TOOL_REQUIREMENTS: RoutingToolRequirement[] = [
  'workspace-read',
  'workspace-write',
  'shell',
  'network',
  'mcp',
];

export function isRoutingToolRequirement(
  value: unknown,
): value is RoutingToolRequirement {
  return (
    typeof value === 'string' &&
    ROUTING_TOOL_REQUIREMENTS.includes(value as RoutingToolRequirement)
  );
}

function stringifyLowerCase(value: unknown): string {
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return '';
  }
}

export function inferRoutingToolRequirement({
  toolName,
  detail = null,
  input = {},
  metadata = {},
  explicitRequirementCandidates = [],
}: {
  toolName: string;
  detail?: string | null;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  explicitRequirementCandidates?: unknown[];
}): RoutingToolRequirement | null {
  for (const candidate of explicitRequirementCandidates) {
    if (isRoutingToolRequirement(candidate)) {
      return candidate;
    }
  }

  const normalizedToolName = toolName.trim().toLowerCase();
  if (!normalizedToolName) {
    return null;
  }

  const normalizedDetail = detail?.toLowerCase() ?? '';
  const contextJson = stringifyLowerCase({ input, metadata });
  const haystack = `${normalizedToolName} ${normalizedDetail} ${contextJson}`;

  if (
    normalizedToolName === 'mcp' ||
    normalizedToolName.startsWith('mcp__') ||
    haystack.includes('"source":"mcp"') ||
    haystack.includes('"toolsource":"mcp"')
  ) {
    return 'mcp';
  }

  if (
    /(?:^|[^a-z0-9])(shell|run_command|terminal|command|bash|powershell|cmd(?:\.exe)?|exec)(?:$|[^a-z0-9])/.test(
      haystack,
    )
  ) {
    return 'shell';
  }

  if (
    /(?:^|[^a-z0-9])(read_file|read_many_files|search_file|grep|glob|list_dir|list_directory|stat_file)(?:$|[^a-z0-9])/.test(
      haystack,
    )
  ) {
    return 'workspace-read';
  }

  if (
    /(?:^|[^a-z0-9])(write_file|edit_file|replace|patch|apply_patch|create_file|move_file|delete_file)(?:$|[^a-z0-9])/.test(
      haystack,
    )
  ) {
    return 'workspace-write';
  }

  if (
    /(?:^|[^a-z0-9])(fetch|http|request|curl|web|search_web|network)(?:$|[^a-z0-9])/.test(
      haystack,
    )
  ) {
    return 'network';
  }

  return null;
}
