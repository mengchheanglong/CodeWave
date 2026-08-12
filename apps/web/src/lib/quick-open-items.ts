import type {
  ApprovalPolicy,
  ProviderId,
  RoutingToolRequirement,
} from '@codewave/protocol';

type QuickOpenItem = {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  badge?: string;
  keywords?: string[];
  run: () => void | Promise<void>;
};

type StubbedItem = {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  badge?: string;
  keywords?: string[];
  runStub: string;
};

export type QuickOpenRuntime = {
  setRailView: (v: 'recent' | 'history' | 'archive' | 'flows') => void;
  setRunViewTab: (v: 'chat' | 'timeline') => void;
  setUtilityView: (
    v: 'approvals' | 'tools' | 'artifacts' | 'checkpoints',
  ) => void;
  setUtilityCollapsed: (v: boolean) => void;
  setFocusView: (v: boolean) => void;
  focusComposer: () => void;
  requestCreateSession: () => Promise<void>;
  requestStartRun: () => Promise<void>;
  requestRoutePrompt: () => Promise<void>;
  requestDelegatePrompt: () => Promise<void>;
  requestHandoffPrompt: () => Promise<void>;
  requestRecoverSelectedSession: () => Promise<void>;
  requestCancelSelectedRun: () => Promise<void>;
  requestFollowUpRun: (kind: 'review' | 'verify') => Promise<void>;
  requestApplySelectedSessionPolicy: () => Promise<void>;
  requestSessionSelection: (id: string) => Promise<void>;
  requestRunSelection: (id: string) => Promise<void>;
  shellControlsState: {
    startRunDisabled: boolean;
    routeRunDisabled: boolean;
    delegateRunDisabled: boolean;
    handoffRunDisabled: boolean;
    resumeSessionDisabled: boolean;
    cancelRunDisabled: boolean;
    reviewRunDisabled: boolean;
    verifyRunDisabled: boolean;
    applySelectedSessionPolicyDisabled: boolean;
    prompt: string;
    routingTools: RoutingToolRequirement[];
    delegateRole: string;
    selectedSessionApprovalPolicy: ApprovalPolicy;
  };
  shellPanelsState: {
    recentSessions: Array<{
      id: string;
      workspacePath: string;
      providerId: ProviderId;
      approvalPolicy: ApprovalPolicy;
      providerSessionId: string | null;
    }>;
    selectedSessionId: string | null;
    selectedProviderId: ProviderId | null;
  };
  runViewState: {
    runs: Array<{
      id: string;
      status: string;
      prompt: string;
      createdAt: string;
    }>;
    selectedRun: { id: string } | null;
  };
  focusView: boolean;
  utilityCollapsed: boolean;
};

const STATIC_ITEMS: StubbedItem[] = [
  {
    id: 'view-recent',
    group: 'Views',
    title: 'Show Recent Sessions',
    subtitle: 'Open the recent sessions list in the left rail.',
    badge: 'Recent',
    keywords: ['left column', 'workspace', 'sessions'],
    runStub: 'recent',
  },
  {
    id: 'view-runs',
    group: 'Views',
    title: 'Show Run History',
    subtitle: 'Open the run history list in the left column.',
    badge: 'Runs',
    keywords: ['left column', 'history'],
    runStub: 'runs',
  },
  {
    id: 'view-archive',
    group: 'Views',
    title: 'Show Archive',
    subtitle: 'Open archived sessions in the left column.',
    badge: 'Archive',
    keywords: ['left column', 'archive'],
    runStub: 'archive',
  },
  {
    id: 'view-flows',
    group: 'Views',
    title: 'Show Flows',
    subtitle: 'Open orchestration flows in the left column.',
    badge: 'Flows',
    keywords: ['left column', 'orchestration', 'board'],
    runStub: 'flows',
  },
  {
    id: 'show-chat',
    group: 'Run View',
    title: 'Show Thread',
    subtitle: 'Switch the main detail area to the conversation thread.',
    badge: 'Thread',
    keywords: ['run detail', 'conversation', 'thread', 'main column'],
    runStub: 'chat',
  },
  {
    id: 'show-timeline',
    group: 'Run View',
    title: 'Show Timeline',
    subtitle: 'Switch the main detail area to normalized events.',
    badge: 'Timeline',
    keywords: ['run detail', 'events', 'main column'],
    runStub: 'timeline',
  },
  {
    id: 'show-approvals',
    group: 'Utility',
    title: 'Show Approvals',
    subtitle: 'Open pending approval decisions in the right column.',
    badge: 'Approvals',
    keywords: ['right column', 'utility'],
    runStub: 'approvals',
  },
  {
    id: 'show-tools',
    group: 'Utility',
    title: 'Show Tools',
    subtitle: 'Open tool activity and registration evidence.',
    badge: 'Tools',
    keywords: ['right column', 'utility', 'tool plane'],
    runStub: 'tools',
  },
  {
    id: 'show-artifacts',
    group: 'Utility',
    title: 'Show Artifacts',
    subtitle: 'Open captured artifacts in the right column.',
    badge: 'Artifacts',
    keywords: ['right column', 'utility'],
    runStub: 'artifacts',
  },
  {
    id: 'show-checkpoints',
    group: 'Utility',
    title: 'Show Checkpoints',
    subtitle: 'Open saved recovery points in the right column.',
    badge: 'Checkpoints',
    keywords: ['right column', 'utility', 'recovery'],
    runStub: 'checkpoints',
  },
  {
    id: 'create-session',
    group: 'Actions',
    title: 'Create Session',
    subtitle:
      'Start a new session with the current workspace and provider drafts.',
    badge: 'Session',
    keywords: ['workspace', 'provider', 'approval policy'],
    runStub: 'create-session',
  },
  {
    id: 'toggle-focus',
    group: 'Actions',
    title: 'Toggle Focus View',
    subtitle: 'Hide or restore the side columns around the active run.',
    badge: 'Ctrl/Cmd+Shift+F',
    keywords: ['focus', 'layout', 'columns'],
    runStub: 'toggle-focus',
  },
  {
    id: 'focus-composer',
    group: 'Actions',
    title: 'Focus Composer',
    subtitle: 'Move the cursor into the run prompt composer.',
    badge: 'Ctrl/Cmd+Shift+J',
    keywords: ['prompt', 'editor', 'compose'],
    runStub: 'focus-composer',
  },
  {
    id: 'toggle-utility',
    group: 'Actions',
    title: 'Toggle Utility Rail',
    subtitle: 'Hide or reveal the right-side operational surface.',
    badge: 'Ctrl/Cmd+\\',
    keywords: ['utility', 'right column', 'collapse', 'panel'],
    runStub: 'toggle-utility',
  },
];

