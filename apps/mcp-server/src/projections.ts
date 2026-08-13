import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  ArchiveSnapshot,
  RunSnapshot,
  SessionSnapshot,
  TranscriptWindow,
  WorkbenchRun,
  WorkbenchSession,
} from '@codewave/protocol';

const MAX_TEXT_CHARS = 16_000;
const MAX_RESULT_BYTES = 256 * 1024;

function truncate(value: string, maxChars = MAX_TEXT_CHARS): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…[truncated]`;
}

function projectSessionIdentity(session: WorkbenchSession) {
  return {
    id: session.id,
    workspaceLabel: path.basename(session.workspacePath) || 'workspace',
    workspaceRef: createHash('sha256').update(session.workspacePath).digest('hex').slice(0, 16),
    providerId: session.providerId,
    createdAt: session.createdAt,
    approvalPolicy: session.approvalPolicy,
    orchestration: session.orchestration
      ? { kind: session.orchestration.kind, role: session.orchestration.role }
      : null,
  };
}

function projectRunIdentity(run: WorkbenchRun) {
  return {
    id: run.id,
    sessionId: run.sessionId,
    providerId: run.providerId,
    status: run.status,
    mode: run.mode,
    prompt: truncate(run.prompt, 8_000),
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    errorMessage: run.errorMessage ? truncate(run.errorMessage, 4_000) : null,
  };
}

export function projectArchive(snapshot: ArchiveSnapshot) {
  return {
    sessions: snapshot.sessions.slice(0, 50).map((entry) => ({
      ...projectSessionIdentity(entry.session),
      runCount: entry.runCount,
      completedRunCount: entry.completedRunCount,
      failedRunCount: entry.failedRunCount,
      latestRun: entry.latestRun ? projectRunIdentity(entry.latestRun) : null,
    })),
    truncated: snapshot.sessions.length > 50,
    totalCount: snapshot.sessions.length,
  };
}

export function projectSession(snapshot: SessionSnapshot) {
  return {
    session: projectSessionIdentity(snapshot.session),
    runs: snapshot.runs.slice(0, 50).map(projectRunIdentity),
    truncated: snapshot.runs.length > 50,
    totalRunCount: snapshot.runs.length,
  };
}

export function projectTranscript(window: TranscriptWindow) {
  return {
    sessionId: window.sessionId,
    messages: window.messages.slice(-50).map((message) => ({
      id: message.id,
      runId: message.runId,
      sequence: message.sequence,
      parentMessageId: message.parentMessageId,
      role: message.role,
      content: truncate(message.content),
      createdAt: message.createdAt,
    })),
    hasMoreBefore: window.hasMoreBefore,
    oldestSequence: window.oldestSequence,
    newestSequence: window.newestSequence,
    totalCount: window.totalCount,
  };
}

export function projectRun(snapshot: RunSnapshot) {
  return {
    run: projectRunIdentity(snapshot.run),
    transcript: projectTranscript(snapshot.transcript),
    tools: snapshot.toolInvocations.map((tool) => ({
      id: tool.id,
      name: tool.toolName,
      status: tool.status,
      createdAt: tool.createdAt,
      updatedAt: tool.updatedAt,
    })),
    approvals: snapshot.approvals.map((approval) => ({
      id: approval.id,
      toolName: approval.toolName,
      status: approval.status,
      createdAt: approval.createdAt,
      resolvedAt: approval.resolvedAt,
    })),
    artifacts: snapshot.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      title: truncate(artifact.title, 512),
      createdAt: artifact.createdAt,
    })),
    checkpoints: snapshot.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      title: truncate(checkpoint.title, 512),
      createdAt: checkpoint.createdAt,
    })),
    contextChars: snapshot.contextChars,
  };
}

export function boundedJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(text) > MAX_RESULT_BYTES) {
    throw new Error('The projected MCP result exceeded the 256 KiB response limit.');
  }
  return text;
}
