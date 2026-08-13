import type { ChildProcess } from 'node:child_process';
import {
  inferRoutingToolRequirement,
  type ProviderRunContext,
  type RoutingToolRequirement,
} from '@codewave/protocol';
import {
  startAcpRun,
  type AcpEventPublisher,
  type AcpRunHandle,
  type AcpTransportTrace,
} from '@codewave/provider-transport';

const TOOL_REQUIREMENT_MAP: Record<string, RoutingToolRequirement> = {
  bash: 'shell',
  read: 'workspace-read',
  glob: 'workspace-read',
  grep: 'workspace-read',
  write: 'workspace-write',
  edit: 'workspace-write',
  webfetch: 'network',
  websearch: 'network',
};

export type OpenCodeAcpRunHandle = AcpRunHandle;

export function startOpenCodeAcpRun(options: {
  child: ChildProcess;
  context: ProviderRunContext;
  publish: AcpEventPublisher;
  trace?: (entry: AcpTransportTrace) => void;
}): Promise<OpenCodeAcpRunHandle> {
  return startAcpRun({
    ...options,
    profile: {
      providerId: 'opencode',
      displayName: 'OpenCode',
      surface: 'opencode.acp',
      inferToolRequirement: (toolName, input) =>
        TOOL_REQUIREMENT_MAP[toolName.trim().toLowerCase()] ??
        inferRoutingToolRequirement({ toolName, input }),
    },
  });
}
