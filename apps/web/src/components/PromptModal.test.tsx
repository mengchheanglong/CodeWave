import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PromptModal } from './PromptModal';

function PromptHarness({ onConfirm = vi.fn() }: { onConfirm?: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add folder
      </button>
      <PromptModal
        isOpen={open}
        title="Open Folder Workspace"
        defaultValue="C:\\workspace"
        onConfirm={onConfirm}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function ConfirmHarness({ onConfirm }: { onConfirm: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Delete selected thread
      </button>
      <PromptModal
        isOpen={open}
        mode="confirm"
        destructive
        title="Delete this thread?"
        subtitle="This action cannot be undone."
        defaultValue="session-1"
        confirmLabel="Delete thread"
        onConfirm={onConfirm}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

describe('PromptModal focus and confirmation behavior', () => {
  it('traps Tab focus, closes with Escape from anywhere, and restores its trigger', async () => {
    const user = userEvent.setup();
    render(<PromptHarness />);
    const trigger = screen.getByRole('button', { name: 'Add folder' });

    await user.click(trigger);
    const input = screen.getByRole('textbox');
    await waitFor(() => expect(input).toHaveFocus());

    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Open Folder' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();

    document.body.focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('starts destructive confirmation on Cancel and does not act when dismissed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Delete selected thread' }));
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    await user.click(cancel);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete selected thread' })).toHaveFocus();
  });

  it('passes the confirmed session id only after explicit destructive confirmation', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Delete selected thread' }));
    await user.click(screen.getByRole('button', { name: 'Delete thread' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('session-1');
  });
});
