import type {
  ApprovalRecord,
  ArtifactRecord,
  ArchiveSessionSummary,
  CheckpointRecord,
  McpServerStatus,
  OrchestrationFlowSessionSummary,
  OrchestrationFlowSummary,
  ProviderCapabilities,
  ProviderId,
  SessionToolRegistration,
  ToolInvocationRecord,
  ToolPlaneProviderSignal,
  ToolPlaneSnapshot,
  WorkbenchEvent,
  WorkbenchRun,
  WorkbenchSession,
} from '@qwemini/protocol';
import type {
  ShellPanelsState,
} from './shell-panels-state.js';
import type { RunViewState } from './run-view-state.js';

type ApprovalPayloadView = NonNullable<
  ShellPanelsState['approvals'][number]['payload']
>;
type ApprovalPayloadMetadataView = NonNullable<ApprovalPayloadView['metadata']>;
type ApprovalSuggestionView =
  ApprovalPayloadMetadataView['permissionSuggestions'][number];
type ToolPlaneSnapshotView = NonNullable<ShellPanelsState['toolPlane']>;
type SessionToolRegistrationView =
  ToolPlaneSnapshotView['registeredSessionTools'][number];
type SessionToolRegistrationMetadataView = NonNullable<
  SessionToolRegistrationView['metadata']
>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function toRunSummary(
  run: WorkbenchRun | null,
): RunViewState['runs'][number] | null {
  if (!run) {
    return null;
  }

  return {
    id: run.id,
    status: run.status,
    mode: run.mode,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    prompt: run.prompt,
  };
}

function toRunEvent(event: WorkbenchEvent): RunViewState['events'][number] {
  return {
    type: event.type,
    timestamp: event.timestamp,
    payload: event.payload,
  };
}

export function toProviderCapabilities(
  capabilities: ProviderCapabilities | null,
): ShellPanelsState['selectedSessionCapabilities'] {
  if (!capabilities) {
    return null;
  }

  return {
    daemonApprovalMediation: capabilities.daemonApprovalMediation,
    resumableSessions: capabilities.resumableSessions,
    checkpointEvents: capabilities.checkpointEvents,
  };
}

function toSessionOrchestration(
  orchestration: WorkbenchSession['orchestration'],
): ShellPanelsState['recentSessions'][number]['orchestration'] {
  if (!orchestration) {
    return null;
  }

  return {
    kind: orchestration.kind,
    role: orchestration.role,
    sourceRunId: orchestration.sourceRunId,
  };
}

function toSessionRecovery(
  recovery: WorkbenchSession['recovery'],
): ShellPanelsState['recentSessions'][number]['recovery'] {
  if (!recovery) {
    return null;
  }

  return {
    kind: recovery.kind,
    sourceSessionId: recovery.sourceSessionId,
    sourceCheckpointId: recovery.sourceCheckpointId,
  };
}

function toSessionSummary(
  session: WorkbenchSession,
  latestRun: WorkbenchRun | null = null,
): ShellPanelsState['recentSessions'][number] {
  return {
    id: session.id,
    providerId: session.providerId,
    workspacePath: session.workspacePath,
    approvalPolicy: session.approvalPolicy,
    providerSessionId: session.providerSessionId,
    latestRunPrompt: latestRun?.prompt ?? null,
    orchestration: toSessionOrchestration(session.orchestration),
    recovery: toSessionRecovery(session.recovery),
  };
}

function toArchiveRunSummary(
  run: WorkbenchRun | null,
): ShellPanelsState['archiveSessions'][number]['latestRun'] {
  if (!run) {
    return null;
  }

  return {
    status: run.status,
    prompt: run.prompt,
  };
}

function toArchiveSessionSummary(
  summary: ArchiveSessionSummary,
): ShellPanelsState['archiveSessions'][number] {
  return {
    session: toSessionSummary(summary.session),
    runCount: summary.runCount,
    completedRunCount: summary.completedRunCount,
    failedRunCount: summary.failedRunCount,
    latestRun: toArchiveRunSummary(summary.latestRun),
  };
}

