import { ContextMeter } from '@codewave/ui-kit';
import { requestPromptDraftChange } from '../../../app-controller';
import { SendIcon } from '../../icons';

type ComposerActionsProps = {
  contextUsagePercent: number;
  hasActiveRun: boolean;
  runAcceptsSteering: boolean;
  hasPromptDraft: boolean;
  sendHelperPrimary: string;
  sendHelperSecondary: string;
  startRunDisabled: boolean;
  autoResize: () => void;
};

export function ComposerActions({
  contextUsagePercent,
  hasActiveRun,
  runAcceptsSteering,
  hasPromptDraft,
  sendHelperPrimary,
  sendHelperSecondary,
  startRunDisabled,
  autoResize,
}: ComposerActionsProps) {
  return (
    <>
      <div
        className="composer-context-meter"
        id="composer-context-meter"
        title="Approximate context used by the selected run"
      >
        <ContextMeter
          percent={contextUsagePercent}
          label={hasActiveRun ? `ctx ${contextUsagePercent}%` : 'ctx —'}
        />
      </div>
      <div className="composer-primary-actions">
        <div className="composer-send-shortcut" aria-hidden="true">
          <span>{sendHelperPrimary}</span>
          <span>{sendHelperSecondary}</span>
        </div>
        {hasPromptDraft ? (
          <button
            type="button"
            className="composer-clear-button"
            onClick={() => {
              void requestPromptDraftChange('');
              autoResize();
            }}
          >
            Clear
          </button>
        ) : null}
        <button
          id="start-run-button"
          className="composer-send-button"
          type="submit"
          aria-label={runAcceptsSteering ? 'Queue update' : 'Send prompt'}
          disabled={startRunDisabled}
        >
          <span className="composer-send-icon" aria-hidden="true">
            <SendIcon size={13} />
          </span>
          <span className="composer-send-label">
            {runAcceptsSteering ? 'Queue' : 'Send'}
          </span>
        </button>
      </div>
    </>
  );
}
