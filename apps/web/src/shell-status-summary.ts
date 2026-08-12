import type {
  ApprovalRecord,
  OrchestrationRecommendation,
  ProviderCapabilities,
  ProviderHealth,
  ProviderId,
  RunStatus,
  WorkbenchRun,
} from '@qwemini/protocol';

type SessionLike = {
  providerId: ProviderId;
  orchestration: {
    kind: string;
    role: string;
    sourceRunId: string | null;
  } | null;
  recovery: {
    kind: string;
    sourceSessionId: string;
    sourceCheckpointId: string | null;
  } | null;
};

type RunPresentation = {
  statusLabel: string;
  statusClassName: string;
  stateNote: string;
};

export function formatRunStatus(status: RunStatus): string {
  return status.replace(/_/g, ' ');
}

export function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatProviderCapabilities(
  capabilities: ProviderCapabilities,
): string {
  const approvalMode = capabilities.daemonApprovalMediation
    ? 'daemon approvals'
    : 'provider approvals only';
  const resumeMode = capabilities.resumableSessions ? 'resume' : 'no resume';
  const checkpointMode = capabilities.checkpointEvents
    ? 'checkpoints'
    : 'no checkpoints';
  return [approvalMode, resumeMode, checkpointMode].join(', ');
}

export function formatProviderHealthSummary(
  providers: ProviderHealth[] | null | undefined,
): string {
  if (!Array.isArray(providers) || providers.length === 0) {
    return 'Provider status unknown';
  }

  return providers
    .map(
      (provider) =>
        `${provider.providerId}: ${provider.detail} [${formatProviderCapabilities(provider.capabilities)}]`,
    )
    .join(' | ');
}

export function formatSessionRecovery(session: SessionLike): string | null {
  if (!session.recovery) {
    return null;
  }

  if (session.recovery.kind === 'checkpoint') {
    const checkpointLabel = session.recovery.sourceCheckpointId
      ? session.recovery.sourceCheckpointId.slice(0, 8)
      : 'unknown';
    return `checkpoint ${checkpointLabel}... from session ${session.recovery.sourceSessionId.slice(0, 8)}...`;
  }

  return `session ${session.recovery.sourceSessionId.slice(0, 8)}...`;
}

export function formatSessionOrchestration(session: SessionLike): string | null {
  if (!session.orchestration) {
    return null;
  }

  const sourceRun = session.orchestration.sourceRunId
    ? `run ${session.orchestration.sourceRunId.slice(0, 8)}...`
    : 'manual route';
  return `${session.orchestration.role} via ${session.orchestration.kind} from ${sourceRun}`;
}

export function formatRecommendation(
  recommendation: OrchestrationRecommendation,
): string {
  const confidence = Math.round((recommendation.confidence || 0) * 100);
  const fallback = recommendation.fallbackProviderId
    ? ` Fallback: ${recommendation.fallbackProviderId}.`
    : '';
  const toolSignals =
    recommendation.requiredTools.length > 0
      ? ` Tool signals: ${recommendation.requiredTools.join(', ')}.`
      : '';
  const signalLines =
    recommendation.signals.length > 0
      ? ` Evidence: ${recommendation.signals.join(' ')}`
      : '';
  return `Route to ${recommendation.primaryProviderId} using ${recommendation.strategy} (${confidence}% confidence). ${recommendation.reason}${toolSignals}${signalLines}${fallback}`;
}

export function buildSessionProviderNote({
  selectedSession,
  providerId,
  capabilities,
}: {
  selectedSession: SessionLike | null;
  providerId: ProviderId;
  capabilities: ProviderCapabilities;
}): string {
  const providerLabel = providerId === 'qwen' ? 'Qwen' : 'Gemini';
  const notes: string[] = [];

  if (selectedSession?.orchestration) {
    notes.push(
      `This session is a ${selectedSession.orchestration.role} follow-up created through ${selectedSession.orchestration.kind}.`,
    );
  }

  if (capabilities.daemonApprovalMediation) {
    notes.push(`${providerLabel} exposes daemon-owned tool approvals in CodeWave.`);
  } else {
    notes.push(
      `${providerLabel} does not expose daemon-owned approvals yet, so approval policy is inactive for new sessions.`,
    );
  }

  notes.push(
    capabilities.resumableSessions
      ? 'Session resume metadata is available.'
      : 'Session resume metadata is not available.',
  );
  notes.push(
    capabilities.checkpointEvents
      ? 'Provider checkpoint events can be recovered directly.'
      : 'Provider checkpoint events are not emitted; use session recovery instead.',
  );

  return notes.join(' ');
}

export function buildSelectedSessionNote({
  session,
  capabilities,
  providerUnavailableDetail,
}: {
  session: SessionLike;
  capabilities: ProviderCapabilities;
  providerUnavailableDetail: string | null;
}): string {
  const notes: string[] = [];

  if (session.orchestration) {
    notes.push(
      `This session is a ${session.orchestration.role} orchestration run created through ${session.orchestration.kind}.`,
    );
  }

  if (capabilities.daemonApprovalMediation) {
    notes.push(`Daemon approval policy is active for this ${session.providerId} session.`);
  } else {
    notes.push(
      `${session.providerId} does not expose daemon-owned approvals yet, so the stored session approval policy is not enforced.`,
    );
  }

  notes.push(
    capabilities.checkpointEvents
      ? 'Checkpoint events from this provider will appear below when emitted.'
      : 'This provider does not emit checkpoint events; recover by session instead.',
  );
  notes.push(
    capabilities.resumableSessions
      ? 'Session recovery is available when provider resume metadata exists.'
      : 'Session recovery is not available for this provider.',
  );

  if (providerUnavailableDetail) {
    notes.push(`Provider runtime is currently unavailable: ${providerUnavailableDetail}`);
  }

  return notes.join(' ');
}

export function buildRunPresentation({
  run,
  approvals = [],
}: {
  run: Pick<WorkbenchRun, 'status' | 'errorMessage'>;
  approvals?: Array<Pick<ApprovalRecord, 'status'>>;
}): RunPresentation {
  const statusLabel = formatRunStatus(run.status);
  const statusClassName = `status-pill status-${run.status}`;

  if (run.status === 'awaiting_approval') {
    const pendingCount = approvals.filter(
      (approval) => approval.status === 'requested',
    ).length;
    return {
      statusLabel,
      statusClassName,
      stateNote:
        pendingCount === 1
          ? 'Run is paused for 1 approval in the approvals pane.'
          : `Run is paused for ${pendingCount} approvals in the approvals pane.`,
    };
  }

  if (run.status === 'running') {
    return {
      statusLabel,
      statusClassName,
      stateNote: 'Run is active and streaming events from the daemon.',
    };
  }

  if (run.status === 'completed') {
    return {
      statusLabel,
      statusClassName,
      stateNote:
        'Run completed. Transcript, final messages, checkpoints, and review/verify follow-ups remain available below.',
    };
  }

  if (run.status === 'cancelled') {
    return {
      statusLabel,
      statusClassName,
      stateNote: run.errorMessage || 'Run was cancelled.',
    };
  }

  if (run.status === 'failed') {
    return {
      statusLabel,
      statusClassName,
      stateNote: run.errorMessage || 'Run failed.',
    };
  }

  return {
    statusLabel,
    statusClassName,
    stateNote: 'Start a run to see normalized events, approvals, and artifacts.',
  };
}
