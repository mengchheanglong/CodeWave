import { ContextMeter } from '@qwemini/ui-kit';
import { requestPromptDraftChange } from '../../../app-controller';
import { ScaleIcon, SendIcon } from '../../icons';

type ComposerActionsProps = {
  contextUsagePercent: number;
  hasActiveRun: boolean;
  hasPromptDraft: boolean;
  sendHelperPrimary: string;
  sendHelperSecondary: string;
  startRunDisabled: boolean;
  autoResize: () => void;
  onCompareToggle: () => void;
};

export function ComposerActions({
  contextUsagePercent,
  hasActiveRun,
  hasPromptDraft,
  sendHelperPrimary,
  sendHelperSecondary,
  startRunDisabled,
  autoResize,
  onCompareToggle,
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
          type="button"
          className="composer-clear-button composer-compare-button"
          title="Compare this prompt across providers (Ctrl+Shift+C)"
          onClick={onCompareToggle}
        >
          <ScaleIcon size={13} /> Compare
        </button>
        <button
          id="start-run-button"
          className="composer-send-button"
          type="submit"
          aria-label="Send prompt"
          disabled={startRunDisabled}
        >
          <span className="composer-send-icon" aria-hidden="true">
            <SendIcon size={13} />
          </span>
          <span className="composer-send-label">Send</span>
        </button>
      </div>
    </>
  );
}
