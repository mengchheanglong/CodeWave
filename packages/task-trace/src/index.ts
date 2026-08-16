import { createHash } from 'node:crypto';
import {
  isProviderId,
  isRoutingToolRequirement,
  type ApprovalPolicy,
  type ApprovalStatus,
  type EventSource,
  type OrchestrationKind,
  type OrchestrationRole,
  type OrchestrationStrategy,
  type ProviderId,
  type RoutingToolRequirement,
  type RunMode,
  type RunStatus,
  type SessionRecoveryKind,
  type ToolInvocationStatus,
  type WorkbenchEventType,
  type WorktreeTaskStatus,
} from '@codewave/protocol';

export const TASK_TRACE_SOURCE_VERSION = 'codewave-task-trace-source-v1' as const;
export const TASK_TRACE_PROJECTION_VERSION = 'codewave-task-trace-projection-v1' as const;
export const TASK_TRACE_REPORT_VERSION = 'codewave-task-trace-report-v1' as const;
export const TASK_TRACE_RULESET_VERSION = 'codewave-task-trace-rules-v1' as const;
export const TASK_TRACE_USAGE_VERSION = 'codewave-usage-v1' as const;

export type TraceAssertionStatus = 'pass' | 'fail' | 'unknown' | 'not_applicable';
export type TraceIntegrityStatus = 'pass' | 'fail';
export type TraceCompletenessStatus = 'complete' | 'partial';
export type TaskTraceOutcome = 'keep' | 'discard' | 'undecided';
export type EvidenceVersion = 'legacy' | 'v1';

export type RoutingReasonCode =
  | 'explicit-provider'
  | 'only-ready-provider'
  | 'strongest-tool-coverage'
  | 'checkpoint-capability'
  | 'execution-readiness'
  | 'analysis-readiness'
  | 'preferred-session-context'
  | 'policy-priority'
  | 'review-provider-separation'
  | 'verify-provider-selection'
  | 'delegate-provider-selection'
  | 'handoff-provider-selection'
  | 'recovery-continuity';

export interface TaskTraceCandidateSourceV1 {
  providerId: ProviderId;
  enabled: boolean;
  available: boolean;
  priority: number;
  requiredToolReadyCount: number;
  requiredToolCount: number;
  sessionRegisteredReadyCount: number;
  recentInvocationCount: number;
  recentSuccessCount: number;
  resumableSessions: boolean;
  checkpointEvents: boolean;
}

export interface TaskTraceRoutingDecisionSourceV1 {
  id: string;
  sessionId: string;
  firstRunId: string | null;
  decisionKind:
    | 'explicit'
    | 'automatic'
    | 'review'
    | 'verify'
    | 'delegate'
    | 'handoff'
    | 'recovery';
  algorithmVersion: string;
  providerConfigurationRevision: string;
  selectedProviderId: ProviderId;
  fallbackProviderId: ProviderId | null;
  preferredProviderId: ProviderId | null;
  strategy: OrchestrationStrategy;
  reasonCode: RoutingReasonCode;
  requiredTools: RoutingToolRequirement[];
  candidates: TaskTraceCandidateSourceV1[];
}

export interface TaskTraceSessionSourceV1 {
  id: string;
  worktreeTaskId: string;
  providerId: ProviderId;
  providerConfigurationRevision: string;
  approvalPolicy: ApprovalPolicy;
  routingEvidenceVersion: EvidenceVersion;
  recovery: {
    kind: SessionRecoveryKind;
    sourceSessionId: string;
    sourceCheckpointId: string | null;
    sourceRunId: string | null;
  } | null;
  orchestration: {
    kind: OrchestrationKind;
    role: OrchestrationRole;
    sourceSessionId: string | null;
    sourceRunId: string | null;
    sourceProviderId: ProviderId | null;
  } | null;
}

export interface TaskTraceRunSourceV1 {
  id: string;
  worktreeTaskId: string;
  sessionId: string;
  providerId: ProviderId;
  providerConfigurationRevision: string;
  mode: RunMode;
  status: RunStatus;
}

export interface TaskTraceEventSourceV1 {
  id: string;
  sessionId: string;
  runId: string;
  sequence: number;
  source: EventSource;
  type: WorkbenchEventType;
}

export interface TaskTraceApprovalSourceV1 {
  id: string;
  runId: string;
  toolUseId: string | null;
  status: ApprovalStatus;
  evidenceVersion: EvidenceVersion;
  requestedEventId: string | null;
  resolvedEventId: string | null;
}

export interface TaskTraceToolSourceV1 {
  id: string;
  runId: string;
  toolUseId: string | null;
  requirement: RoutingToolRequirement | null;
  status: ToolInvocationStatus;
  evidenceVersion: EvidenceVersion;
  requestedEventId: string | null;
  startedEventId: string | null;
  terminalEventId: string | null;
}

export interface TaskTraceUsageSourceV1 {
  runId: string;
  sourceEventId: string;
  schemaVersion: typeof TASK_TRACE_USAGE_VERSION;
  reporting: 'reported' | 'unreported' | 'invalid';
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  providerReportedTotalTokens: number | null;
}

