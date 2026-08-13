import type {
  DelegateRunRequest,
  FollowUpRunRequest,
  HandoffRunRequest,
  OrchestrationRecommendation,
  OrchestrationRole,
  OrchestrationStrategy,
  ProviderHealth,
  ProviderId,
  RoutingToolRequirement,
  ToolPlaneSnapshot,
  WorkbenchRun,
} from '@codewave/protocol';

export interface RecommendProviderRouteInput {
  prompt: string;
  workspacePath: string;
  providers: ProviderHealth[];
  preferredProviderId?: ProviderId | null;
  requiredTools?: RoutingToolRequirement[];
  toolPlane?: ToolPlaneSnapshot | null;
}

export interface RecommendFollowUpRouteInput {
  kind: FollowUpRunRequest['kind'];
  workspacePath: string;
  providers: ProviderHealth[];
  sourceRun: WorkbenchRun;
  preferredProviderId?: ProviderId | null;
}

export interface BuildFollowUpPromptInput {
  kind: FollowUpRunRequest['kind'];
  sourceRun: WorkbenchRun;
  sourceProviderId: ProviderId;
  sourceOutput: string;
}

export interface RecommendDelegatedRouteInput {
  prompt: string;
  role: DelegateRunRequest['role'];
  workspacePath: string;
  providers: ProviderHealth[];
  sourceRun: WorkbenchRun;
  preferredProviderId?: ProviderId | null;
  requiredTools?: RoutingToolRequirement[];
  toolPlane?: ToolPlaneSnapshot | null;
}

export interface BuildDelegatedPromptInput {
  prompt: string;
  role: DelegateRunRequest['role'];
  sourceRun: WorkbenchRun;
  sourceProviderId: ProviderId;
  sourceOutput: string;
}

export interface RecommendHandoffRouteInput {
  prompt: string;
  workspacePath: string;
  providers: ProviderHealth[];
  sourceRun: WorkbenchRun;
  preferredProviderId?: ProviderId | null;
  requiredTools?: RoutingToolRequirement[];
  toolPlane?: ToolPlaneSnapshot | null;
}

export interface BuildHandoffPromptInput {
  prompt: string;
  sourceRun: WorkbenchRun;
  sourceProviderId: ProviderId;
  sourceOutput: string;
}

const CHECKPOINT_PATTERN =
  /\b(checkpoint|resume|recover|recovery|continue where|pick up where)\b/i;
const TOOL_PATTERN =
  /\b(shell|command|terminal|powershell|bash|edit|write|patch|fix|implement|refactor|tool|artifact|apply|run tests?|lint)\b/i;
const ANALYSIS_PATTERN =
  /\b(explain|summari[sz]e|compare|review|brainstorm|plan|research|investigate|understand|analy[sz]e)\b/i;

function normalizeRequiredTools(
  requiredTools: RoutingToolRequirement[] | undefined,
): RoutingToolRequirement[] {
  return [...new Set(requiredTools ?? [])];
}

function hasToolRequirement(
  requiredTools: RoutingToolRequirement[],
  requirement: RoutingToolRequirement,
): boolean {
  return requiredTools.includes(requirement);
}

function clampConfidence(value: number): number {
  return Math.max(0.5, Math.min(0.98, Number(value.toFixed(2))));
}

function providerPriority(provider: ProviderHealth): number {
  return provider.priority ?? 500;
}

function sortAvailableProviders(providers: ProviderHealth[]): ProviderHealth[] {
  return providers
    .filter((provider) => provider.available)
    .sort(
      (left, right) =>
        providerPriority(left) - providerPriority(right) ||
        left.providerId.localeCompare(right.providerId),
    );
}

function getFallbackProvider(
  providers: ProviderHealth[],
  primaryProviderId: ProviderId,
): ProviderId | null {
  return (
    sortAvailableProviders(providers).find(
      (provider) =>
        provider.available && provider.providerId !== primaryProviderId,
    )?.providerId ?? null
  );
}

