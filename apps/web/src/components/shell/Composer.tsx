import { useMemo, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import type { ApprovalPolicy, ProviderId } from '@codewave/protocol';
import type { ShellControlsState } from '../../lib/shell-controls-state';
import type { ShellPanelsState } from '../../lib/shell-panels-state';
import type { ShellSummaryState } from '../../lib/shell-summary-state';
import {
  requestPromptDraftChange,
  requestStartRun,
} from '../../app-controller';
import { MentionPicker } from '../MentionPicker';
import { ComposerConfig } from './composer/ComposerConfig';
import { ComposerActions } from './composer/ComposerActions';

type ComposerProps = {
  shellControlsState: ShellControlsState;
  shellPanelsState: ShellPanelsState;
  shellSummaryState: ShellSummaryState;
  hasActiveSession: boolean;
  hasActiveRun: boolean;
  runAcceptsSteering: boolean;
  conversationWorkspace: string;
  activeProviderId: ProviderId;
  activeApprovalPolicy: ApprovalPolicy;
  composerPlaceholder: string;
  composerHint: string;
  sendHelperPrimary: string;
  sendHelperSecondary: string;
  contextUsagePercent: number;
  hasPromptDraft: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  autoResize: () => void;
  onPolicyChange: (policy: ApprovalPolicy) => void;
};

export function Composer({
  shellControlsState,
  shellPanelsState,
  shellSummaryState,
  hasActiveSession,
  hasActiveRun,
  runAcceptsSteering,
  conversationWorkspace,
  activeProviderId,
  activeApprovalPolicy,
  composerPlaceholder,
  composerHint,
  sendHelperPrimary,
  sendHelperSecondary,
  contextUsagePercent,
  hasPromptDraft,
  textareaRef,
  autoResize,
  onPolicyChange,
}: ComposerProps) {
  const mentionState = useMemo(() => {
    const prompt = shellControlsState.prompt;
    const match = /(^|\s)@([^\s@]*)$/.exec(prompt);
    if (!match) {
      return null;
    }
    return {
      query: match[2] ?? '',
      tokenStart: match.index + match[1].length,
      tokenEnd: prompt.length,
    };
  }, [shellControlsState.prompt]);

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape' && mentionState) {
      event.preventDefault();
      const nextPrompt = shellControlsState.prompt.replace(/@[^\s@]*$/, '');
      void requestPromptDraftChange(nextPrompt);
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const text = event.currentTarget.value.trim();
      if (!text) {
        return;
      }
      void (async () => {
        await requestPromptDraftChange(event.currentTarget.value);
        await requestStartRun();
      })();
      return;
    }
  }

  function handleMentionSelect(relativePath: string) {
    if (!mentionState) {
      return;
    }
    const prompt = shellControlsState.prompt;
    const nextPrompt =
      prompt.slice(0, mentionState.tokenStart) +
      `@${relativePath}` +
      prompt.slice(mentionState.tokenEnd);
    void requestPromptDraftChange(nextPrompt);
  }

  const modeLocked = hasActiveSession
    ? shellControlsState.selectedSessionApprovalPolicyDisabled
    : shellControlsState.sessionApprovalPolicyDisabled;
  const updateFeedback = hasActiveRun
    ? shellSummaryState.runUpdateFeedback
    : null;

  return (
    <form
      id="run-form"
      className="composer-shell panes-composer-shell"
      onSubmit={(event) => {
        event.preventDefault();
        void requestStartRun();
      }}
    >
      {mentionState ? (
        <MentionPicker
          workspacePath={shellControlsState.workspacePath}
          query={mentionState.query}
          onSelect={(relativePath) => {
            handleMentionSelect(relativePath);
            autoResize();
          }}
          onClose={() => {
            const nextPrompt = shellControlsState.prompt.replace(/@[^\s@]*$/, '');
            void requestPromptDraftChange(nextPrompt);
          }}
        />
      ) : null}

      <textarea
        id="prompt-input"
        name="prompt"
        rows={1}
        ref={textareaRef}
        placeholder={composerPlaceholder}
        required
        value={shellControlsState.prompt}
        disabled={shellControlsState.promptDisabled}
        onChange={(event) => {
          void requestPromptDraftChange(event.target.value);
          autoResize();
        }}
        onKeyDown={handleComposerKeyDown}
      ></textarea>

      {updateFeedback ? (
        <div
          className="composer-run-feedback"
          role="status"
          aria-live="polite"
          title={updateFeedback}
        >
          <span className="composer-run-feedback-dot" aria-hidden="true"></span>
          <span>{updateFeedback}</span>
        </div>
      ) : null}

      <div className="composer-footer">
        <div className="composer-footer-top">
          <div className="composer-footer-meta">
            <span className="composer-send-guidance">{composerHint}</span>
            <span className="composer-meta-divider" aria-hidden="true">·</span>
            <span>
              {hasActiveSession
                ? `Thread in ${conversationWorkspace}`
                : `New thread in ${conversationWorkspace}`}
            </span>
          </div>
        </div>

        <div className="composer-footer-bottom">
          <ComposerConfig
            shellControlsState={shellControlsState}
            shellPanelsState={shellPanelsState}
            shellSummaryState={shellSummaryState}
            hasActiveSession={hasActiveSession}
            conversationWorkspace={conversationWorkspace}
            activeProviderId={activeProviderId}
            activeApprovalPolicy={activeApprovalPolicy}
            modeLocked={modeLocked}
            onPolicyChange={onPolicyChange}
          />
          <ComposerActions
            contextUsagePercent={contextUsagePercent}
            hasActiveRun={hasActiveRun}
            runAcceptsSteering={runAcceptsSteering}
            hasPromptDraft={hasPromptDraft}
            sendHelperPrimary={sendHelperPrimary}
            sendHelperSecondary={sendHelperSecondary}
            startRunDisabled={shellControlsState.startRunDisabled}
            autoResize={autoResize}
          />
        </div>
      </div>
    </form>
  );
}
