import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type {
  McpServerStatus,
  ProviderHealth,
  ProviderId,
  ProviderToolCapability,
  RoutingToolRequirement,
  SessionToolRegistration,
  ToolDescriptor,
  ToolInvocationRecord,
  ToolInvocationStatus,
  ToolPermissionModel,
  ToolPlaneScope,
  ToolPlaneProviderSignal,
  ToolPlaneSnapshot,
  ToolRegistryEntry,
} from '@codewave/protocol';
import { inferRoutingToolRequirement } from '@codewave/protocol';

const ALL_TOOL_REQUIREMENTS: RoutingToolRequirement[] = [
  'workspace-read',
  'workspace-write',
  'shell',
  'network',
  'mcp',
];

type WorkspaceRegistryToolConfig = Partial<
  Record<
    RoutingToolRequirement,
    {
      enabled?: boolean;
      permissionModel?: ToolPermissionModel;
      detail?: string;
    }
  >
>;

type WorkspaceMcpServerConfig = {
  command?: string;
  args?: string[];
  enabled?: boolean;
  transport?: 'stdio' | 'http';
  url?: string;
};

type WorkspaceToolRegistryConfig = {
  tools?: WorkspaceRegistryToolConfig;
  mcpServers?: Record<string, WorkspaceMcpServerConfig>;
};

export interface ObservedToolActivity {
  providerId: ProviderId;
  invocation: ToolInvocationRecord;
}

export interface WorkspaceToolRegistrySnapshot {
  workspacePath: string;
  registryPath: string | null;
  entries: ToolRegistryEntry[];
  mcpServers: McpServerStatus[];
}

export interface BuildToolPlaneSnapshotInput {
  scope: ToolPlaneScope;
  sessionId: string | null;
  workspacePath: string;
  providers: ProviderHealth[];
  providerCatalogs: Record<ProviderId, ProviderToolCapability[]>;
  observedTools: ObservedToolActivity[];
  registeredSessionTools: SessionToolRegistration[];
  workspaceRegistry: WorkspaceToolRegistrySnapshot;
}

const DEFAULT_REGISTRY_DETAILS: Record<RoutingToolRequirement, string> = {
  'workspace-read': 'Workspace reads are enabled by the shared tool-plane defaults.',
  'workspace-write': 'Workspace writes are enabled by the shared tool-plane defaults.',
  shell: 'Shell access is enabled by the shared tool-plane defaults.',
  network: 'Network access is enabled by the shared tool-plane defaults.',
  mcp: 'MCP access requires at least one enabled workspace MCP server.',
};

function isSuccessfulToolStatus(status: ToolInvocationStatus): boolean {
  return status === 'completed';
}

function normalizeRequirementOrder(
  requirements: RoutingToolRequirement[],
): RoutingToolRequirement[] {
  const unique = [...new Set(requirements)];
  return ALL_TOOL_REQUIREMENTS.filter((requirement) => unique.includes(requirement));
}

function classifyObservedRequirement(
  invocation: ToolInvocationRecord,
): RoutingToolRequirement | null {
  return inferRoutingToolRequirement({
    toolName: invocation.toolName,
    detail: invocation.detail,
    input: invocation.input,
    metadata: invocation.metadata,
  });
}

function getDefaultPermissionModel(
  requirement: RoutingToolRequirement,
): ToolPermissionModel {
  if (requirement === 'workspace-read') {
    return 'auto';
  }

  return 'ask';
}

function isCommandAvailable(command: string): boolean {
  if (path.isAbsolute(command)) {
    return existsSync(command);
  }

  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookup, [command], {
    encoding: 'utf8',
    stdio: 'ignore',
  });
  return result.status === 0;
}

function getRegistryCandidates(workspacePath: string): string[] {
  return [
    path.join(workspacePath, '.codewave', 'mcp.json'),
    path.join(workspacePath, '.mcp.json'),
  ];
}

function parseWorkspaceRegistryConfig(filePath: string): WorkspaceToolRegistryConfig | null {
  try {
    return JSON.parse(
      readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''),
    ) as WorkspaceToolRegistryConfig;
  } catch {
    return null;
  }
}