function getBestProviderForTools(
  providers: ProviderHealth[],
  toolPlane: ToolPlaneSnapshot | null | undefined,
  requiredTools: RoutingToolRequirement[],
): { provider: ProviderHealth; score: number } | null {
  const ranked = sortAvailableProviders(providers)
    .map((provider) => ({
      provider,
      score: getToolRequirementCoverageScore(
        toolPlane,
        provider.providerId,
        requiredTools,
      ),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        providerPriority(left.provider) - providerPriority(right.provider),
    );
  return ranked[0] ?? null;
}

function getToolPlaneProviderSignal(
  toolPlane: ToolPlaneSnapshot | null | undefined,
  providerId: ProviderId,
) {
  return toolPlane?.providers.find((provider) => provider.providerId === providerId) ?? null;
}

function getToolRequirementCoverageScore(
  toolPlane: ToolPlaneSnapshot | null | undefined,
  providerId: ProviderId,
  requiredTools: RoutingToolRequirement[],
): number {
  if (requiredTools.length === 0) {
    return 0;
  }

  const signal = getToolPlaneProviderSignal(toolPlane, providerId);
  if (!signal) {
    return 0;
  }

  const matched = requiredTools.filter((tool) => signal.readyTools.includes(tool)).length;
  const sessionMatched = requiredTools.filter((tool) =>
    signal.sessionRegisteredTools.includes(tool),
  ).length;
  const coverage = matched / requiredTools.length;
  const sessionCoverage = sessionMatched / requiredTools.length;
  const recentSuccessRate =
    signal.recentInvocationCount > 0
      ? signal.recentSuccessCount / signal.recentInvocationCount
      : 0.5;
  const sessionRegistrationBonus =
    toolPlane?.scope === 'session' ? sessionCoverage * 2 : sessionCoverage * 0.5;
  return coverage * 10 + recentSuccessRate + sessionRegistrationBonus;
}

function buildSignalLines(
  toolPlane: ToolPlaneSnapshot | null | undefined,
  providerId: ProviderId,
  requiredTools: RoutingToolRequirement[],
): string[] {
  if (!toolPlane) {
    return [];
  }

  const signal = getToolPlaneProviderSignal(toolPlane, providerId);
  if (!signal) {
    return [];
  }

  const lines = [signal.summary];
  if (toolPlane.registryPath) {
    lines.push(`Workspace registry: ${toolPlane.registryPath}.`);
  } else {
    lines.push('Workspace registry: using tool-plane defaults.');
  }

  if (toolPlane.mcpServers.length > 0) {
    const readyServers = toolPlane.mcpServers
      .filter((server) => server.enabled && server.available)
      .map((server) => server.id);
    lines.push(
      `Workspace MCP servers: ${
        readyServers.length > 0 ? readyServers.join(', ') : 'none ready'
      }.`,
    );
  }

  if (requiredTools.length > 0) {
    const satisfied = requiredTools.filter((tool) => signal.readyTools.includes(tool));
    const sessionSatisfied = requiredTools.filter((tool) =>
      signal.sessionRegisteredTools.includes(tool),
    );
    lines.push(
      `${providerId} satisfies ${satisfied.length}/${requiredTools.length} required tool signals: ${
        satisfied.length > 0 ? satisfied.join(', ') : 'none'
      }.`,
    );
    if (toolPlane.scope === 'session') {
      const providerRegistrations = toolPlane.registeredSessionTools.filter(
        (registration) => registration.providerId === providerId,
      );
      const providerEnumeratedCount = providerRegistrations.filter(
        (registration) =>
          registration.metadata?.registrationKind === 'provider-enumeration',
      ).length;
      const inferredCount = providerRegistrations.length - providerEnumeratedCount;
      lines.push(
        `${providerId} has ${sessionSatisfied.length}/${requiredTools.length} required tools live-registered in this session: ${
          sessionSatisfied.length > 0 ? sessionSatisfied.join(', ') : 'none'
        }.`,
      );
      lines.push(
        `${providerId} session registration evidence: ${providerEnumeratedCount} provider-enumerated, ${inferredCount} inferred from tool events.`,
      );
    }
  }

  return lines;
}

function buildRecommendation(
  input: RecommendProviderRouteInput,
  primaryProviderId: ProviderId,
  strategy: OrchestrationStrategy,
  confidence: number,
  reason: string,
  signals: string[] = [],
): OrchestrationRecommendation {
  const availableProviders = input.providers.filter((provider) => provider.available);
  return {
    prompt: input.prompt,
    workspacePath: input.workspacePath,
    preferredProviderId: input.preferredProviderId ?? null,
    requiredTools: normalizeRequiredTools(input.requiredTools),
    primaryProviderId,
    fallbackProviderId: getFallbackProvider(availableProviders, primaryProviderId),
    strategy,
    confidence: clampConfidence(confidence),
    reason,
    signals,
  };
}

export function recommendProviderRoute(
  input: RecommendProviderRouteInput,
): OrchestrationRecommendation {
  const availableProviders = sortAvailableProviders(input.providers);
  if (availableProviders.length === 0) {
    throw new Error('No providers are currently available for orchestration.');
  }

  if (availableProviders.length === 1) {
    const onlyProvider = availableProviders[0]!;
    return buildRecommendation(
      input,
      onlyProvider.providerId,
      'balanced',
      0.96,
      `${onlyProvider.providerId} is the only available provider, so routing stays on the healthy runtime.`,
    );
  }

  const normalizedPrompt = input.prompt.trim();
  const requiredTools = normalizeRequiredTools(input.requiredTools);
  const preferredProvider = input.preferredProviderId
    ? availableProviders.find(
        (provider) => provider.providerId === input.preferredProviderId,
      ) ?? null
    : null;
  const toolPlane = input.toolPlane ?? null;

  if (toolPlane && requiredTools.length > 0) {
    const best = getBestProviderForTools(
      availableProviders,
      toolPlane,
      requiredTools,
    );

    if (best && best.score > 0) {
      const strategy =
        requiredTools.includes('workspace-write') || requiredTools.includes('shell')
          ? 'tool-first'
          : 'analysis-first';
      return buildRecommendation(
        input,
        best.provider.providerId,
        strategy,
        0.9,
        `${best.provider.providerId} is preferred because it has the strongest ready-tool coverage; policy priority breaks equivalent-coverage ties without selecting a paid provider implicitly.`,
        buildSignalLines(toolPlane, best.provider.providerId, requiredTools),
      );
    }

    if (hasToolRequirement(requiredTools, 'mcp')) {
      throw new Error(
        'No provider currently has MCP ready for this workspace. Add an enabled MCP server in .codewave/mcp.json or .mcp.json first.',
      );
    }
  }

  if (requiredTools.length > 0 && preferredProvider) {
    return buildRecommendation(
      input,
      preferredProvider.providerId,
      requiredTools.some((tool) => tool === 'workspace-write' || tool === 'shell')
        ? 'tool-first'
        : 'analysis-first',
      0.72,
      `${preferredProvider.providerId} remains selected because no live tool-plane snapshot was available to justify changing providers.`,
      buildSignalLines(toolPlane, preferredProvider.providerId, requiredTools),
    );
  }

  if (CHECKPOINT_PATTERN.test(normalizedPrompt)) {
    const checkpointProvider = availableProviders.find(
      (provider) => provider.capabilities.checkpointEvents,
    );
    if (checkpointProvider) {
      return buildRecommendation(
        input,
        checkpointProvider.providerId,
        'checkpoint-first',
        0.9,
        `${checkpointProvider.providerId} is preferred because it advertises checkpoint events for this recovery-sensitive task.`,
        buildSignalLines(toolPlane, checkpointProvider.providerId, requiredTools),
      );
    }
  }

  if (TOOL_PATTERN.test(normalizedPrompt) && toolPlane) {
    const best = getBestProviderForTools(
      availableProviders,
      toolPlane,
      ['workspace-write', 'shell'],
    );
    if (best && best.score > 0) {
      return buildRecommendation(
        input,
        best.provider.providerId,
        'tool-first',
        0.86,
        `${best.provider.providerId} is preferred for execution-heavy work based on live workspace-write and shell readiness.`,
        buildSignalLines(toolPlane, best.provider.providerId, []),
      );
    }
  }

  if (ANALYSIS_PATTERN.test(normalizedPrompt) && toolPlane) {
    const best = getBestProviderForTools(
      availableProviders,
      toolPlane,
      ['workspace-read', 'network', 'mcp'],
    );
    if (best && best.score > 0) {
      return buildRecommendation(
        input,
        best.provider.providerId,
        'analysis-first',
        0.82,
        `${best.provider.providerId} is preferred for analysis-heavy work based on live read, network, and MCP readiness.`,
        buildSignalLines(toolPlane, best.provider.providerId, []),
      );
    }
  }

  if (preferredProvider) {
    return buildRecommendation(
      input,
      preferredProvider.providerId,
      'balanced',
      0.76,
      `No stronger routing signal was detected, so orchestration preserves the current ${preferredProvider.providerId} session context.`,
      buildSignalLines(toolPlane, preferredProvider.providerId, requiredTools),
    );
  }

  const policyPreferred = availableProviders[0]!;
  return buildRecommendation(
    input,
    policyPreferred.providerId,
    'balanced',
    0.74,
    `${policyPreferred.providerId} is the highest-priority ready provider in the daemon-owned registry. Paid providers are never selected unless the user explicitly enables them.`,
    buildSignalLines(toolPlane, policyPreferred.providerId, requiredTools),
  );
}

export function recommendFollowUpRoute(
  input: RecommendFollowUpRouteInput,
): OrchestrationRecommendation {
  const availableProviders = sortAvailableProviders(input.providers);
  if (availableProviders.length === 0) {
    throw new Error('No providers are currently available for orchestration.');
  }

  const preferredProvider = input.preferredProviderId
    ? availableProviders.find(
        (provider) => provider.providerId === input.preferredProviderId,
      ) ?? null
    : null;

  if (input.kind === 'review') {
    const reviewProvider =
      (preferredProvider?.providerId !== input.sourceRun.providerId
        ? preferredProvider
        : null) ??
      availableProviders.find(
        (provider) => provider.providerId !== input.sourceRun.providerId,
      ) ??
      availableProviders[0];
    if (!reviewProvider) {
      throw new Error('No providers are currently available for review routing.');
    }
    return buildRecommendation(
      {
        prompt: input.sourceRun.prompt,
        workspacePath: input.workspacePath,
        providers: input.providers,
        preferredProviderId: input.preferredProviderId ?? null,
        requiredTools: [],
        toolPlane: null,
      },
      reviewProvider.providerId,
      'analysis-first',
      preferredProvider?.providerId === reviewProvider.providerId ? 0.83 : 0.88,
      `${reviewProvider.providerId} is preferred for review because CodeWave separates the reviewer from the source provider when another explicitly enabled runtime is ready.`,
    );
  }

  const verifyProvider =
    preferredProvider ?? availableProviders[0];
  if (!verifyProvider) {
    throw new Error('No providers are currently available for verify routing.');
  }
  return buildRecommendation(
      {
        prompt: input.sourceRun.prompt,
        workspacePath: input.workspacePath,
        providers: input.providers,
        preferredProviderId: input.preferredProviderId ?? null,
        requiredTools: [],
        toolPlane: null,
      },
    verifyProvider.providerId,
    'tool-first',
    preferredProvider?.providerId === verifyProvider.providerId ? 0.84 : 0.89,
    `${verifyProvider.providerId} is preferred for verification by the current provider policy; explicit preferences are preserved and paid providers are not activated implicitly.`,
  );
}

export function buildFollowUpPrompt(
  input: BuildFollowUpPromptInput,
): string {
  const sourceOutput = input.sourceOutput.trim() || 'No final assistant output was captured.';

  if (input.kind === 'review') {
    return [
      'You are the reviewer for a CodeWave follow-up run.',
      'Review the prior result for correctness, regressions, missing checks, and risky assumptions.',
      "If you find issues, list them clearly. If you do not find issues, say 'No review findings.'",
      '',
      `Source provider: ${input.sourceProviderId}`,
      `Original task: ${input.sourceRun.prompt}`,
      '',
      'Prior result:',
      sourceOutput,
    ].join('\n');
  }

  return [
    'You are the verifier for a CodeWave follow-up run.',
    'Verify the prior result and state what appears validated versus what still needs checking.',
    "If verification is incomplete, say exactly what remains. If it appears sound, say 'Verification looks clean.'",
    '',
    `Source provider: ${input.sourceProviderId}`,
    `Original task: ${input.sourceRun.prompt}`,
    '',
    'Prior result:',
    sourceOutput,
  ].join('\n');
}

export function getFollowUpRole(
  kind: FollowUpRunRequest['kind'],
): OrchestrationRole {
  return kind === 'review' ? 'reviewer' : 'verifier';
}

export function recommendDelegatedRoute(
  input: RecommendDelegatedRouteInput,
): OrchestrationRecommendation {
  const availableProviders = sortAvailableProviders(input.providers);
  if (availableProviders.length === 0) {
    throw new Error('No providers are currently available for orchestration.');
  }

  const requiredTools = normalizeRequiredTools(input.requiredTools);
  if (requiredTools.length > 0) {
    const baseRecommendation = recommendProviderRoute({
      prompt: input.prompt,
      workspacePath: input.workspacePath,
      providers: input.providers,
      preferredProviderId: input.preferredProviderId ?? null,
      requiredTools,
      toolPlane: input.toolPlane ?? null,
    });
    return {
      ...baseRecommendation,
      reason: `${baseRecommendation.reason} Delegated role: ${input.role}.`,
    };
  }

  const roleTools: RoutingToolRequirement[] =
    input.role === 'planner' || input.role === 'researcher'
      ? ['workspace-read', 'network']
      : input.role === 'verifier'
        ? ['workspace-read', 'shell']
        : ['workspace-write', 'shell'];
  const preferredFromPolicy = input.preferredProviderId
    ? availableProviders.find(
        (provider) => provider.providerId === input.preferredProviderId,
      ) ?? null
    : null;
  const bestForRole = getBestProviderForTools(
    availableProviders,
    input.toolPlane,
    roleTools,
  );
  const preferred =
    (bestForRole && bestForRole.score > 0 ? bestForRole.provider : null) ??
    preferredFromPolicy ??
    availableProviders[0];
  if (!preferred) {
    throw new Error('No providers are currently available for delegation.');
  }
  const strategy =
    input.role === 'planner' || input.role === 'researcher'
      ? 'analysis-first'
      : 'tool-first';
  return buildRecommendation(
      {
        prompt: input.prompt,
        workspacePath: input.workspacePath,
        providers: input.providers,
        preferredProviderId: input.preferredProviderId ?? null,
        requiredTools: input.requiredTools ?? [],
        toolPlane: input.toolPlane ?? null,
    },
    preferred.providerId,
    strategy,
    0.84,
    `${preferred.providerId} is preferred for ${input.role} delegation from live tool readiness plus the daemon-owned provider priority.`,
    buildSignalLines(input.toolPlane, preferred.providerId, roleTools),
  );
}

export function buildDelegatedPrompt(
  input: BuildDelegatedPromptInput,
): string {
  const sourceOutput = input.sourceOutput.trim() || 'No final assistant output was captured.';

  return [
    `You are the ${input.role} for a delegated CodeWave subtask.`,
    'Complete only the delegated scope and keep the result concise and inspectable.',
    '',
    `Source provider: ${input.sourceProviderId}`,
    `Original task: ${input.sourceRun.prompt}`,
    `Delegated subtask: ${input.prompt}`,
    '',
    'Source result:',
    sourceOutput,
  ].join('\n');
}

export function recommendHandoffRoute(
  input: RecommendHandoffRouteInput,
): OrchestrationRecommendation {
  return recommendProviderRoute({
    prompt: input.prompt,
    workspacePath: input.workspacePath,
    providers: input.providers,
    preferredProviderId: input.preferredProviderId ?? null,
    requiredTools: input.requiredTools ?? [],
    toolPlane: input.toolPlane ?? null,
  });
}

export function buildHandoffPrompt(
  input: BuildHandoffPromptInput,
): string {
  const sourceOutput = input.sourceOutput.trim() || 'No final assistant output was captured.';

  return [
    'You are continuing a handed-off CodeWave task in a new main session.',
    'Continue from the prior result instead of restarting from scratch.',
    '',
    `Source provider: ${input.sourceProviderId}`,
    `Original task: ${input.sourceRun.prompt}`,
    `Handoff instruction: ${input.prompt}`,
    '',
    'Prior result:',
    sourceOutput,
  ].join('\n');
}
