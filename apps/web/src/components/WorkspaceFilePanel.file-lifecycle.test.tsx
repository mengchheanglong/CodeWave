import '@testing-library/jest-dom';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceFilePanel } from './WorkspaceFilePanel';

const workspacePath = 'C:\\workspace';
const fileEntry = { name: 'README.md', relativePath: 'README.md', kind: 'file' };

function response(body: object, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? 'Request failed' : 'OK',
    json: async () => body,
  } as Response;
}

function entries(items = [fileEntry]) {
  return response({ workspacePath, relativePath: '', entries: items });
}

function preview(overrides: Record<string, unknown> = {}) {
  return response({
    workspacePath,
    relativePath: 'README.md',
    name: 'README.md',
    content: 'hello',
    encoding: 'utf-8',
    byteLength: 5,
    contentByteLength: 5,
    truncated: false,
    maxPreviewBytes: 262_144,
    version: 'sha256:old',
    ...overrides,
  });
}

describe('WorkspaceFilePanel file lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('previews a file, tracks dirty content, cancels, and restores edit focus', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(entries()).mockResolvedValueOnce(preview());
    render(<WorkspaceFilePanel workspacePath={workspacePath} />);

    await user.click(await screen.findByRole('button', { name: 'README.md' }));
    expect(await screen.findByText('hello')).toBeInTheDocument();
    const edit = screen.getByRole('button', { name: 'Edit file' });
    await user.click(edit);
    const editor = screen.getByRole('textbox', { name: 'File contents' });
    await user.type(editor, ' world');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel editing' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit file' })).toHaveFocus());
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('creates an empty file without overwriting and opens its real preview', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(entries([]))
      .mockResolvedValueOnce(
        response({
          workspacePath,
          relativePath: 'notes.md',
          name: 'notes.md',
          byteLength: 0,
          version: 'sha256:empty',
          created: true,
        }, 201),
      )
      .mockResolvedValueOnce(entries([{ name: 'notes.md', relativePath: 'notes.md', kind: 'file' }]))
      .mockResolvedValueOnce(
        preview({
          relativePath: 'notes.md',
          name: 'notes.md',
          content: '',
          byteLength: 0,
          contentByteLength: 0,
          version: 'sha256:empty',
        }),
      );
    render(<WorkspaceFilePanel workspacePath={workspacePath} />);

    await user.click(await screen.findByRole('button', { name: 'New file' }));
    await user.type(screen.getByPlaceholderText('e.g. notes.md'), 'notes.md');
    await user.click(screen.getByRole('button', { name: 'Create File' }));

    expect(await screen.findByRole('heading', { name: 'notes.md' })).toBeInTheDocument();
    expect(screen.getByText('This file is empty.')).toBeInTheDocument();
    const createRequest = vi.mocked(fetch).mock.calls[1];
    expect(createRequest[0]).toBe('/api/workspace/files');
    expect(createRequest[1]).toMatchObject({ method: 'POST' });
    expect(new Headers(createRequest[1]?.headers).get('Idempotency-Key')).toMatch(
      /^[A-Za-z0-9._:-]{8,128}$/,
    );
    expect(JSON.parse(String(createRequest[1]?.body))).toMatchObject({ name: 'notes.md', content: '' });
  });

  it('saves through compare-and-set and adopts the returned version', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(entries())
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(
        response({
          workspacePath,
          relativePath: 'README.md',
          name: 'README.md',
          byteLength: 6,
          version: 'sha256:new',
          updated: true,
        }),
      );
    render(<WorkspaceFilePanel workspacePath={workspacePath} />);

    await user.click(await screen.findByRole('button', { name: 'README.md' }));
    await screen.findByText('hello');
    await user.click(screen.getByRole('button', { name: 'Edit file' }));
    const editor = screen.getByRole('textbox', { name: 'File contents' });
    await user.clear(editor);
    await user.type(editor, 'edited');
    await user.click(screen.getByRole('button', { name: 'Save file' }));

    await waitFor(() => expect(screen.getByText('edited')).toBeInTheDocument());
    const saveRequest = vi.mocked(fetch).mock.calls[2];
    expect(saveRequest[1]).toMatchObject({ method: 'PUT' });
    expect(new Headers(saveRequest[1]?.headers).get('Idempotency-Key')).toMatch(
      /^[A-Za-z0-9._:-]{8,128}$/,
    );
    expect(JSON.parse(String(saveRequest[1]?.body))).toMatchObject({
      targetPath: 'README.md',
      content: 'edited',
      expectedVersion: 'sha256:old',
    });
  });

  it('refuses binary previews with an actionable, focused error', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(entries())
      .mockResolvedValueOnce(
        response({ error: 'Binary file', code: 'workspace_file_binary' }, 415),
      );
    render(<WorkspaceFilePanel workspacePath={workspacePath} />);

    await user.click(await screen.findByRole('button', { name: 'README.md' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Binary file preview is unavailable');
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('labels truncated previews and disables partial editing', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(entries())
      .mockResolvedValueOnce(
        preview({ byteLength: 500_000, contentByteLength: 262_144, truncated: true }),
      );
    render(<WorkspaceFilePanel workspacePath={workspacePath} />);

    await user.click(await screen.findByRole('button', { name: 'README.md' }));
    expect(await screen.findByText('Preview truncated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit file' })).toBeDisabled();
    expect(screen.getByText(/partial content cannot overwrite/i)).toBeInTheDocument();
  });

  it('keeps dirty content on a version conflict and offers an explicit reload', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(entries())
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(
        response(
          {
            error: 'Version conflict',
            code: 'workspace_file_version_conflict',
            currentVersion: 'sha256:external',
          },
          409,
        ),
      );
    render(<WorkspaceFilePanel workspacePath={workspacePath} />);

    await user.click(await screen.findByRole('button', { name: 'README.md' }));
    await screen.findByText('hello');
    await user.click(screen.getByRole('button', { name: 'Edit file' }));
    const editor = screen.getByRole('textbox', { name: 'File contents' });
    await user.type(editor, '!');
    await user.click(screen.getByRole('button', { name: 'Save file' }));

    expect(await screen.findByText(/Save conflict:/)).toBeInTheDocument();
    expect(editor).toHaveValue('hello!');
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument();
  });

  it('cancels, escapes, and confirms delete in a product-owned dialog with focus restoration', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(entries())
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(entries([]));
    render(<WorkspaceFilePanel workspacePath={workspacePath} />);

    const deleteButton = (await screen.findAllByRole('button', { name: 'Delete' }))[0];
    await user.click(deleteButton);
    expect(screen.getByRole('dialog', { name: /Delete file “README.md”/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(deleteButton).toHaveFocus());
    expect(fetch).toHaveBeenCalledTimes(1);

    await user.click(deleteButton);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(deleteButton).toHaveFocus());
    expect(fetch).toHaveBeenCalledTimes(1);

    await user.click(deleteButton);
    await user.click(screen.getByRole('button', { name: 'Delete file' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'README.md' })).not.toBeInTheDocument());
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('protects dirty preview exit with cancel/confirm and restores trigger focus', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(entries()).mockResolvedValueOnce(preview());
    render(<WorkspaceFilePanel workspacePath={workspacePath} />);

    await user.click(await screen.findByRole('button', { name: 'README.md' }));
    await screen.findByText('hello');
    await user.click(screen.getByRole('button', { name: 'Edit file' }));
    await user.type(screen.getByRole('textbox', { name: 'File contents' }), '!');
    const back = screen.getByRole('button', { name: 'Back to files' });
    await user.click(back);
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(back).toHaveFocus());
    expect(screen.getByRole('textbox', { name: 'File contents' })).toHaveValue('hello!');

    await user.click(back);
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'README.md' })).toBeInTheDocument());
  });

  it('preserves and clearly restores an unsaved draft across workspace switches', async () => {
    const user = userEvent.setup();
    const otherWorkspace = 'C:\\other-workspace';
    vi.mocked(fetch)
      .mockResolvedValueOnce(entries())
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(
        response({ workspacePath: otherWorkspace, relativePath: '', entries: [] }),
      )
      .mockResolvedValueOnce(entries());
    const { rerender } = render(<WorkspaceFilePanel workspacePath={workspacePath} />);

    await user.click(await screen.findByRole('button', { name: 'README.md' }));
    await screen.findByText('hello');
    await user.click(screen.getByRole('button', { name: 'Edit file' }));
    await user.type(screen.getByRole('textbox', { name: 'File contents' }), ' retained');
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeInTheDocument());

    rerender(<WorkspaceFilePanel workspacePath={otherWorkspace} />);
    await screen.findByText('No files in this folder');
    rerender(<WorkspaceFilePanel workspacePath={workspacePath} />);

    const restoredEditor = await screen.findByRole('textbox', { name: 'File contents' });
    expect(restoredEditor).toHaveValue('hello retained');
    expect(screen.getByText('Restored unsaved draft')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('preserves a switched draft when session storage rejects writes', async () => {
    const user = userEvent.setup();
    const otherWorkspace = 'C:\\storage-blocked-workspace';
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new DOMException('Storage blocked', 'QuotaExceededError'); });
    vi.mocked(fetch)
      .mockResolvedValueOnce(entries())
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(
        response({ workspacePath: otherWorkspace, relativePath: '', entries: [] }),
      )
      .mockResolvedValueOnce(entries());
    const { rerender } = render(<WorkspaceFilePanel workspacePath={workspacePath} />);

    await user.click(await screen.findByRole('button', { name: 'README.md' }));
    await screen.findByText('hello');
    await user.click(screen.getByRole('button', { name: 'Edit file' }));
    await user.type(screen.getByRole('textbox', { name: 'File contents' }), ' fallback');
    rerender(<WorkspaceFilePanel workspacePath={otherWorkspace} />);
    await screen.findByText('No files in this folder');
    rerender(<WorkspaceFilePanel workspacePath={workspacePath} />);

    expect(await screen.findByRole('textbox', { name: 'File contents' })).toHaveValue(
      'hello fallback',
    );
    expect(screen.getByText('Restored unsaved draft')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }));
    setItem.mockRestore();
  });
});