export function loadWorkspaceToolRegistry(
  workspacePath: string,
): WorkspaceToolRegistrySnapshot {
  const registryPath =
    getRegistryCandidates(workspacePath).find((candidate) => existsSync(candidate)) ?? null;
  const config = registryPath ? parseWorkspaceRegistryConfig(registryPath) : null;

  const entries: ToolRegistryEntry[] = ALL_TOOL_REQUIREMENTS.map((requirement) => {
    const override = config?.tools?.[requirement];
    return {
      requirement,
      enabled: override?.enabled ?? true,
      permissionModel: override?.permissionModel ?? getDefaultPermissionModel(requirement),
      source: override ? 'workspace' : 'default',
      detail: override?.detail ?? DEFAULT_REGISTRY_DETAILS[requirement],
    };
  });

  const mcpServers: McpServerStatus[] = Object.entries(config?.mcpServers ?? {}).map(
    ([id, server]) => {
      const transport = server.transport ?? (server.url ? 'http' : 'stdio');
      const enabled = server.enabled !== false;
      const command = server.command ?? null;
      const url = server.url ?? null;
      const available =
        enabled &&
        (transport === 'http'
          ? typeof url === 'string' && /^https?:\/\//.test(url)
          : command !== null && isCommandAvailable(command));
      const detail =
        transport === 'http'
          ? available
            ? 'Configured HTTP MCP endpoint is syntactically valid.'
            : 'Configured HTTP MCP endpoint is missing or invalid.'
          : enabled
            ? available
              ? `Configured stdio MCP command '${command}' is available on this machine.`
              : `Configured stdio MCP command '${command}' was not found on this machine.`
            : 'Workspace MCP server is disabled.';

      return {
        id,
        enabled,
        transport,
        command,
        url,
        available,
        detail,
      };
    },
  );

  return {
    workspacePath,
    registryPath,
    entries,
    mcpServers,
  };
}

function isRequirementEnabled(
  registry: WorkspaceToolRegistrySnapshot,
  requirement: RoutingToolRequirement,
): boolean {
  return registry.entries.find((entry) => entry.requirement === requirement)?.enabled ?? true;
}

function isMcpReady(registry: WorkspaceToolRegistrySnapshot): boolean {
  if (!isRequirementEnabled(registry, 'mcp')) {
    return false;
  }

  return registry.mcpServers.some((server) => server.enabled && server.available);
}

function buildProviderSummary(
  providerId: ProviderId,
  available: boolean,
  readyTools: RoutingToolRequirement[],
  recentInvocationCount: number,
  recentSuccessCount: number,
  sessionRegisteredCount: number,
  providerEnumeratedCount: number,
  registry: WorkspaceToolRegistrySnapshot,
  scope: ToolPlaneScope,
): string {
  const readyText =
    readyTools.length > 0 ? readyTools.join(', ') : 'no normalized tools ready';
  const historyLabel = scope === 'session' ? 'session-local' : 'workspace-local';
  const recentText =
    recentInvocationCount > 0
      ? `${recentSuccessCount}/${recentInvocationCount} recent ${historyLabel} tool completions`
      : `no recent ${historyLabel} tool history yet`;
  const mcpText =
    registry.mcpServers.length > 0
      ? `${registry.mcpServers.filter((server) => server.available && server.enabled).length}/${registry.mcpServers.length} MCP servers ready`
      : 'no workspace MCP servers configured';
  const sessionText =
    scope === 'session'
      ? `${sessionRegisteredCount} live session-registered tools (${providerEnumeratedCount} provider-enumerated)`
      : 'workspace scope';
  return `${providerId} ready: ${readyText}; ${recentText}; ${sessionText}; ${mcpText}; ${
    available ? 'runtime available' : 'runtime unavailable'
  }.`;
}

