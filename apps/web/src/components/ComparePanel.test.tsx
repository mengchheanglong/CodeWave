import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DaemonApi } from '../lib/daemon-api';
import { ComparePanel } from './ComparePanel';

function renderCompare(onClose = vi.fn()) {
  const trigger = document.createElement('button');
  trigger.textContent = 'Compare';
  document.body.appendChild(trigger);
  trigger.focus();

  const result = render(
    <ComparePanel
      open
      prompt="Review the workspace"
      workspacePath="C:\\workspace"
      providerRevision="revision-1"
      api={{} as DaemonApi}
      onClose={onClose}
      formatTimestamp={(timestamp) => timestamp}
    />,
  );

  return { ...result, onClose, trigger };
}

describe('ComparePanel modal keyboard lifecycle', () => {
  it('moves focus into the dialog and closes on Escape', () => {
    const { onClose } = renderCompare();

    expect(screen.getByRole('button', { name: 'Close compare' })).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the invoking control when the dialog closes', () => {
    const { rerender, trigger } = renderCompare();

    rerender(
      <ComparePanel
        open={false}
        prompt="Review the workspace"
        workspacePath="C:\\workspace"
        providerRevision="revision-1"
        api={{} as DaemonApi}
        onClose={vi.fn()}
        formatTimestamp={(timestamp) => timestamp}
      />,
    );

    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
