import {
  isProviderId,
  type ApprovalPolicy,
  type ProviderId,
  type RoutingToolRequirement,
} from '@codewave/protocol';
import type { ReactNode } from 'react';
import { ArchiveIcon, HomeIcon, ListIcon, WorkflowIcon } from '../components/icons';
import type { DelegateRole } from './shell-controls-state';

export type RailView = 'recent' | 'history' | 'archive' | 'flows';

export type RunViewTab = 'chat' | 'timeline';

export type UtilityView =
  | 'approvals'
  | 'tools'
  | 'files'
  | 'artifacts'
  | 'checkpoints';

export function parseProviderId(value: string): ProviderId {
  return isProviderId(value) ? value : 'freebuff';
}

export function parseApprovalPolicy(value: string): ApprovalPolicy {
  return value === 'allow' || value === 'deny' ? value : 'manual';
}

export function parseDelegateRole(value: string): DelegateRole {
  return value === 'researcher' || value === 'reviewer' || value === 'verifier'
    ? value
    : 'planner';
}

export function getRailSectionLabel(view: RailView): string {
  if (view === 'history') {
    return 'Runs';
  }
  if (view === 'archive') {
    return 'Archived';
  }
  if (view === 'flows') {
    return 'Agents';
  }
  return 'Threads';
}

export function railViewIcon(view: RailView): ReactNode {
  switch (view) {
    case 'history':
      return <ListIcon size={13} />;
    case 'archive':
      return <ArchiveIcon size={13} />;
    case 'flows':
      return <WorkflowIcon size={13} />;
    default:
      return <HomeIcon size={13} />;
  }
}

export function renderProviderLabel(providerId: ProviderId): string {
  if (providerId === 'gemini') {
    return 'Gemini';
  }
  if (providerId === 'opencode') {
    return 'OpenCode';
  }
  if (providerId === 'freebuff') {
    return 'Freebuff';
  }
  if (providerId === 'qwen') return 'Qwen';
  return providerId
    .slice(4)
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ') || 'Custom ACP';
}

export function renderAccessLabel(policy: ApprovalPolicy): string {
  if (policy === 'allow') {
    return 'Full access';
  }
  if (policy === 'deny') {
    return 'Read only';
  }
  return 'Ask first';
}

export const MODE_DESCRIPTIONS: Record<ApprovalPolicy, string> = {
  manual: 'Asks before mutating tools',
  allow: 'Auto-approves tools for this session',
  deny: 'Denies mutating tools',
};

export function renderRoutingToolLabel(tool: RoutingToolRequirement): string {
  if (tool === 'workspace-read') {
    return 'Workspace Read';
  }
  if (tool === 'workspace-write') {
    return 'Workspace Write';
  }
  if (tool === 'shell') {
    return 'Shell';
  }
  if (tool === 'network') {
    return 'Network';
  }
  return 'MCP';
}