function toOrchestrationFlowSession(
  summary: OrchestrationFlowSessionSummary,
): ShellPanelsState['orchestrationFlows'][number]['sessions'][number] {
  return {
    session: toSessionSummary(summary.session),
    runCount: summary.runCount,
    latestRun: toArchiveRunSummary(summary.latestRun),
    depth: summary.depth,
  };
}

function toOrchestrationFlow(
  flow: OrchestrationFlowSummary,
): ShellPanelsState['orchestrationFlows'][number] {
  return {
    rootSession: toSessionSummary(flow.rootSession),
    rootLatestRun: toArchiveRunSummary(flow.rootLatestRun),
    latestActivityAt: flow.latestActivityAt,
    sessions: flow.sessions.map((entry) => toOrchestrationFlowSession(entry)),
  };
}

function toApprovalSuggestion(
  value: unknown,
): ApprovalSuggestionView | null {
  const suggestion = asRecord(value);
  if (!suggestion) {
    return null;
  }

  return {
    label: typeof suggestion.label === 'string' ? suggestion.label : null,
  };
}

function toApprovalPayloadMetadata(
  value: unknown,
): ApprovalPayloadMetadataView | null {
  const metadata = asRecord(value);
  if (!metadata) {
    return null;
  }

  return {
    permissionSuggestions: Array.isArray(metadata.permissionSuggestions)
      ? metadata.permissionSuggestions
          .map((entry) => toApprovalSuggestion(entry))
          .filter(
            (entry): entry is ApprovalSuggestionView => entry !== null,
          )
      : [],
  };
}

function toApprovalPayload(
  payload: ApprovalRecord['payload'],
): ShellPanelsState['approvals'][number]['payload'] {
  const payloadRecord = asRecord(payload);
  if (!payloadRecord) {
    return null;
  }

  return {
    input: payloadRecord.input,
    metadata: toApprovalPayloadMetadata(payloadRecord.metadata),
  };
}

function toApproval(
  approval: ApprovalRecord,
): ShellPanelsState['approvals'][number] {
  return {
    id: approval.id,
    toolName: approval.toolName,
    status: approval.status,
    reason: approval.reason,
    payload: toApprovalPayload(approval.payload),
  };
}

function toCheckpoint(
  checkpoint: CheckpointRecord,
): ShellPanelsState['checkpoints'][number] {
  return {
    id: checkpoint.id,
    title: checkpoint.title,
    createdAt: checkpoint.createdAt,
    metadata: checkpoint.metadata,
    providerSessionId: checkpoint.providerSessionId,
  };
}

function toArtifact(
  artifact: ArtifactRecord,
): ShellPanelsState['artifacts'][number] {
  return {
    id: artifact.id,
    title: artifact.title,
    createdAt: artifact.createdAt,
    content: artifact.content,
  };
}

function toToolInvocation(
  tool: ToolInvocationRecord,
): ShellPanelsState['tools'][number] {
  return {
    toolName: tool.toolName,
    status: tool.status,
    toolUseId: tool.toolUseId,
    detail: tool.detail,
    input: tool.input,
    output: tool.output,
  };
}

function toSessionToolRegistrationMetadata(
  metadata: SessionToolRegistration['metadata'],
): SessionToolRegistrationMetadataView | null {
  const metadataRecord = asRecord(metadata);
  if (!metadataRecord) {
    return null;
  }

  return {
    confirmedBy:
      typeof metadataRecord.confirmedBy === 'string'
        ? metadataRecord.confirmedBy
        : null,
    registrationKind:
      typeof metadataRecord.registrationKind === 'string'
        ? metadataRecord.registrationKind
        : null,
  };
}