export function buildToolPlaneSnapshot(
  input: BuildToolPlaneSnapshotInput,
): ToolPlaneSnapshot {
  const descriptorMap = new Map<string, ToolDescriptor>();

  for (const provider of input.providers) {
    const providerTools = input.providerCatalogs[provider.providerId] ?? [];
    for (const seed of providerTools) {
      const registryEntry = input.workspaceRegistry.entries.find(
        (entry) => entry.requirement === seed.requirement,
      );
      const id = `${provider.providerId}:${seed.requirement}`;
      descriptorMap.set(id, {
        id,
        name: seed.name,
        providerId: provider.providerId,
        source: seed.source,
        requirement: seed.requirement,
        permissionModel: registryEntry?.permissionModel ?? seed.permissionModel,
        available: provider.available && (registryEntry?.enabled ?? true),
        detail: registryEntry?.detail ?? seed.detail,
        observedInvocationCount: 0,
        observedSuccessCount: 0,
      });
    }
  }

  for (const observed of input.observedTools) {
    const requirement = classifyObservedRequirement(observed.invocation);
    if (!requirement) {
      continue;
    }

    const registryEntry = input.workspaceRegistry.entries.find(
      (entry) => entry.requirement === requirement,
    );
    const id = `${observed.providerId}:${requirement}`;
    const existing = descriptorMap.get(id);
    const current = existing ?? {
      id,
      name: requirement,
      providerId: observed.providerId,
      source: requirement === 'mcp' ? 'mcp' : 'provider',
      requirement,
      permissionModel:
        registryEntry?.permissionModel ?? getDefaultPermissionModel(requirement),
      available:
        (input.providers.find((provider) => provider.providerId === observed.providerId)
          ?.available ?? false) && (registryEntry?.enabled ?? true),
      detail: registryEntry?.detail ?? 'Observed from the daemon-owned tool ledger.',
      observedInvocationCount: 0,
      observedSuccessCount: 0,
    };

    current.observedInvocationCount += 1;
    if (isSuccessfulToolStatus(observed.invocation.status)) {
      current.observedSuccessCount += 1;
    }

    descriptorMap.set(id, current);
  }

  for (const mcpServer of input.workspaceRegistry.mcpServers) {
    const id = `workspace:mcp:${mcpServer.id}`;
    descriptorMap.set(id, {
      id,
      name: mcpServer.id,
      providerId: null,
      source: 'mcp',
      requirement: 'mcp',
      permissionModel:
        input.workspaceRegistry.entries.find((entry) => entry.requirement === 'mcp')
          ?.permissionModel ?? 'ask',
      available: mcpServer.enabled && mcpServer.available,
      detail: mcpServer.detail,
      observedInvocationCount: 0,
      observedSuccessCount: 0,
    });
  }

  for (const registration of input.registeredSessionTools) {
    const registryEntry = input.workspaceRegistry.entries.find(
      (entry) => entry.requirement === registration.requirement,
    );
    const id = `${registration.providerId}:${registration.requirement}`;
    const existing = descriptorMap.get(id);
    const isRegistrationMcpReady =
      registration.requirement === 'mcp'
        ? isMcpReady(input.workspaceRegistry)
        : true;
    if (existing) {
      existing.observedInvocationCount = Math.max(
        existing.observedInvocationCount,
        registration.seenCount,
      );
      if (registration.lastStatus === 'completed') {
        existing.observedSuccessCount = Math.max(existing.observedSuccessCount, 1);
      }
      existing.detail = registration.metadata?.detail
        ? String(registration.metadata.detail)
        : `Live session registration from ${registration.toolName}.`;
      existing.available =
        existing.available && (registryEntry?.enabled ?? true) && isRegistrationMcpReady;
      descriptorMap.set(id, existing);
      continue;
    }

    descriptorMap.set(id, {
      id,
      name: registration.toolName,
      providerId: registration.providerId,
      source: registration.source,
      requirement: registration.requirement,
      permissionModel:
        registryEntry?.permissionModel ?? getDefaultPermissionModel(registration.requirement),
      available:
        (input.providers.find((provider) => provider.providerId === registration.providerId)
          ?.available ?? false) &&
        (registryEntry?.enabled ?? true) &&
        isRegistrationMcpReady,
      detail:
        registration.metadata?.detail
          ? String(registration.metadata.detail)
          : `Live session registration from ${registration.toolName}.`,
      observedInvocationCount: registration.seenCount,
      observedSuccessCount: registration.lastStatus === 'completed' ? 1 : 0,
    });
  }

  const providerSignals: ToolPlaneProviderSignal[] = input.providers.map((provider) => {
    const toolDescriptors = [...descriptorMap.values()].filter(
      (descriptor) => descriptor.providerId === provider.providerId,
    );
    const sessionRegisteredTools = normalizeRequirementOrder(
      input.registeredSessionTools
        .filter((registration) => registration.providerId === provider.providerId)
        .map((registration) => registration.requirement),
    );
    const sessionRegisteredCount = input.registeredSessionTools.filter(
      (registration) => registration.providerId === provider.providerId,
    ).length;
    const providerEnumeratedCount = input.registeredSessionTools.filter(
      (registration) =>
        registration.providerId === provider.providerId &&
        registration.metadata?.registrationKind === 'provider-enumeration',
    ).length;
    const readyTools = normalizeRequirementOrder(
      toolDescriptors
        .filter((descriptor) => {
          if (!descriptor.available) {
            return false;
          }

          if (descriptor.requirement === 'mcp') {
            return isMcpReady(input.workspaceRegistry);
          }

          return (
            descriptor.observedInvocationCount > 0 ||
            (input.providerCatalogs[provider.providerId] ?? []).some(
              (seed) => seed.requirement === descriptor.requirement,
            )
          );
        })
        .map((descriptor) => descriptor.requirement),
    );
    const recentInvocationCount = toolDescriptors.reduce(
      (total, descriptor) => total + descriptor.observedInvocationCount,
      0,
    );
    const recentSuccessCount = toolDescriptors.reduce(
      (total, descriptor) => total + descriptor.observedSuccessCount,
      0,
    );

    return {
      providerId: provider.providerId,
      available: provider.available,
      readyTools,
      missingTools: ALL_TOOL_REQUIREMENTS.filter(
        (requirement) => !readyTools.includes(requirement),
      ),
      recentInvocationCount,
      recentSuccessCount,
      sessionRegisteredTools,
      sessionRegisteredCount,
      summary: buildProviderSummary(
        provider.providerId,
        provider.available,
        readyTools,
        recentInvocationCount,
        recentSuccessCount,
        sessionRegisteredCount,
        providerEnumeratedCount,
        input.workspaceRegistry,
        input.scope,
      ),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    scope: input.scope,
    sessionId: input.sessionId,
    workspacePath: input.workspacePath,
    registryPath: input.workspaceRegistry.registryPath,
    registryEntries: input.workspaceRegistry.entries,
    mcpServers: input.workspaceRegistry.mcpServers,
    registeredSessionTools: input.registeredSessionTools,
    tools: [...descriptorMap.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    providers: providerSignals,
  };
}
