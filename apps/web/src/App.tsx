import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type {
  ApprovalPolicy,
  ProviderId,
} from '@qwemini/protocol';
import {
  initializeShell,
  requestApprovalResolution,
  requestApplySelectedSessionPolicy,
  requestCancelSelectedRun,
  requestCreateSession,
  requestDelegatePrompt,
  requestFollowUpRun,
  requestHandoffPrompt,
  requestRecoverSelectedSession,
  requestRoutePrompt,
  requestRunSelection,
  requestSelectedSessionPolicyDraftChange,
  requestSessionDelete,
  requestSessionDraftChange,
  requestSessionSelection,
  requestStartRun,
  requestWorkspaceDraftCommit,
  subscribeShellControlsState,
  subscribeShellPanelsState,
  subscribeShellSummaryState,
  subscribeRunViewState,
} from './app-controller';
import { ComparePanel } from './components/ComparePanel';
import { PromptModal } from './components/PromptModal';
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
import { createDaemonApi } from './lib/daemon-api';
import {
  applyTheme,
  cycleTheme,
  readInitialTheme,
  type AppTheme,
} from './lib/theme';
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

const UTILITY_COLLAPSED_KEY = 'qwemini:utility-collapsed';

const RAIL_VIEW_ORDER: RailView[] = ['recent', 'history', 'archive', 'flows'];
const RUN_VIEW_ORDER: RunViewTab[] = ['chat', 'timeline'];
const UTILITY_VIEW_ORDER: UtilityView[] = [
  'approvals',
  'tools',
  'files',
  'artifacts',
  'checkpoints',
];

function cycleValue<T extends string>(
  values: readonly T[],
  current: T,
  direction: 1 | -1,
) {
  const currentIndex = values.indexOf(current);
  if (currentIndex === -1) {
    return values[0];
  }
  const nextIndex = (currentIndex + direction + values.length) % values.length;
  return values[nextIndex];
}

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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  );
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
  const [attentionBellOn, setAttentionBellOn] = useState(() =>
    attentionNotificationsEnabled(),
  );
  const [appTheme, setAppTheme] = useState<AppTheme>(() => readInitialTheme());
  const [railFilter, setRailFilter] = useState('');
  const { textareaRef, autoResize } = useAutoResizeTextarea();
  const compareApiRef = useRef(createDaemonApi());

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

  const {
    leftColumnWidth,
    rightColumnWidth,
    startLeftResize,
    startRightResize,
  } = useShellLayout();

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
    if (leaf.toLowerCase() === 'qwemini' && parent) {
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
  const composerPlaceholder = hasActiveSession
    ? 'Ask for follow-up changes'
    : 'Ask Qwemini to work on this workspace';
  const sendHelperPrimary = hasActiveSession
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
      />

      <section
        className={`workbench-shell panes-workbench${focusView ? ' workbench-shell-focus' : ''}`}
        style={shellStyle}
      >
        <Sidebar
          shellControlsState={shellControlsState}
          shellPanelsState={shellPanelsState}
          shellSummaryState={shellSummaryState}
          runViewState={runViewState}
          onAddFolder={handleAddFolderToRail}
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
            void requestSessionSelection(sessionId);
          }}
          onSelectRun={(runId) => {
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
            void requestSessionDelete(sessionId);
          }}
          railFilterInputRef={railFilterInputRef}
        />

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
              onToggleUtility={() => {
                setUtilityCollapsed((current) => !current);
              }}
              onDeleteSession={
                hasActiveSession && shellPanelsState.selectedSessionId
                  ? () => {
                      void requestSessionDelete(shellPanelsState.selectedSessionId!);
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
            />
            <RunSurface
              runViewState={runViewState}
              shellControlsState={shellControlsState}
              shellPanelsState={shellPanelsState}
              shellSummaryState={shellSummaryState}
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
            runViewState={runViewState}
          />
        </div>
      </section>
      <PromptModal
        isOpen={isFolderModalOpen}
        title="Open Folder Workspace"
        subtitle="Specify the local directory where Qwemini should run agent tasks."
        placeholder="e.g. C:\Users\User\archive\retired\qwemini"
        defaultValue={shellControlsState.workspacePath}
        confirmLabel="Open Folder"
        onConfirm={handleFolderConfirm}
        onClose={() => setIsFolderModalOpen(false)}
      />
    </div>
  );
}
