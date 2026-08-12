import type {
  ApprovalPolicy,
  OrchestrationRole,
  ProviderId,
  RoutingToolRequirement,
  RunMode,
} from '@qwemini/protocol';

export type FollowUpKind = 'review' | 'verify';
export type DelegateRole = Exclude<OrchestrationRole, 'main'>;

export type ShellControlsState = {
  workspacePath: string;
  providerId: ProviderId;
  sessionApprovalPolicy: ApprovalPolicy;
  sessionApprovalPolicyDisabled: boolean;
  runMode: RunMode;
  prompt: string;
  promptDisabled: boolean;
  routingTools: RoutingToolRequirement[];
  delegateRole: DelegateRole;
  selectedSessionApprovalPolicy: ApprovalPolicy;
  selectedSessionApprovalPolicyDisabled: boolean;
  applySelectedSessionPolicyDisabled: boolean;
  startRunDisabled: boolean;
  routeRunDisabled: boolean;
  delegateRunDisabled: boolean;
  handoffRunDisabled: boolean;
  resumeSessionDisabled: boolean;
  cancelRunDisabled: boolean;
  reviewRunDisabled: boolean;
  verifyRunDisabled: boolean;
};

export const emptyShellControlsState: ShellControlsState = {
  workspacePath: '',
  providerId: 'qwen',
  sessionApprovalPolicy: 'manual',
  sessionApprovalPolicyDisabled: false,
  runMode: 'execute',
  prompt: '',
  promptDisabled: true,
  routingTools: [],
  delegateRole: 'planner',
  selectedSessionApprovalPolicy: 'manual',
  selectedSessionApprovalPolicyDisabled: true,
  applySelectedSessionPolicyDisabled: true,
  startRunDisabled: true,
  routeRunDisabled: true,
  delegateRunDisabled: true,
  handoffRunDisabled: true,
  resumeSessionDisabled: true,
  cancelRunDisabled: true,
  reviewRunDisabled: true,
  verifyRunDisabled: true,
};
