import { fireEvent, screen, within } from '@testing-library/react';

export async function submitWorkspacePrompt(value: string): Promise<void> {
  const dialog = await screen.findByRole('dialog');
  const input = within(dialog).getByRole('textbox');
  fireEvent.change(input, { target: { value } });
  const submit = within(dialog).getByRole('button', {
    name: /Create Folder|Rename/i,
  });
  if (value.trim()) fireEvent.click(submit);
}
