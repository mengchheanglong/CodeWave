import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { ProviderId } from '@codewave/protocol';
import {
  initializeShell,
  requestApplySelectedSessionPolicy,
  requestCancelSelectedRun,
  requestCreateSession,
  requestDelegatePrompt,
  requestFollowUpRun,
  requestHandoffPrompt,
  requestRecoverSelectedSession,
  requestRuntimeRefresh,
  requestRoutePrompt,
  requestRunSelection,
  requestSelectedSessionPolicyDraftChange,
  requestSessionDelete,
  requestSessionDraftChange,
  requestSessionSelection,
  requestStartRun,
  requestUndoRun,
  requestWorkspaceDraftCommit,
  subscribeShellControlsState,
  subscribeShellPanelsState,
  subscribeShellSummaryState,
  subscribeRunViewState,
} from './app-controller';
import { ComparePanel } from './components/ComparePanel';
import { PromptModal } from './components/PromptModal';
import { ProviderSettings } from './components/ProviderSettings';
import { QuickOpen } from './components/QuickOpen';
import { Composer } from './components/shell/Composer';
import { ConversationHeader } from './components/shell/ConversationHeader';
import { HintBar } from './components/shell/HintBar';
import { Inspector, type UtilityTab } from './components/shell/Inspector';
import { RunSurface } from './components/shell/RunSurface';
import { RunToolbar } from './components/shell/RunToolbar';
import { Sidebar, type RailTab } from './components/shell/Sidebar';
import { StatusStrip } from './components/shell/StatusStrip';
import { ThreadTabs } from './components/shell/ThreadTabs';
import {
  BrainIcon,
  FileTextIcon,
  FolderIcon,
  ScaleIcon,
  WorkflowIcon,
  WrenchIcon,
} from './components/icons';
import { splitRunInspectorViews } from './lib/run-inspector-views';
import {
  emptyRunViewState,
  type RunViewState,
} from './lib/run-view-state';
import {
  emptyShellControlsState,
  type ShellControlsState,
} from './lib/shell-controls-state';
import {
  emptyShellPanelsState,
  type ShellPanelsState,
} from './lib/shell-panels-state';
import {
  emptyShellSummaryState,
  type ShellSummaryState,
} from './lib/shell-summary-state';
import { useShellLayout } from './lib/use-shell-layout';
import { useAutoResizeTextarea } from './lib/use-auto-resize-textarea';
import { useKeyboardShortcuts } from './lib/use-keyboard-shortcuts';
import { useFocusContainment } from './lib/use-focus-containment';
import { createDaemonApi } from './lib/daemon-api';
import { applyTheme, readInitialTheme, type AppTheme } from './lib/theme';
import {
  attentionNotificationsEnabled,
  requestAttentionPermission,
  toggleAttentionNotifications,
} from './lib/attention-notifications';
import { getWorkspaceLabel } from './lib/quick-open-helpers.js';
import { buildQuickOpenItems } from './lib/quick-open-items.js';
import { formatTimestamp } from './shell-status-summary';
import {
  parseApprovalPolicy,
  type RailView,
  type RunViewTab,
  type UtilityView,
} from './lib/shell-format';

const UTILITY_COLLAPSED_KEY = 'codewave:utility-collapsed';