/**
 * Builds the full QuickOpen items array from static stubs + dynamic runtime data.
 */
export function buildQuickOpenItems(runtime: QuickOpenRuntime): QuickOpenItem[] {
  const items: QuickOpenItem[] = STATIC_ITEMS.map((item) => ({
    ...item,
    run: () => runStub(item.runStub, runtime),
  }));

  if (!runtime.shellControlsState.startRunDisabled) {
    items.push({
      id: 'start-run',
      group: 'Actions',
      title: 'Start Run',
      subtitle: 'Dispatch the current prompt on the selected session.',
      badge: 'Run',
      keywords: [
        runtime.shellControlsState.prompt,
        ...runtime.shellControlsState.routingTools,
      ],
      run: runtime.requestStartRun,
    });
  }

  if (!runtime.shellControlsState.routeRunDisabled) {
    items.push({
      id: 'route-run',
      group: 'Actions',
      title: 'Route Prompt',
      subtitle:
        'Ask the orchestrator to place the current prompt on the best runtime.',
      badge: 'Route',
      keywords: [
        runtime.shellControlsState.prompt,
        ...runtime.shellControlsState.routingTools,
      ],
      run: runtime.requestRoutePrompt,
    });
  }

  if (!runtime.shellControlsState.delegateRunDisabled) {
    items.push({
      id: 'delegate-run',
      group: 'Actions',
      title: 'Delegate Prompt',
      subtitle: `Send the current prompt to a ${runtime.shellControlsState.delegateRole} child run.`,
      badge: runtime.shellControlsState.delegateRole,
      keywords: [
        runtime.shellControlsState.prompt,
        runtime.shellControlsState.delegateRole,
      ],
      run: runtime.requestDelegatePrompt,
    });
  }

  if (!runtime.shellControlsState.handoffRunDisabled) {
    items.push({
      id: 'handoff-run',
      group: 'Actions',
      title: 'Handoff Prompt',
      subtitle: 'Fork a continuation session from the selected run.',
      badge: 'Handoff',
      keywords: [runtime.shellControlsState.prompt, 'continuation'],
      run: runtime.requestHandoffPrompt,
    });
  }

  if (!runtime.shellControlsState.resumeSessionDisabled) {
    items.push({
      id: 'recover-session',
      group: 'Actions',
      title: 'Recover Selected Session',
      subtitle: 'Fork a new session from the current provider session context.',
      badge: 'Recover',
      keywords: [
        'resume',
        'session',
        runtime.shellPanelsState.selectedSessionId?.slice(0, 8) ?? 'none',
      ],
      run: runtime.requestRecoverSelectedSession,
    });
  }

  if (!runtime.shellControlsState.cancelRunDisabled) {
    items.push({
      id: 'cancel-run',
      group: 'Actions',
      title: 'Cancel Selected Run',
      subtitle: 'Interrupt the active provider run through the daemon.',
      badge: 'Cancel',
      keywords: [
        'stop',
        runtime.runViewState.selectedRun?.id?.slice(0, 8) ?? 'none',
      ],
      run: runtime.requestCancelSelectedRun,
    });
  }

  if (!runtime.shellControlsState.reviewRunDisabled) {
    items.push({
      id: 'review-run',
      group: 'Actions',
      title: 'Review Selected Run',
      subtitle: 'Fork the selected run into a reviewer session.',
      badge: 'Review',
      keywords: [
        'follow-up',
        runtime.runViewState.selectedRun?.id?.slice(0, 8) ?? 'none',
      ],
      run: () => runtime.requestFollowUpRun('review'),
    });
  }

  if (!runtime.shellControlsState.verifyRunDisabled) {
    items.push({
      id: 'verify-run',
      group: 'Actions',
      title: 'Verify Selected Run',
      subtitle: 'Fork the selected run into a verifier session.',
      badge: 'Verify',
      keywords: [
        'follow-up',
        runtime.runViewState.selectedRun?.id?.slice(0, 8) ?? 'none',
      ],
      run: () => runtime.requestFollowUpRun('verify'),
    });
  }

  if (!runtime.shellControlsState.applySelectedSessionPolicyDisabled) {
    items.push({
      id: 'apply-policy',
      group: 'Actions',
      title: 'Apply Session Policy',
      subtitle: `Apply ${runtime.shellControlsState.selectedSessionApprovalPolicy} to the selected session.`,
      badge: runtime.shellControlsState.selectedSessionApprovalPolicy,
      keywords: [
        'policy',
        runtime.shellPanelsState.selectedSessionId?.slice(0, 8) ?? 'none',
      ],
      run: runtime.requestApplySelectedSessionPolicy,
    });
  }

  items.push(
    ...runtime.shellPanelsState.recentSessions.slice(0, 12).map(
      (session) => ({
        id: `session-${session.id}`,
        group: 'Sessions',
        title: `${getWorkspaceLabel(session.workspacePath)} · ${session.id.slice(0, 8)}`,
        subtitle: [
          session.providerId,
          session.approvalPolicy,
          session.workspacePath,
        ]
          .filter(Boolean)
          .join(' · '),
        badge: session.providerId,
        keywords: [
          session.id,
          session.workspacePath,
          session.providerId,
          session.approvalPolicy,
          session.providerSessionId ?? '',
        ],
        run: async () => {
          runtime.setRailView('recent');
          await runtime.requestSessionSelection(session.id);
        },
      }),
    ),
  );

  items.push(
    ...runtime.runViewState.runs.slice(0, 12).map((run) => {
      const statusLabel = run.status.replace(/_/g, ' ');
      const prompt = run.prompt.trim();
      const promptSummary =
        prompt.length > 72
          ? `${prompt.slice(0, 69)}...`
          : prompt || 'No prompt text recorded yet.';
      return {
        id: `run-${run.id}`,
        group: 'Runs',
        title: `${statusLabel} · ${run.id.slice(0, 8)}`,
        subtitle: `${formatTimestamp(run.createdAt)} · ${promptSummary}`,
        badge: 'Run',
        keywords: [run.id, run.status, run.prompt, run.createdAt],
        run: async () => {
          runtime.setRailView('history');
          await runtime.requestRunSelection(run.id);
        },
      };
    }),
  );

  return items;
}

function runStub(stub: string, runtime: QuickOpenRuntime) {
  switch (stub) {
    case 'recent':
      runtime.setRailView('recent');
      break;
    case 'runs':
      runtime.setRailView('history');
      break;
    case 'archive':
      runtime.setRailView('archive');
      break;
    case 'flows':
      runtime.setRailView('flows');
      break;
    case 'chat':
      runtime.setRunViewTab('chat');
      break;
    case 'timeline':
      runtime.setRunViewTab('timeline');
      break;
    case 'approvals':
      runtime.setUtilityView('approvals');
      break;
    case 'tools':
      runtime.setUtilityView('tools');
      break;
    case 'artifacts':
      runtime.setUtilityView('artifacts');
      break;
    case 'checkpoints':
      runtime.setUtilityView('checkpoints');
      break;
    case 'create-session':
      void runtime.requestCreateSession();
      break;
    case 'toggle-focus':
      runtime.setFocusView(!runtime.focusView);
      break;
    case 'focus-composer':
      runtime.focusComposer();
      break;
    case 'toggle-utility':
      runtime.setUtilityCollapsed(!runtime.utilityCollapsed);
      break;
  }
}

function getWorkspaceLabel(workspacePath: string) {
  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? workspacePath;
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