export interface TaskTraceSourceProjectionV1 {
  schemaVersion: typeof TASK_TRACE_SOURCE_VERSION;
  evaluatedThrough: string;
  task: {
    id: string;
    status: WorktreeTaskStatus;
    updatedAt: string;
  };
  scope: {
    sessionIds: string[];
    runIds: string[];
    checkpointIds: string[];
  };
  sessions: TaskTraceSessionSourceV1[];
  runs: TaskTraceRunSourceV1[];
  events: TaskTraceEventSourceV1[];
  routingDecisions: TaskTraceRoutingDecisionSourceV1[];
  approvals: TaskTraceApprovalSourceV1[];
  tools: TaskTraceToolSourceV1[];
  usage: TaskTraceUsageSourceV1[];
  outcome: {
    evidenceVersion: EvidenceVersion;
    decision: TaskTraceOutcome;
    source: 'task-accept' | 'task-revert' | 'none';
    reviewVersion: string | null;
    receiptHash: string | null;
    acceptedCommitPresent: boolean;
    decidedAt: string | null;
  };
}

type TraceRef = `ref:sha256:${string}`;

export interface TaskTraceAssertionV1 {
  id:
    | 'CW-TT1'
    | 'CW-TT2'
    | 'CW-TT3'
    | 'CW-TT4'
    | 'CW-TT5'
    | 'CW-TT6'
    | 'CW-TT7'
    | 'CW-TT8';
  status: TraceAssertionStatus;
  reasonCode: string;
  evidenceRefs: string[];
}

export interface TaskTraceReportV1 {
  id: `trace:sha256:${string}`;
  schemaVersion: typeof TASK_TRACE_REPORT_VERSION;
  projectionVersion: typeof TASK_TRACE_PROJECTION_VERSION;
  rulesetVersion: typeof TASK_TRACE_RULESET_VERSION;
  subject: {
    kind: 'worktree-task';
    taskRef: TraceRef;
    taskStatus: WorktreeTaskStatus;
  };
  sourceDigest: `sha256:${string}`;
  evaluatedThrough: string;
  contentBoundary: 'metadata-only-v1';
  sourceCut: {
    taskUpdatedAt: string;
    runs: Array<{
      runRef: TraceRef;
      lastEventSequence: number;
      lastEventRef: TraceRef | null;
    }>;
  };
  projection: {
    sessions: Array<{
      sessionRef: TraceRef;
      providerId: ProviderId;
      providerConfigurationRevision: string;
      approvalPolicy: ApprovalPolicy;
      recovery: {
        kind: SessionRecoveryKind;
        sourceSessionRef: TraceRef;
        sourceCheckpointRef: TraceRef | null;
        sourceRunRef: TraceRef | null;
      } | null;
      orchestration: {
        kind: OrchestrationKind;
        role: OrchestrationRole;
        sourceSessionRef: TraceRef | null;
        sourceRunRef: TraceRef | null;
        sourceProviderId: ProviderId | null;
      } | null;
    }>;
    runs: Array<{
      runRef: TraceRef;
      sessionRef: TraceRef;
      providerId: ProviderId;
      providerConfigurationRevision: string;
      mode: RunMode;
      status: RunStatus;
      firstEventSequence: number | null;
      lastEventSequence: number | null;
      eventCount: number;
      terminalEventRef: TraceRef | null;
      terminalEventType: 'run.completed' | 'run.failed' | 'run.cancelled' | null;
    }>;
    routing: Array<{
      decisionRef: TraceRef;
      sessionRef: TraceRef;
      firstRunRef: TraceRef | null;
      decisionKind: TaskTraceRoutingDecisionSourceV1['decisionKind'];
      algorithmVersion: string;
      providerConfigurationRevision: string;
      selectedProviderId: ProviderId;
      fallbackProviderId: ProviderId | null;
      preferredProviderId: ProviderId | null;
      strategy: OrchestrationStrategy;
      reasonCode: RoutingReasonCode;
      requiredTools: RoutingToolRequirement[];
      candidates: TaskTraceCandidateSourceV1[];
    }>;
    approvals: Array<{
      approvalRef: TraceRef;
      runRef: TraceRef;
      toolUseRef: TraceRef | null;
      status: ApprovalStatus;
      requestedEventRef: TraceRef | null;
      resolvedEventRef: TraceRef | null;
    }>;
    tools: Array<{
      invocationRef: TraceRef;
      runRef: TraceRef;
      toolUseRef: TraceRef | null;
      requirement: RoutingToolRequirement | null;
      status: ToolInvocationStatus;
      requestedEventRef: TraceRef | null;
      startedEventRef: TraceRef | null;
      terminalEventRef: TraceRef | null;
    }>;
    usage: Array<Omit<TaskTraceUsageSourceV1, 'runId' | 'sourceEventId'> & {
      runRef: TraceRef;
      sourceEventRef: TraceRef;
    }>;
    recovery: Array<{
      recoveredSessionRef: TraceRef;
      kind: SessionRecoveryKind;
      sourceSessionRef: TraceRef;
      sourceRunRef: TraceRef | null;
      sourceCheckpointRef: TraceRef | null;
      sourceExists: boolean;
      cycleDetected: boolean;
    }>;
    outcome: {
      decision: TaskTraceOutcome;
      source: 'task-accept' | 'task-revert' | 'none';
      reviewVersion: string | null;
      receiptHash: string | null;
      acceptedCommitPresent: boolean;
      decidedAt: string | null;
    };
  };
  assertions: TaskTraceAssertionV1[];
  summary: {
    integrity: TraceIntegrityStatus;
    completeness: TraceCompletenessStatus;
    outcome: TaskTraceOutcome;
    failedAssertions: TaskTraceAssertionV1['id'][];
    unknownAssertions: TaskTraceAssertionV1['id'][];
  };
}