function readInitialUtilityCollapsed() {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(UTILITY_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function includesSearch(value: string, needle: string): boolean {
  if (!needle) {
    return true;
  }

  return value.toLowerCase().includes(needle);
}

export default function App() {
  const [runViewState, setRunViewState] = useState<RunViewState>(
    emptyRunViewState,
  );
  const [shellControlsState, setShellControlsState] =
    useState<ShellControlsState>(emptyShellControlsState);
  const [shellPanelsState, setShellPanelsState] =
    useState<ShellPanelsState>(emptyShellPanelsState);
  const [shellSummaryState, setShellSummaryState] =
    useState<ShellSummaryState>(emptyShellSummaryState);
  const [railView, setRailView] = useState<RailView>('recent');
  const [runViewTab, setRunViewTab] = useState<RunViewTab>('chat');
  const [utilityView, setUtilityView] = useState<UtilityView>('approvals');
  const [utilityCollapsed, setUtilityCollapsed] = useState(() =>
    readInitialUtilityCollapsed(),
  );
  const [focusView, setFocusView] = useState(false);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [compareVisible, setCompareVisible] = useState(false);
  const [showSessionSetup, setShowSessionSetup] = useState(false);
  const [showRunToolbar, setShowRunToolbar] = useState(true);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [timelineExpandedAll, setTimelineExpandedAll] = useState(false);
  const [timelineExpandSignal, setTimelineExpandSignal] = useState(0);
  const [showThinking, setShowThinking] = useState(true);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(false);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
  const [pendingUndoDetail, setPendingUndoDetail] = useState<string | null>(null);
  const [compactNavigationOpen, setCompactNavigationOpen] = useState(false);
  const [attentionBellOn, setAttentionBellOn] = useState(() =>
    attentionNotificationsEnabled(),
  );
  const [appTheme] = useState<AppTheme>(() => readInitialTheme());
  const [railFilter, setRailFilter] = useState('');
  const { textareaRef, autoResize } = useAutoResizeTextarea();
  const compareApiRef = useRef(
    createDaemonApi({
      onProviderRevisionConflict: async () => {
        await requestRuntimeRefresh();
      },
    }),
  );

  useEffect(() => {
    applyTheme(appTheme);
  }, [appTheme]);

  useEffect(() => {
    const providerId =
      shellPanelsState.selectedProviderId ?? shellControlsState.providerId;
    document.documentElement.dataset.accent = providerId;
  }, [
    shellPanelsState.selectedProviderId,
    shellControlsState.providerId,
  ]);

  const railFilterInputRef = useRef<HTMLInputElement | null>(null);
  const compactNavigationToggleRef = useRef<HTMLButtonElement | null>(null);
  const compactNavigationRef = useRef<HTMLElement | null>(null);
  const utilityToggleRef = useRef<HTMLButtonElement | null>(null);

  const closeCompactNavigation = useCallback((restoreFocus = false) => {
    setCompactNavigationOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => compactNavigationToggleRef.current?.focus(), 0);
    }
  }, []);

  const closeProviderSettings = useCallback(() => {
    setProviderSettingsOpen(false);
    if (window.matchMedia('(max-width: 700px)').matches) {
      window.setTimeout(() => compactNavigationToggleRef.current?.focus(), 0);
    }
  }, []);

  const {
    leftColumnWidth,
    rightColumnWidth,
    startLeftResize,
    startRightResize,
  } = useShellLayout();

  useFocusContainment(
    compactNavigationOpen,
    compactNavigationRef,
    railFilterInputRef,
  );

  const inspectorViews = useMemo(
    () => splitRunInspectorViews(runViewState.events),
    [runViewState.events],
  );

  useEffect(() => {
    const unsubscribeRunView = subscribeRunViewState((nextState) => {
      setRunViewState(nextState);
    });
    const unsubscribeShellControls = subscribeShellControlsState((nextState) => {
      setShellControlsState(nextState);
    });
    const unsubscribeShellPanels = subscribeShellPanelsState((nextState) => {
      setShellPanelsState(nextState);
    });
    const unsubscribeShellSummary = subscribeShellSummaryState((nextState) => {
      setShellSummaryState(nextState);
    });

    void initializeShell();

    return () => {
      unsubscribeRunView();
      unsubscribeShellControls();
      unsubscribeShellPanels();
      unsubscribeShellSummary();
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        UTILITY_COLLAPSED_KEY,
        utilityCollapsed ? 'true' : 'false',
      );
    } catch {}
  }, [utilityCollapsed]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }

    const compactWorkbench = window.matchMedia('(max-width: 1180px)');
    const collapseForCompactWorkbench = () => {
      if (compactWorkbench.matches) {
        setUtilityCollapsed(true);
      }
    };

    collapseForCompactWorkbench();
    compactWorkbench.addEventListener('change', collapseForCompactWorkbench);
    return () => {
      compactWorkbench.removeEventListener('change', collapseForCompactWorkbench);
    };
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }

    const compactNavigation = window.matchMedia('(max-width: 700px)');
    const closeAfterDesktopResize = () => {
      if (!compactNavigation.matches) {
        setCompactNavigationOpen(false);
      }
    };

    closeAfterDesktopResize();
    compactNavigation.addEventListener('change', closeAfterDesktopResize);
    return () => {
      compactNavigation.removeEventListener('change', closeAfterDesktopResize);
    };
  }, []);

  useEffect(() => {
    if (!compactNavigationOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCompactNavigation(true);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [closeCompactNavigation, compactNavigationOpen]);

  useEffect(() => {
    if (!runMenuOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest('.run-toolbar-v2-menu')) {
        return;
      }
      setRunMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setRunMenuOpen(false);
      }
    }
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [runMenuOpen]);

  useEffect(() => {
    if (utilityCollapsed || typeof window.matchMedia !== 'function') {
      return;
    }

    const compactWorkbench = window.matchMedia('(max-width: 1180px)');
    if (!compactWorkbench.matches) {
      return;
    }

    function closeCompactInspector(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setUtilityCollapsed(true);
      const toggle = utilityToggleRef.current;
      window.setTimeout(() => toggle?.focus(), 0);
    }

    window.addEventListener('keydown', closeCompactInspector);
    return () => window.removeEventListener('keydown', closeCompactInspector);
  }, [utilityCollapsed]);

  const hasActiveSession = Boolean(shellPanelsState.selectedSessionId);

  useKeyboardShortcuts({
    railFilterInputRef,
    setQuickOpenVisible,
    setCompareVisible,
    setFocusView,
    setUtilityCollapsed,
    setRailView,
    setRunViewTab,
    setUtilityView,
    setShowThinking,
    focusComposer,
    hasActiveSession,
    shellControlsState,
    shellPanelsState,
    onPolicyChange: (nextPolicy) => {
      handleComposerPolicyChangeRef.current(nextPolicy);
    },
  });

  const normalizedRailFilter = railFilter.trim().toLowerCase();

  const filteredRecentSessions = useMemo(
    () =>
      shellPanelsState.recentSessions.filter((session) => {
        const haystack = [
          session.id,
          session.workspacePath,
          session.providerId,
          session.approvalPolicy,
          session.latestRunPrompt ?? '',
          session.orchestration?.kind ?? '',
          session.orchestration?.role ?? '',
          session.recovery?.kind ?? '',
        ].join(' ');
        return includesSearch(haystack, normalizedRailFilter);
      }),
    [shellPanelsState.recentSessions, normalizedRailFilter],
  );

  const filteredRuns = useMemo(
    () =>
      runViewState.runs.filter((run) => {
        const haystack = [run.id, run.status, run.prompt, run.createdAt].join(' ');
        return includesSearch(haystack, normalizedRailFilter);
      }),
    [runViewState.runs, normalizedRailFilter],
  );

  const filteredArchiveSessions = useMemo(
    () =>
      shellPanelsState.archiveSessions.filter((summary) => {
        const haystack = [
          summary.session.id,
          summary.session.workspacePath,
          summary.session.providerId,
          summary.session.approvalPolicy,
          summary.latestRun?.prompt ?? '',
          summary.latestRun?.status ?? '',
          summary.session.orchestration?.kind ?? '',
          summary.session.orchestration?.role ?? '',
          summary.session.recovery?.kind ?? '',
        ].join(' ');
        return includesSearch(haystack, normalizedRailFilter);
      }),
    [shellPanelsState.archiveSessions, normalizedRailFilter],
  );

  const filteredOrchestrationFlows = useMemo(
    () =>
      shellPanelsState.orchestrationFlows.filter((flow) => {
        const rootHaystack = [
          flow.rootSession.id,
          flow.rootSession.workspacePath,
          flow.rootSession.providerId,
          flow.rootSession.approvalPolicy,
          flow.rootLatestRun?.prompt ?? '',
          flow.rootLatestRun?.status ?? '',
        ].join(' ');

        if (includesSearch(rootHaystack, normalizedRailFilter)) {
          return true;
        }

        return flow.sessions.some((summary) => {
          const sessionHaystack = [
            summary.session.id,
            summary.session.workspacePath,
            summary.session.providerId,
            summary.session.approvalPolicy,
            summary.session.orchestration?.kind ?? '',
            summary.session.orchestration?.role ?? '',
            summary.latestRun?.prompt ?? '',
            summary.latestRun?.status ?? '',
          ].join(' ');
          return includesSearch(sessionHaystack, normalizedRailFilter);
        });
      }),
    [shellPanelsState.orchestrationFlows, normalizedRailFilter],
  );

  const shellStyle = useMemo(
    () =>
      ({
        '--left-column-width': `${leftColumnWidth}px`,
        '--right-column-width': `${rightColumnWidth}px`,
      }) as CSSProperties,
    [leftColumnWidth, rightColumnWidth],
  );

  const railSectionBadge =
    railView === 'history'
      ? filteredRuns.length
      : railView === 'archive'
        ? filteredArchiveSessions.length
        : railView === 'flows'
          ? filteredOrchestrationFlows.length
          : filteredRecentSessions.length;

  const railTabs: RailTab[] = useMemo(
    () => [
      { id: 'recent', label: 'Recent', badge: filteredRecentSessions.length },
      { id: 'history', label: 'Runs', badge: filteredRuns.length },
      { id: 'archive', label: 'Archive', badge: filteredArchiveSessions.length },
      { id: 'flows', label: 'Flows', badge: filteredOrchestrationFlows.length },
    ],
    [
      filteredArchiveSessions.length,
      filteredOrchestrationFlows.length,
      filteredRecentSessions.length,
      filteredRuns.length,
    ],
  );

  const pendingApprovalCount = shellPanelsState.approvals.filter(
    (approval) => approval.status === 'requested',
  ).length;
  const utilityTabs: UtilityTab[] = useMemo(
    () => [
      {
        id: 'approvals',
        label: 'Pending',
        badge: pendingApprovalCount,
        hot: pendingApprovalCount > 0,
        icon: <ScaleIcon size={13} />,
      },
      {
        id: 'tools',
        label: 'Activity',
        badge: shellPanelsState.tools.length,
        icon: <WrenchIcon size={13} />,
      },
      {
        id: 'files',
        label: 'Files',
        icon: <FolderIcon size={13} />,
      },
      {
        id: 'changes',
        label: 'Changes',
        icon: <WorkflowIcon size={13} />,
      },
      {
        id: 'artifacts',
        label: 'Artifacts',
        badge: shellPanelsState.artifacts.length,
        icon: <FileTextIcon size={13} />,
      },
      {
        id: 'checkpoints',
        label: 'Context',
        badge: shellPanelsState.checkpoints.length,
        icon: <BrainIcon size={13} />,
      },
    ],
    [
      pendingApprovalCount,
      shellPanelsState.approvals.length,
      shellPanelsState.artifacts.length,
      shellPanelsState.checkpoints.length,
      shellPanelsState.tools.length,
    ],
  );
  const activeRunId = runViewState.selectedRun?.id?.slice(0, 8) ?? 'none';
  const activeSessionId =
    shellPanelsState.selectedSessionId?.slice(0, 8) ?? 'none';
  const hasActiveRun = Boolean(runViewState.selectedRun);
  const runAcceptsSteering = Boolean(
    runViewState.selectedRun &&
      ['queued', 'running', 'awaiting_approval'].includes(
        runViewState.selectedRun.status,
      ),
  );
  const hasPromptDraft = shellControlsState.prompt.trim().length > 0;
  const conversationTitle = hasActiveSession ? shellSummaryState.runTitle : 'New chat';
  const conversationWorkspace = shellControlsState.workspacePath
    ? getWorkspaceLabel(shellControlsState.workspacePath)
    : 'Workspace';
  const menuWorkspaceContext = useMemo(() => {
    const normalized = shellControlsState.workspacePath.trim();
    if (!normalized) {
      return conversationWorkspace;
    }

    const segments = normalized.split(/[\\/]/).filter(Boolean);
    const leaf = segments.at(-1) ?? normalized;
    const parent = segments.at(-2) ?? null;
    if (leaf.toLowerCase() === 'codewave' && parent) {
      return `${parent}/${leaf}`;
    }

    return leaf;
  }, [shellControlsState.workspacePath, conversationWorkspace]);
  const activeProviderId: ProviderId =
    shellPanelsState.selectedProviderId ?? shellControlsState.providerId;
  const activeApprovalPolicy = hasActiveSession
    ? shellControlsState.selectedSessionApprovalPolicy
    : shellControlsState.sessionApprovalPolicy;

  const contextUsageChars = useMemo(() => {
    if (runViewState.contextChars > 0) {
      return runViewState.contextChars;
    }
    let chars = 0;
    for (const event of runViewState.events) {
      const payload = event.payload as Record<string, unknown> | undefined;
      if (
        event.type === 'run.output.delta' &&
        typeof payload?.text === 'string'
      ) {
        chars += payload.text.length;
      } else if (
        event.type === 'message.created' &&
        typeof payload?.content === 'string'
      ) {
        chars += payload.content.length;
      } else if (
        event.type.startsWith('tool.') &&
        payload &&
        typeof payload.input === 'object' &&
        payload.input !== null
      ) {
        chars += JSON.stringify(payload.input).length;
      }
    }
    return chars;
  }, [runViewState.events, runViewState.contextChars]);
  const contextUsagePercent = Math.min(
    100,
    Math.round((contextUsageChars / 250000) * 100),
  );
  const composerPlaceholder = runAcceptsSteering
    ? 'Queue an update while the agent works'
    : hasActiveSession
      ? 'Ask for follow-up changes'
    : 'Ask CodeWave to work on this workspace';
  const sendHelperPrimary = runAcceptsSteering
    ? 'Enter to queue update'
    : hasActiveSession
      ? 'Enter to send'
    : 'Enter to send and create the session';
  const sendHelperSecondary = 'Shift+Enter adds a new line';
  const composerHint = shellControlsState.promptDisabled
    ? 'Choose an available provider to enable the composer.'
    : !shellControlsState.workspacePath.trim()
      ? 'Open a folder or set a workspace path in the left rail — sending will create the thread automatically.'
      : hasPromptDraft
        ? `${sendHelperPrimary}. ${sendHelperSecondary}.`
        : 'Type a message below, then press Enter or click Send.';

  function focusComposer() {
    const promptInput = document.querySelector(
      '#prompt-input',
    ) as HTMLTextAreaElement | null;
    promptInput?.focus();
  }

  function handleComposerPolicyChange(value: string) {
    const nextPolicy = parseApprovalPolicy(value);
    if (hasActiveSession) {
      void requestSelectedSessionPolicyDraftChange(nextPolicy).then(() => {
        void requestApplySelectedSessionPolicy();
      });
      return;
    }

    void requestSessionDraftChange({
      sessionApprovalPolicy: nextPolicy,
    });
  }

  const handleComposerPolicyChangeRef = useRef(handleComposerPolicyChange);
  handleComposerPolicyChangeRef.current = handleComposerPolicyChange;

  function handleAddFolderToRail() {
    setIsFolderModalOpen(true);
  }

  async function handleOpenWorkspace(nextWorkspacePath: string): Promise<void> {
    const normalized = nextWorkspacePath.replace(/\\/g, '/').toLowerCase();
    const existingSession = shellPanelsState.recentSessions.find(
      (session) => session.workspacePath.replace(/\\/g, '/').toLowerCase() === normalized,
    );
    if (existingSession) {
      await requestSessionSelection(existingSession.id);
    } else {
      await requestSessionDraftChange({ workspacePath: nextWorkspacePath });
      await requestWorkspaceDraftCommit();
      await requestCreateSession();
    }
    setUtilityView('changes');
    setUtilityCollapsed(false);
  }

  function handleFolderConfirm(nextWorkspacePathInput: string) {
    const nextWorkspacePath = nextWorkspacePathInput.trim();
    if (!nextWorkspacePath) {
      return;
    }

    void (async () => {
      await requestSessionDraftChange({ workspacePath: nextWorkspacePath });
      await requestWorkspaceDraftCommit();
      await requestCreateSession();
    })();
  }

  function handleToggleBell() {
    if (attentionBellOn) {
      toggleAttentionNotifications(false);
      setAttentionBellOn(false);
    } else {
      requestAttentionPermission();
      toggleAttentionNotifications(true);
      setAttentionBellOn(true);
    }
  }

  const quickOpenItems = useMemo(
    () => buildQuickOpenItems({
      setRailView,
      setRunViewTab,
      setUtilityView,
      setUtilityCollapsed,
      setFocusView,
      focusComposer,
      requestCreateSession,
      requestStartRun,
      requestRoutePrompt,
      requestDelegatePrompt,
      requestHandoffPrompt,
      requestRecoverSelectedSession,
      requestCancelSelectedRun,
      requestFollowUpRun,
      requestApplySelectedSessionPolicy,
      requestSessionSelection: async (id: string) => {
        await requestSessionSelection(id);
      },
      requestRunSelection: async (id: string) => {
        await requestRunSelection(id);
      },
      shellControlsState,
      shellPanelsState,
      runViewState,
      focusView,
      utilityCollapsed,
    }),
    [
      activeRunId,
      activeSessionId,
      focusView,
      runViewState.runs,
      shellControlsState,
      shellPanelsState.recentSessions,
      utilityCollapsed,
    ],
  );

  return (
    <div className="shell app-shell">
      <div
        id="toast-container"
        className="toast-container"
        aria-live="polite"
        aria-atomic="true"
      ></div>

      <QuickOpen
        open={quickOpenVisible}
        items={quickOpenItems}
        onClose={() => {
          setQuickOpenVisible(false);
        }}
      />

      <ComparePanel
        open={compareVisible}
        prompt={shellControlsState.prompt}
        workspacePath={shellControlsState.workspacePath}
        providerRevision={shellPanelsState.providerRegistry?.revision ?? null}
        providers={shellPanelsState.providerRegistry?.providers ?? []}
        api={compareApiRef.current}
        onClose={() => {
          setCompareVisible(false);
        }}
        formatTimestamp={formatTimestamp}
      />

      <StatusStrip
        shellControlsState={shellControlsState}
        shellPanelsState={shellPanelsState}
        shellSummaryState={shellSummaryState}
        workspaceLabel={conversationWorkspace}
        workspaceTitle={menuWorkspaceContext}
        contextUsagePercent={contextUsagePercent}
        attentionBellOn={attentionBellOn}
        onToggleBell={handleToggleBell}
        compactNavigationOpen={compactNavigationOpen}
        onToggleCompactNavigation={() => {
          setCompactNavigationOpen((current) => {
            if (!current) {
              setUtilityCollapsed(true);
            }
            return !current;
          });
        }}
        compactNavigationToggleRef={compactNavigationToggleRef}
      />

      <section
        className={`workbench-shell panes-workbench${focusView ? ' workbench-shell-focus' : ''}${
          compactNavigationOpen ? ' compact-navigation-open' : ''
        }`}
        style={shellStyle}
      >
        <Sidebar
          shellControlsState={shellControlsState}
          shellPanelsState={shellPanelsState}
          shellSummaryState={shellSummaryState}
          runViewState={runViewState}
          onAddFolder={() => {
            closeCompactNavigation();
            handleAddFolderToRail();
          }}
          onOpenProviderSettings={() => {
            closeCompactNavigation();
            setProviderSettingsOpen(true);
          }}
          showSessionSetup={showSessionSetup}
          onToggleSessionSetup={() => {
            setShowSessionSetup((current) => !current);
          }}
          railView={railView}
          onRailViewChange={setRailView}
          railFilter={railFilter}
          onRailFilterChange={setRailFilter}
          railSectionBadge={railSectionBadge}
          railTabs={railTabs}
          filteredRecentSessions={filteredRecentSessions}
          filteredRuns={filteredRuns}
          filteredArchiveSessions={filteredArchiveSessions}
          filteredOrchestrationFlows={filteredOrchestrationFlows}
          onSelectSession={(sessionId) => {
            closeCompactNavigation();
            void requestSessionSelection(sessionId);
          }}
          onSelectRun={(runId) => {
            closeCompactNavigation();
            void requestRunSelection(runId);
          }}
          onDeleteWorkspaceGroup={(workspacePath) => {
            const sessionsInWorkspace = shellPanelsState.recentSessions.filter(
              (session) => session.workspacePath === workspacePath,
            );
            if (sessionsInWorkspace.length === 0) {
              return;
            }

            const confirmed = window.confirm(
              `Delete folder group "${workspacePath}" and ${sessionsInWorkspace.length} thread(s)?`,
            );
            if (!confirmed) {
              return;
            }

            void (async () => {
              for (const session of sessionsInWorkspace) {
                await requestSessionDelete(session.id);
              }
            })();
          }}
          onDeleteSession={(sessionId) => {
            closeCompactNavigation();
            setPendingDeleteSessionId(sessionId);
          }}
          railFilterInputRef={railFilterInputRef}
          navigationRef={compactNavigationRef}
        />

        {compactNavigationOpen ? (
          <button
            type="button"
            className="compact-navigation-scrim"
            aria-label="Close navigation"
            tabIndex={-1}
            onClick={() => closeCompactNavigation(true)}
          ></button>
        ) : null}

        <div
          className="column-resize-handle dock-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize session column"
          onMouseDown={startLeftResize}
        ></div>

        <div
          className={`content-shell panel${focusView ? ' content-shell-focus' : ''}${
            utilityCollapsed ? ' content-shell-utility-collapsed' : ''
          }`}
          aria-hidden={compactNavigationOpen || undefined}
          {...(compactNavigationOpen ? ({ inert: '' } as Record<string, string>) : {})}
        >
          <main className="run-column panes-main">
            <ThreadTabs
              sessions={shellPanelsState.recentSessions}
              selectedSessionId={shellPanelsState.selectedSessionId}
              onSelectSession={(sessionId) => {
                void requestSessionSelection(sessionId);
              }}
            />
            <ConversationHeader
              workspaceLabel={conversationWorkspace}
              title={conversationTitle}
              hasActiveSession={hasActiveSession}
              runCount={runViewState.runs.length}
              runPhaseClassName={shellSummaryState.runStatusClassName
                .split(' ')
                .filter((token) => token.startsWith('status-'))
                .pop() ?? 'status-idle'}
              runStatusLabel={shellSummaryState.runStatusLabel}
              selectedSessionNote={shellSummaryState.selectedSessionNote}
              toolPlaneNote={shellSummaryState.toolPlaneNote}
              onOpenQuickOpen={() => {
                setQuickOpenVisible(true);
              }}
              utilityCollapsed={utilityCollapsed}
              utilityToggleRef={utilityToggleRef}
              onToggleUtility={() => {
                setUtilityCollapsed((current) => !current);
              }}
              onDeleteSession={
                hasActiveSession && shellPanelsState.selectedSessionId
                  ? () => {
                      setPendingDeleteSessionId(shellPanelsState.selectedSessionId!);
                    }
                  : undefined
              }
            />
            <RunToolbar
              runViewState={runViewState}
              shellControlsState={shellControlsState}
              shellPanelsState={shellPanelsState}
              showRunToolbar={showRunToolbar}
              onToggleShowRunToolbar={setShowRunToolbar}
              timelineExpandedAll={timelineExpandedAll}
              onToggleExpandAll={() => {
                setTimelineExpandedAll((current) => !current);
                setTimelineExpandSignal((signal) => signal + 1);
              }}
              runMenuOpen={runMenuOpen}
              onRunMenuOpenChange={setRunMenuOpen}
              onShowFiles={() => {
                setRunMenuOpen(false);
                setUtilityView('files');
                setUtilityCollapsed(false);
              }}
              onRequestUndo={setPendingUndoDetail}
            />
            <RunSurface
              runViewState={runViewState}
              shellControlsState={shellControlsState}
              shellPanelsState={shellPanelsState}
              runViewTab={runViewTab}
              onRunViewTabChange={setRunViewTab}
              showThinking={showThinking}
              onToggleThinking={() => {
                setShowThinking((current) => !current);
              }}
              timelineExpandSignal={timelineExpandSignal}
              inspectorTimeline={inspectorViews.timeline}
              hasActiveRun={hasActiveRun}
              hasPromptDraft={hasPromptDraft}
              onOpenFolder={handleAddFolderToRail}
            />
            <Composer
              shellControlsState={shellControlsState}
              shellPanelsState={shellPanelsState}
              shellSummaryState={shellSummaryState}
              hasActiveSession={hasActiveSession}
              hasActiveRun={hasActiveRun}
              runAcceptsSteering={runAcceptsSteering}
              conversationWorkspace={conversationWorkspace}
              activeProviderId={activeProviderId}
              activeApprovalPolicy={activeApprovalPolicy}
              composerPlaceholder={composerPlaceholder}
              composerHint={composerHint}
              sendHelperPrimary={sendHelperPrimary}
              sendHelperSecondary={sendHelperSecondary}
              contextUsagePercent={contextUsagePercent}
              hasPromptDraft={hasPromptDraft}
              textareaRef={textareaRef}
              autoResize={autoResize}
              onPolicyChange={(policy) => {
                handleComposerPolicyChange(policy);
              }}
              onCompareToggle={() => {
                setCompareVisible((current) => !current);
              }}
            />
            <HintBar workspacePath={shellControlsState.workspacePath} />
          </main>

          <div
            className={`column-resize-handle utility-resize-handle${
              utilityCollapsed ? ' is-hidden' : ''
            }`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize utility column"
            onMouseDown={startRightResize}
          ></div>

          <Inspector
            utilityCollapsed={utilityCollapsed}
            onToggleUtilityCollapsed={() => {
              setUtilityCollapsed((current) => !current);
            }}
            utilityView={utilityView}
            onUtilityViewChange={setUtilityView}
            utilityTabs={utilityTabs}
            activeProviderId={activeProviderId}
            activeApprovalPolicy={activeApprovalPolicy}
            activeSessionId={activeSessionId}
            hasActiveRun={hasActiveRun}
            contextUsagePercent={contextUsagePercent}
            shellPanelsState={shellPanelsState}
            shellControlsState={shellControlsState}
            onOpenWorkspace={handleOpenWorkspace}
          />
        </div>
      </section>
      <PromptModal
        isOpen={isFolderModalOpen}
        title="Open Folder Workspace"
        subtitle="Specify the local directory where CodeWave should run agent tasks."
        placeholder="e.g. C:\Users\User\archive\retired\codewave"
        defaultValue={shellControlsState.workspacePath}
        confirmLabel="Open Folder"
        onConfirm={handleFolderConfirm}
        onClose={() => setIsFolderModalOpen(false)}
      />
      <PromptModal
        isOpen={pendingDeleteSessionId !== null}
        mode="confirm"
        destructive
        title="Delete this thread?"
        subtitle="This permanently deletes the thread and its stored run history. This action cannot be undone."
        defaultValue={pendingDeleteSessionId ?? ''}
        confirmLabel="Delete thread"
        onConfirm={(sessionId) => {
          if (sessionId) void requestSessionDelete(sessionId);
        }}
        onClose={() => setPendingDeleteSessionId(null)}
      />
      <PromptModal
        isOpen={pendingUndoDetail !== null}
        mode="confirm"
        destructive
        title="Undo this run?"
        subtitle={`${pendingUndoDetail || 'Tracked workspace changes made during this run will be reverted.'} This action restores the tracked workspace state from before the run.`}
        defaultValue="undo"
        confirmLabel="Undo run"
        onConfirm={() => {
          void requestUndoRun();
        }}
        onClose={() => {
          setPendingUndoDetail(null);
          window.setTimeout(() => {
            document
              .querySelector<HTMLButtonElement>('.run-toolbar-v2-menu > button')
              ?.focus();
          }, 0);
        }}
      />
      <ProviderSettings
        open={providerSettingsOpen}
        registry={shellPanelsState.providerRegistry}
        health={shellPanelsState.providerHealth}
        onClose={closeProviderSettings}
      />
    </div>
  );
}
