import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptyShellControlsState } from '../../lib/shell-controls-state';
import { emptyShellPanelsState } from '../../lib/shell-panels-state';
import { emptyShellSummaryState } from '../../lib/shell-summary-state';
import { Composer } from './Composer';

function renderComposer(hasActiveRun: boolean) {
  return render(
    <Composer
      shellControlsState={{
        ...emptyShellControlsState,
        workspacePath: 'C:\\workspace',
        promptDisabled: false,
      }}
      shellPanelsState={emptyShellPanelsState}
      shellSummaryState={{
        ...emptyShellSummaryState,
        runUpdateFeedback: 'Update delivered to the active run.',
      }}
      hasActiveSession
      hasActiveRun={hasActiveRun}
      runAcceptsSteering
      conversationWorkspace="C:\\workspace"
      activeProviderId="freebuff"
      activeApprovalPolicy="manual"
      composerPlaceholder="Ask CodeWave"
      composerHint="Enter to send"
      sendHelperPrimary="Queue update"
      sendHelperSecondary="Shift+Enter for newline"
      contextUsagePercent={0}
      hasPromptDraft={false}
      textareaRef={createRef<HTMLTextAreaElement>()}
      autoResize={vi.fn()}
      onPolicyChange={vi.fn()}
      onCompareToggle={vi.fn()}
    />,
  );
}

describe('Composer run feedback', () => {
  it('keeps native steering delivery visible while the run remains active', () => {
    renderComposer(true);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Update delivered to the active run.',
    );
  });

  it('clears stale steering feedback after the run becomes terminal', () => {
    renderComposer(false);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