function toSessionToolRegistration(
  registration: SessionToolRegistration,
): SessionToolRegistrationView {
  return {
    providerId: registration.providerId,
    requirement: registration.requirement,
    metadata: toSessionToolRegistrationMetadata(registration.metadata),
  };
}

function toToolPlaneProvider(
  provider: ToolPlaneProviderSignal,
): ToolPlaneSnapshotView['providers'][number] {
  return {
    providerId: provider.providerId,
    readyTools: [...provider.readyTools],
  };
}

function toToolPlaneMcpServer(
  server: McpServerStatus,
): ToolPlaneSnapshotView['mcpServers'][number] {
  return {
    enabled: server.enabled,
    available: server.available,
  };
}

function toToolPlaneSnapshot(
  snapshot: ToolPlaneSnapshot | null,
): ShellPanelsState['toolPlane'] {
  if (!snapshot) {
    return null;
  }

  return {
    scope: snapshot.scope,
    sessionId: snapshot.sessionId,
    registryPath: snapshot.registryPath,
    mcpServers: snapshot.mcpServers.map((entry) => toToolPlaneMcpServer(entry)),
    providers: snapshot.providers.map((entry) => toToolPlaneProvider(entry)),
    registeredSessionTools: snapshot.registeredSessionTools.map((entry) =>
      toSessionToolRegistration(entry),
    ),
  };
}

export function buildRunViewState(input: {
  selectedSessionId: string | null;
  runs: WorkbenchRun[];
  selectedRun: WorkbenchRun | null;
  events: WorkbenchEvent[];
  contextChars: number;
  undoAvailable: boolean;
  undoDetail: string | null;
}): RunViewState {
  return {
    selectedSessionId: input.selectedSessionId,
    runs: input.runs.map((entry) => toRunSummary(entry)).filter(
      (entry): entry is RunViewState['runs'][number] => entry !== null,
    ),
    selectedRun: toRunSummary(input.selectedRun),
    events: input.events.map((entry) => toRunEvent(entry)),
    contextChars: input.contextChars,
    undoAvailable: input.undoAvailable,
    undoDetail: input.undoDetail,
  };
}

export function buildShellPanelsState(input: {
  selectedSessionId: string | null;
  selectedProviderId: ProviderId | null;
  selectedSessionCapabilities: ProviderCapabilities | null;
  recentSessions: WorkbenchSession[];
  recentSessionsMessage: string | null;
  archiveSessions: ArchiveSessionSummary[];
  orchestrationFlows: OrchestrationFlowSummary[];
  checkpoints: CheckpointRecord[];
  approvals: ApprovalRecord[];
  artifacts: ArtifactRecord[];
  tools: ToolInvocationRecord[];
  toolPlane: ToolPlaneSnapshot | null;
}): ShellPanelsState {
  const archiveBySessionId = new Map(
    input.archiveSessions.map((entry) => [entry.session.id, entry] as const),
  );

  return {
    selectedSessionId: input.selectedSessionId,
    selectedProviderId: input.selectedProviderId,
    selectedSessionCapabilities: toProviderCapabilities(
      input.selectedSessionCapabilities,
    ),
    recentSessions: input.recentSessions.map((entry) =>
      toSessionSummary(entry, archiveBySessionId.get(entry.id)?.latestRun ?? null),
    ),
    recentSessionsMessage: input.recentSessionsMessage,
    archiveSessions: input.archiveSessions.map((entry) =>
      toArchiveSessionSummary(entry),
    ),
    orchestrationFlows: input.orchestrationFlows.map((entry) =>
      toOrchestrationFlow(entry),
    ),
    checkpoints: input.checkpoints.map((entry) => toCheckpoint(entry)),
    approvals: input.approvals.map((entry) => toApproval(entry)),
    artifacts: input.artifacts.map((entry) => toArtifact(entry)),
    tools: input.tools.map((entry) => toToolInvocation(entry)),
    toolPlane: toToolPlaneSnapshot(input.toolPlane),
  };
}
