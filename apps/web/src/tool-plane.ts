import type { ToolPlaneSnapshot } from '@codewave/protocol';

export function formatToolPlaneSummary(
  snapshot: Pick<
    ToolPlaneSnapshot,
    'providers' | 'registryPath' | 'scope' | 'sessionId' | 'mcpServers'
  > | null,
): string {
  if (!snapshot || snapshot.providers.length === 0) {
    return 'No tool-plane signals yet.';
  }

  const providerSummary = snapshot.providers
    .map((provider) => {
      const ready =
        provider.readyTools.length > 0 ? provider.readyTools.join(', ') : 'none';
      return `${provider.providerId}: ${ready}`;
    })
    .join(' | ');

  const registrySummary = snapshot.registryPath
    ? ` registry ${snapshot.registryPath}`
    : ' default registry';
  const scopeSummary =
    snapshot.scope === 'session' && snapshot.sessionId
      ? ` session ${snapshot.sessionId.slice(0, 8)}...`
      : ' workspace';
  const mcpSummary = ` | mcp ${
    snapshot.mcpServers.filter((server) => server.enabled && server.available)
      .length
  }/${snapshot.mcpServers.length} ready`;

  return `${providerSummary} |${scopeSummary} |${registrySummary}${mcpSummary}`;
}