const TERMINAL_EVENTS = new Set<WorkbenchEventType>([
  'run.completed',
  'run.failed',
  'run.cancelled',
]);
const POST_TERMINAL_SEMANTIC_EVENTS = new Set<WorkbenchEventType>([
  'run.output.delta',
  'message.created',
  'tool.registered',
  'tool.requested',
  'tool.started',
  'tool.completed',
  'tool.denied',
  'artifact.created',
  'checkpoint.saved',
  'run.undo',
]);
const ROUTING_REASON_CODES = new Set<RoutingReasonCode>([
  'explicit-provider',
  'only-ready-provider',
  'strongest-tool-coverage',
  'checkpoint-capability',
  'execution-readiness',
  'analysis-readiness',
  'preferred-session-context',
  'policy-priority',
  'review-provider-separation',
  'verify-provider-selection',
  'delegate-provider-selection',
  'handoff-provider-selection',
  'recovery-continuity',
]);
const ROUTING_STRATEGIES = new Set<OrchestrationStrategy>([
  'balanced', 'tool-first', 'analysis-first', 'checkpoint-first',
]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function traceRef(value: string): TraceRef {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new Error('Trace source identifiers must be non-empty bounded strings.');
  }
  return `ref:sha256:${sha256(value)}`;
}

function isoTimestamp(value: string, field: string): string {
  const timestamp = new Date(value);
  if (!value || Number.isNaN(timestamp.getTime())) {
    throw new Error(`${field} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function safeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

function safeOptionalInteger(value: number | null, field: string): number | null {
  return value === null ? null : safeInteger(value, field);
}

function canonicalOptionalInteger(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) ? value : null;
}

function safeRevision(value: string): string {
  if (value === 'legacy-unversioned' || /^sha256:[a-f0-9]{64}$/.test(value)) return value;
  throw new Error('Provider configuration revisions must be a SHA-256 digest or legacy marker.');
}

function safeDigest(value: string | null, field: string): string | null {
  if (value === null || /^sha256:[a-f0-9]{64}$/.test(value)) return value;
  throw new Error(`${field} must be a SHA-256 digest.`);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error('Canonical trace JSON accepts only finite safe integers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => {
      if (record[key] === undefined) throw new Error('Canonical trace JSON rejects undefined.');
      return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
    }).join(',')}}`;
  }
  throw new Error(`Canonical trace JSON rejects ${typeof value}.`);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function assertion(
  id: TaskTraceAssertionV1['id'],
  state: { failed: boolean; unknown: boolean; applicable: boolean },
  evidenceRefs: string[],
): TaskTraceAssertionV1 {
  const status: TraceAssertionStatus = state.failed
    ? 'fail'
    : state.unknown
      ? 'unknown'
      : state.applicable
        ? 'pass'
        : 'not_applicable';
  return {
    id,
    status,
    reasonCode: `${id}_${status.toUpperCase()}`,
    evidenceRefs: uniqueSorted(evidenceRefs),
  };
}

function eventTerminalType(status: RunStatus): WorkbenchEventType | null {
  if (status === 'completed') return 'run.completed';
  if (status === 'failed') return 'run.failed';
  if (status === 'cancelled') return 'run.cancelled';
  return null;
}

function isTerminalStatus(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function detectCycle(edges: Map<string, string[]>): Set<string> {
  const cyclic = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string, path: string[]): void => {
    if (visiting.has(node)) {
      const start = path.indexOf(node);
      for (const entry of path.slice(Math.max(start, 0))) cyclic.add(entry);
      cyclic.add(node);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const next of edges.get(node) ?? []) visit(next, [...path, node]);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of edges.keys()) visit(node, []);
  return cyclic;
}

export function projectTaskTrace(source: TaskTraceSourceProjectionV1): TaskTraceReportV1 {
  if (source.schemaVersion !== TASK_TRACE_SOURCE_VERSION) {
    throw new Error(`Unsupported task trace source version '${String(source.schemaVersion)}'.`);
  }
  const evaluatedThrough = isoTimestamp(source.evaluatedThrough, 'evaluatedThrough');
  const taskUpdatedAt = isoTimestamp(source.task.updatedAt, 'task.updatedAt');
  const taskRef = traceRef(source.task.id);
  if (!['active', 'accepted', 'reverted'].includes(source.task.status)) {
    throw new Error('Invalid worktree task status.');
  }

  const sessionById = new Map(source.sessions.map((entry) => [entry.id, entry]));
  const runById = new Map(source.runs.map((entry) => [entry.id, entry]));
  const eventById = new Map(source.events.map((entry) => [entry.id, entry]));
  const checkpointIds = new Set(source.scope.checkpointIds);
  const eventsByRun = new Map<string, TaskTraceEventSourceV1[]>();
  for (const event of source.events) {
    const entries = eventsByRun.get(event.runId) ?? [];
    entries.push(event);
    eventsByRun.set(event.runId, entries);
  }
  for (const entries of eventsByRun.values()) entries.sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));

  const normalizedSessions = source.sessions.map((entry) => {
    if (!isProviderId(entry.providerId)) throw new Error('Invalid provider id in trace session.');
    if (!['manual', 'allow', 'deny'].includes(entry.approvalPolicy)) {
      throw new Error('Invalid approval policy in trace session.');
    }
    return {
      sessionRef: traceRef(entry.id),
      providerId: entry.providerId,
      providerConfigurationRevision: safeRevision(entry.providerConfigurationRevision),
      approvalPolicy: entry.approvalPolicy,
      recovery: entry.recovery ? {
        kind: entry.recovery.kind,
        sourceSessionRef: traceRef(entry.recovery.sourceSessionId),
        sourceCheckpointRef: entry.recovery.sourceCheckpointId ? traceRef(entry.recovery.sourceCheckpointId) : null,
        sourceRunRef: entry.recovery.sourceRunId ? traceRef(entry.recovery.sourceRunId) : null,
      } : null,
      orchestration: entry.orchestration ? {
        kind: entry.orchestration.kind,
        role: entry.orchestration.role,
        sourceSessionRef: entry.orchestration.sourceSessionId ? traceRef(entry.orchestration.sourceSessionId) : null,
        sourceRunRef: entry.orchestration.sourceRunId ? traceRef(entry.orchestration.sourceRunId) : null,
        sourceProviderId: entry.orchestration.sourceProviderId,
      } : null,
    };
  }).sort((a, b) => a.sessionRef.localeCompare(b.sessionRef));

  const normalizedRuns = source.runs.map((run) => {
    const events = eventsByRun.get(run.id) ?? [];
    const terminals = events.filter((event) => TERMINAL_EVENTS.has(event.type));
    const terminal = terminals[0] ?? null;
    return {
      runRef: traceRef(run.id),
      sessionRef: traceRef(run.sessionId),
      providerId: run.providerId,
      providerConfigurationRevision: safeRevision(run.providerConfigurationRevision),
      mode: run.mode,
      status: run.status,
      firstEventSequence: events[0]?.sequence ?? null,
      lastEventSequence: events.at(-1)?.sequence ?? null,
      eventCount: events.length,
      terminalEventRef: terminal ? traceRef(terminal.id) : null,
      terminalEventType: terminal?.type as 'run.completed' | 'run.failed' | 'run.cancelled' | null,
    };
  }).sort((a, b) => a.runRef.localeCompare(b.runRef));

  const normalizedRouting = source.routingDecisions.map((entry) => {
    if (!ROUTING_REASON_CODES.has(entry.reasonCode) || !ROUTING_STRATEGIES.has(entry.strategy)) {
      throw new Error('Invalid routing reason or strategy.');
    }
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(entry.algorithmVersion)) {
      throw new Error('Routing algorithm versions must be bounded identifiers.');
    }
    for (const providerId of [entry.selectedProviderId, entry.fallbackProviderId, entry.preferredProviderId]) {
      if (providerId !== null && !isProviderId(providerId)) throw new Error('Invalid provider id in routing decision.');
    }
    const requiredTools = [...new Set(entry.requiredTools)];
    if (requiredTools.some((tool) => !isRoutingToolRequirement(tool))) {
      throw new Error('Invalid routing tool requirement.');
    }
    const candidates = entry.candidates.map((candidate) => ({
      providerId: candidate.providerId,
      enabled: Boolean(candidate.enabled),
      available: Boolean(candidate.available),
      priority: safeInteger(candidate.priority, 'candidate.priority'),
      requiredToolReadyCount: safeInteger(candidate.requiredToolReadyCount, 'candidate.requiredToolReadyCount'),
      requiredToolCount: safeInteger(candidate.requiredToolCount, 'candidate.requiredToolCount'),
      sessionRegisteredReadyCount: safeInteger(candidate.sessionRegisteredReadyCount, 'candidate.sessionRegisteredReadyCount'),
      recentInvocationCount: safeInteger(candidate.recentInvocationCount, 'candidate.recentInvocationCount'),
      recentSuccessCount: safeInteger(candidate.recentSuccessCount, 'candidate.recentSuccessCount'),
      resumableSessions: Boolean(candidate.resumableSessions),
      checkpointEvents: Boolean(candidate.checkpointEvents),
    })).sort((a, b) => a.providerId.localeCompare(b.providerId));
    if (candidates.some((candidate) => !isProviderId(candidate.providerId))) {
      throw new Error('Invalid candidate provider id.');
    }
    return {
      decisionRef: traceRef(entry.id),
      sessionRef: traceRef(entry.sessionId),
      firstRunRef: entry.firstRunId ? traceRef(entry.firstRunId) : null,
      decisionKind: entry.decisionKind,
      algorithmVersion: entry.algorithmVersion,
      providerConfigurationRevision: safeRevision(entry.providerConfigurationRevision),
      selectedProviderId: entry.selectedProviderId,
      fallbackProviderId: entry.fallbackProviderId,
      preferredProviderId: entry.preferredProviderId,
      strategy: entry.strategy,
      reasonCode: entry.reasonCode,
      requiredTools: requiredTools.sort(),
      candidates,
    };
  }).sort((a, b) => a.decisionRef.localeCompare(b.decisionRef));

  const normalizedApprovals = source.approvals.map((entry) => ({
    approvalRef: traceRef(entry.id),
    runRef: traceRef(entry.runId),
    toolUseRef: entry.toolUseId ? traceRef(entry.toolUseId) : null,
    status: entry.status,
    requestedEventRef: entry.requestedEventId ? traceRef(entry.requestedEventId) : null,
    resolvedEventRef: entry.resolvedEventId ? traceRef(entry.resolvedEventId) : null,
  })).sort((a, b) => a.approvalRef.localeCompare(b.approvalRef));

  const normalizedTools = source.tools.map((entry) => ({
    invocationRef: traceRef(entry.id),
    runRef: traceRef(entry.runId),
    toolUseRef: entry.toolUseId ? traceRef(entry.toolUseId) : null,
    requirement: entry.requirement !== null && isRoutingToolRequirement(entry.requirement)
      ? entry.requirement
      : null,
    status: entry.status,
    requestedEventRef: entry.requestedEventId ? traceRef(entry.requestedEventId) : null,
    startedEventRef: entry.startedEventId ? traceRef(entry.startedEventId) : null,
    terminalEventRef: entry.terminalEventId ? traceRef(entry.terminalEventId) : null,
  })).sort((a, b) => a.invocationRef.localeCompare(b.invocationRef));

  const normalizedUsage = source.usage.map((entry) => ({
    runRef: traceRef(entry.runId),
    sourceEventRef: traceRef(entry.sourceEventId),
    schemaVersion: TASK_TRACE_USAGE_VERSION,
    reporting: ['reported', 'unreported', 'invalid'].includes(entry.reporting)
      ? entry.reporting
      : 'invalid',
    inputTokens: canonicalOptionalInteger(entry.inputTokens),
    outputTokens: canonicalOptionalInteger(entry.outputTokens),
    reasoningTokens: canonicalOptionalInteger(entry.reasoningTokens),
    cacheReadTokens: canonicalOptionalInteger(entry.cacheReadTokens),
    cacheWriteTokens: canonicalOptionalInteger(entry.cacheWriteTokens),
    providerReportedTotalTokens: canonicalOptionalInteger(entry.providerReportedTotalTokens),
  })).sort((a, b) => a.runRef.localeCompare(b.runRef));

  const graph = new Map<string, string[]>();
  for (const session of source.sessions) {
    const edges = [session.recovery?.sourceSessionId, session.orchestration?.sourceSessionId]
      .filter((entry): entry is string => Boolean(entry));
    graph.set(session.id, edges);
  }
  const cyclicSessions = detectCycle(graph);
  const normalizedRecovery = source.sessions.filter((entry) => entry.recovery).map((entry) => {
    const recovery = entry.recovery!;
    const sourceRun = recovery.sourceRunId ? runById.get(recovery.sourceRunId) : null;
    return {
      recoveredSessionRef: traceRef(entry.id),
      kind: recovery.kind,
      sourceSessionRef: traceRef(recovery.sourceSessionId),
      sourceRunRef: recovery.sourceRunId ? traceRef(recovery.sourceRunId) : null,
      sourceCheckpointRef: recovery.sourceCheckpointId ? traceRef(recovery.sourceCheckpointId) : null,
      sourceExists:
        sessionById.has(recovery.sourceSessionId) &&
        (!recovery.sourceRunId || (Boolean(sourceRun) && sourceRun?.sessionId === recovery.sourceSessionId)) &&
        (!recovery.sourceCheckpointId || checkpointIds.has(recovery.sourceCheckpointId)),
      cycleDetected: cyclicSessions.has(entry.id),
    };
  }).sort((a, b) => a.recoveredSessionRef.localeCompare(b.recoveredSessionRef));

  const normalizedOutcome = {
    decision: source.outcome.decision,
    source: source.outcome.source,
    reviewVersion: safeDigest(source.outcome.reviewVersion, 'outcome.reviewVersion'),
    receiptHash: safeDigest(source.outcome.receiptHash, 'outcome.receiptHash'),
    acceptedCommitPresent: Boolean(source.outcome.acceptedCommitPresent),
    decidedAt: source.outcome.decidedAt ? isoTimestamp(source.outcome.decidedAt, 'outcome.decidedAt') : null,
  };
  if (!['keep', 'discard', 'undecided'].includes(source.outcome.decision) ||
    !['task-accept', 'task-revert', 'none'].includes(source.outcome.source)) {
    throw new Error('Invalid task trace outcome.');
  }

  const projection = {
    sessions: normalizedSessions,
    runs: normalizedRuns,
    routing: normalizedRouting,
    approvals: normalizedApprovals,
    tools: normalizedTools,
    usage: normalizedUsage,
    recovery: normalizedRecovery,
    outcome: normalizedOutcome,
  };

  const tt1 = { failed: false, unknown: false, applicable: true };
  const expectedSessions = uniqueSorted(source.scope.sessionIds);
  const expectedRuns = uniqueSorted(source.scope.runIds);
  const actualSessions = uniqueSorted(source.sessions.map((entry) => entry.id));
  const actualRuns = uniqueSorted(source.runs.map((entry) => entry.id));
  tt1.failed = hasDuplicates(source.scope.sessionIds) || hasDuplicates(source.scope.runIds) ||
    hasDuplicates(source.sessions.map((entry) => entry.id)) || hasDuplicates(source.runs.map((entry) => entry.id)) ||
    canonicalJson(expectedSessions) !== canonicalJson(actualSessions) || canonicalJson(expectedRuns) !== canonicalJson(actualRuns) ||
    source.sessions.some((entry) => entry.worktreeTaskId !== source.task.id) ||
    source.runs.some((entry) => entry.worktreeTaskId !== source.task.id || !sessionById.has(entry.sessionId));

  const tt2 = { failed: false, unknown: false, applicable: source.sessions.length > 0 };
  const routingBySession = new Map<string, TaskTraceRoutingDecisionSourceV1[]>();
  for (const decision of source.routingDecisions) {
    const entries = routingBySession.get(decision.sessionId) ?? [];
    entries.push(decision);
    routingBySession.set(decision.sessionId, entries);
  }
  for (const session of source.sessions) {
    const decisions = routingBySession.get(session.id) ?? [];
    if (decisions.length === 0) {
      if (session.routingEvidenceVersion === 'legacy') tt2.unknown = true;
      else tt2.failed = true;
      continue;
    }
    if (decisions.length !== 1) tt2.failed = true;
    for (const decision of decisions) {
      const firstRun = decision.firstRunId ? runById.get(decision.firstRunId) : null;
      const selected = decision.candidates.find((entry) => entry.providerId === decision.selectedProviderId);
      if (decision.selectedProviderId !== session.providerId ||
        decision.providerConfigurationRevision !== session.providerConfigurationRevision ||
        (firstRun && (firstRun.sessionId !== session.id || firstRun.providerId !== decision.selectedProviderId)) ||
        (decision.firstRunId && !firstRun)) tt2.failed = true;
      if (decision.decisionKind !== 'explicit' && (!selected || !selected.enabled || !selected.available)) tt2.failed = true;
      if (decision.candidates.some((candidate) =>
        candidate.requiredToolReadyCount > candidate.requiredToolCount ||
        candidate.sessionRegisteredReadyCount > candidate.requiredToolCount ||
        candidate.recentSuccessCount > candidate.recentInvocationCount)) tt2.failed = true;
    }
  }
  if ([...routingBySession.keys()].some((id) => !sessionById.has(id))) tt2.failed = true;

  const tt3 = { failed: false, unknown: false, applicable: source.runs.length > 0 };
  if (hasDuplicates(source.events.map((entry) => entry.id))) tt3.failed = true;
  for (const run of source.runs) {
    const events = eventsByRun.get(run.id) ?? [];
    const terminals = events.filter((event) => TERMINAL_EVENTS.has(event.type));
    if (events.some((event, index) => event.sequence !== index + 1 || event.sessionId !== run.sessionId)) tt3.failed = true;
    const expectedTerminal = eventTerminalType(run.status);
    if (expectedTerminal) {
      if (terminals.length !== 1 || terminals[0]?.type !== expectedTerminal) tt3.failed = true;
    } else if (terminals.length > 0) tt3.failed = true;
    const terminalSequence = terminals[0]?.sequence ?? null;
    if (terminalSequence !== null && events.some((event) => event.sequence > terminalSequence && POST_TERMINAL_SEMANTIC_EVENTS.has(event.type))) {
      tt3.failed = true;
    }
  }
  if (source.events.some((event) => !runById.has(event.runId))) tt3.failed = true;

  const tt4 = { failed: false, unknown: false, applicable: source.sessions.some((entry) => entry.recovery || entry.orchestration) };
  for (const session of source.sessions) {
    if (session.recovery) {
      const recovery = normalizedRecovery.find((entry) => entry.recoveredSessionRef === traceRef(session.id));
      if (!recovery?.sourceExists || recovery.cycleDetected) tt4.failed = true;
    }
    if (session.orchestration) {
      const sourceSession = session.orchestration.sourceSessionId ? sessionById.get(session.orchestration.sourceSessionId) : null;
      const sourceRun = session.orchestration.sourceRunId ? runById.get(session.orchestration.sourceRunId) : null;
      if ((session.orchestration.sourceSessionId && !sourceSession) ||
        (session.orchestration.sourceRunId && (!sourceRun || (sourceSession && sourceRun.sessionId !== sourceSession.id))) ||
        cyclicSessions.has(session.id)) tt4.failed = true;
    }
  }

  const tt5 = { failed: false, unknown: false, applicable: source.approvals.length > 0 || source.tools.length > 0 };
  const toolByUse = new Map<string, TaskTraceToolSourceV1[]>();
  for (const tool of source.tools) {
    if (tool.toolUseId) {
      const key = `${tool.runId}\0${tool.toolUseId}`;
      const entries = toolByUse.get(key) ?? [];
      entries.push(tool);
      toolByUse.set(key, entries);
    }
    const refs = [tool.requestedEventId, tool.startedEventId, tool.terminalEventId].filter((entry): entry is string => Boolean(entry));
    if (tool.evidenceVersion === 'legacy' || refs.length < 2) tt5.unknown = true;
    const events = refs.map((id) => eventById.get(id));
    if (events.some((event) => !event || event.runId !== tool.runId)) tt5.failed = true;
    const sequences = events.filter(Boolean).map((event) => event!.sequence);
    if (sequences.some((value, index) => index > 0 && value <= sequences[index - 1]!)) tt5.failed = true;
    const terminal = tool.terminalEventId ? eventById.get(tool.terminalEventId) : null;
    if (terminal && ((tool.status === 'completed' && terminal.type !== 'tool.completed') ||
      (tool.status === 'denied' && terminal.type !== 'tool.denied'))) tt5.failed = true;
  }
  for (const approval of source.approvals) {
    const run = runById.get(approval.runId);
    const requested = approval.requestedEventId ? eventById.get(approval.requestedEventId) : null;
    const resolved = approval.resolvedEventId ? eventById.get(approval.resolvedEventId) : null;
    if (approval.evidenceVersion === 'legacy' || !approval.toolUseId || !requested || (approval.status !== 'requested' && !resolved)) tt5.unknown = true;
    if ((approval.requestedEventId && (!requested || requested.type !== 'approval.requested' || requested.runId !== approval.runId)) ||
      (approval.resolvedEventId && (!resolved || resolved.type !== 'approval.resolved' || resolved.runId !== approval.runId)) ||
      (requested && resolved && resolved.sequence <= requested.sequence) ||
      (approval.status === 'requested' && run && isTerminalStatus(run.status))) tt5.failed = true;
    if (approval.toolUseId) {
      const matches = toolByUse.get(`${approval.runId}\0${approval.toolUseId}`) ?? [];
      if (matches.length === 0) tt5.unknown = true;
      if (matches.length > 1 || (approval.status === 'denied' && matches.some((tool) => tool.status === 'completed'))) tt5.failed = true;
      const matchingTool = matches[0];
      const toolStarted = matchingTool?.startedEventId ? eventById.get(matchingTool.startedEventId) : null;
      if (approval.status === 'approved' && resolved && toolStarted && toolStarted.sequence <= resolved.sequence) tt5.failed = true;
    }
  }

  const tt6 = { failed: false, unknown: false, applicable: source.runs.some((entry) => isTerminalStatus(entry.status)) };
  const usageByRun = new Map<string, TaskTraceUsageSourceV1[]>();
  for (const usage of source.usage) {
    const entries = usageByRun.get(usage.runId) ?? [];
    entries.push(usage);
    usageByRun.set(usage.runId, entries);
  }
  for (const run of source.runs.filter((entry) => isTerminalStatus(entry.status))) {
    const entries = usageByRun.get(run.id) ?? [];
    if (entries.length === 0) {
      tt6.unknown = true;
      continue;
    }
    if (entries.length !== 1) tt6.failed = true;
    for (const usage of entries) {
      const event = eventById.get(usage.sourceEventId);
      const numbers = [usage.inputTokens, usage.outputTokens, usage.reasoningTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.providerReportedTotalTokens];
      if (usage.schemaVersion !== TASK_TRACE_USAGE_VERSION || !event || event.runId !== run.id || !TERMINAL_EVENTS.has(event.type) ||
        numbers.some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0)) ||
        (usage.reporting === 'reported' && numbers.every((value) => value === null)) ||
        (usage.reporting !== 'reported' && numbers.some((value) => value !== null))) tt6.failed = true;
      if (usage.reporting !== 'reported') tt6.unknown = true;
    }
  }
  if ([...usageByRun.keys()].some((id) => !runById.has(id))) tt6.failed = true;

  const tt7 = { failed: false, unknown: false, applicable: true };
  const expectedOutcome: TaskTraceOutcome = source.task.status === 'accepted' ? 'keep' : source.task.status === 'reverted' ? 'discard' : 'undecided';
  const expectedSource = source.task.status === 'accepted' ? 'task-accept' : source.task.status === 'reverted' ? 'task-revert' : 'none';
  if (source.outcome.decision !== expectedOutcome || source.outcome.source !== expectedSource ||
    (source.task.status === 'accepted' && !source.outcome.acceptedCommitPresent) ||
    (source.task.status !== 'accepted' && source.outcome.acceptedCommitPresent)) tt7.failed = true;
  if (source.task.status === 'active') {
    if (source.outcome.reviewVersion || source.outcome.receiptHash || source.outcome.decidedAt) tt7.failed = true;
  } else if (source.outcome.evidenceVersion === 'legacy') {
    tt7.unknown = true;
  } else if (!source.outcome.reviewVersion || !source.outcome.receiptHash || !source.outcome.decidedAt) {
    tt7.failed = true;
  }

  const assertions = [
    assertion('CW-TT1', tt1, [taskRef, ...normalizedSessions.map((entry) => entry.sessionRef), ...normalizedRuns.map((entry) => entry.runRef)]),
    assertion('CW-TT2', tt2, normalizedRouting.map((entry) => entry.decisionRef)),
    assertion('CW-TT3', tt3, normalizedRuns.map((entry) => entry.runRef)),
    assertion('CW-TT4', tt4, normalizedRecovery.map((entry) => entry.recoveredSessionRef)),
    assertion('CW-TT5', tt5, [...normalizedApprovals.map((entry) => entry.approvalRef), ...normalizedTools.map((entry) => entry.invocationRef)]),
    assertion('CW-TT6', tt6, normalizedUsage.map((entry) => entry.runRef)),
    assertion('CW-TT7', tt7, [taskRef]),
    assertion('CW-TT8', { failed: false, unknown: false, applicable: true }, [taskRef]),
  ];

  const sourceCut = {
    taskUpdatedAt,
    runs: source.runs.map((run) => {
      const events = eventsByRun.get(run.id) ?? [];
      const last = events.at(-1) ?? null;
      return { runRef: traceRef(run.id), lastEventSequence: last?.sequence ?? 0, lastEventRef: last ? traceRef(last.id) : null };
    }).sort((a, b) => a.runRef.localeCompare(b.runRef)),
  };
  const normalizedSource = {
    task: { taskRef, status: source.task.status, updatedAt: taskUpdatedAt },
    scope: {
      sessionRefs: uniqueSorted(source.scope.sessionIds.map(traceRef)),
      runRefs: uniqueSorted(source.scope.runIds.map(traceRef)),
      checkpointRefs: uniqueSorted(source.scope.checkpointIds.map(traceRef)),
    },
    sourceCut,
    eventFacts: source.events.map((event) => ({
      eventRef: traceRef(event.id),
      sessionRef: traceRef(event.sessionId),
      runRef: traceRef(event.runId),
      sequence: event.sequence,
      source: event.source,
      type: event.type,
    })).sort((a, b) => a.runRef.localeCompare(b.runRef) || a.sequence - b.sequence || a.eventRef.localeCompare(b.eventRef)),
    evidenceVersions: {
      routing: source.sessions.map((entry) => ({ sessionRef: traceRef(entry.id), version: entry.routingEvidenceVersion })).sort((a, b) => a.sessionRef.localeCompare(b.sessionRef)),
      approvals: source.approvals.map((entry) => ({ approvalRef: traceRef(entry.id), version: entry.evidenceVersion })).sort((a, b) => a.approvalRef.localeCompare(b.approvalRef)),
      tools: source.tools.map((entry) => ({ invocationRef: traceRef(entry.id), version: entry.evidenceVersion })).sort((a, b) => a.invocationRef.localeCompare(b.invocationRef)),
      outcome: source.outcome.evidenceVersion,
    },
    projection,
  };
  const sourceDigest = `sha256:${sha256(canonicalJson(normalizedSource))}` as const;
  const id = `trace:sha256:${sha256(canonicalJson({
    projectionVersion: TASK_TRACE_PROJECTION_VERSION,
    rulesetVersion: TASK_TRACE_RULESET_VERSION,
    taskRef,
    sourceDigest,
  }))}` as const;
  const failedAssertions = assertions.filter((entry) => entry.status === 'fail').map((entry) => entry.id);
  const unknownAssertions = assertions.filter((entry) => entry.status === 'unknown').map((entry) => entry.id);

  return {
    id,
    schemaVersion: TASK_TRACE_REPORT_VERSION,
    projectionVersion: TASK_TRACE_PROJECTION_VERSION,
    rulesetVersion: TASK_TRACE_RULESET_VERSION,
    subject: { kind: 'worktree-task', taskRef, taskStatus: source.task.status },
    sourceDigest,
    evaluatedThrough,
    contentBoundary: 'metadata-only-v1',
    sourceCut,
    projection,
    assertions,
    summary: {
      integrity: failedAssertions.length > 0 ? 'fail' : 'pass',
      completeness: unknownAssertions.length > 0 ? 'partial' : 'complete',
      outcome: source.outcome.decision,
      failedAssertions,
      unknownAssertions,
    },
  };
}

export function serializeTaskTraceReport(report: TaskTraceReportV1): string {
  return `${canonicalJson(report)}\n`;
}
