import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MentionPicker } from './MentionPicker';

function workspaceResponse(relativePath: string, entries: unknown[]) {
  return {
    ok: true,
    json: async () => ({
      workspacePath: 'C:\\workspace',
      relativePath,
      entries,
    }),
  };
}

describe('MentionPicker workspace discovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finds files nested below the workspace root', async () => {
    const onSelect = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(workspaceResponse('', [
        { name: 'src', relativePath: 'src', kind: 'folder' },
        { name: 'README.md', relativePath: 'README.md', kind: 'file' },
      ]))
      .mockResolvedValueOnce(workspaceResponse('src', [
        { name: 'utils', relativePath: 'src/utils', kind: 'folder' },
      ]))
      .mockResolvedValueOnce(workspaceResponse('src/utils', [
        { name: 'ocean.ts', relativePath: 'src/utils/ocean.ts', kind: 'file' },
      ]));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MentionPicker
        workspacePath="C:\\workspace"
        query="ocean"
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByRole('option', { name: /ocean\.ts/i })).toBeInTheDocument();
    expect(screen.getByText('src/utils/ocean.ts')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('relativePath=src%2Futils');

    fireEvent.click(screen.getByRole('option', { name: /ocean\.ts/i }));
    expect(onSelect).toHaveBeenCalledWith('src/utils/ocean.ts');
    expect(screen.queryByRole('listbox', { name: 'Mention a file' })).not.toBeInTheDocument();
  });

  it('reports a root listing failure without retrying indefinitely', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MentionPicker
        workspacePath="C:\\workspace"
        query=""
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Listing failed (403).')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reopens for a later mention after selection and token completion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(workspaceResponse('', [
      { name: 'README.md', relativePath: 'README.md', kind: 'file' },
    ]));
    vi.stubGlobal('fetch', fetchMock);

    function ComposerMentionHarness() {
      const [prompt, setPrompt] = useState('@read');
      const match = /(^|\s)@([^\s@]*)$/.exec(prompt);

      return (
        <>
          {match ? (
            <MentionPicker
              workspacePath="C:\\workspace"
              query={match[2] ?? ''}
              onSelect={(relativePath) => setPrompt(`@${relativePath}`)}
              onClose={() => setPrompt('')}
            />
          ) : null}
          <textarea
            aria-label="Composer"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </>
      );
    }

    render(<ComposerMentionHarness />);
    fireEvent.click(await screen.findByRole('option', { name: /README\.md/i }));
    expect(screen.queryByRole('listbox', { name: 'Mention a file' })).not.toBeInTheDocument();

    const composer = screen.getByRole('textbox', { name: 'Composer' });
    fireEvent.change(composer, { target: { value: '@README.md ' } });
    fireEvent.change(composer, { target: { value: '@README.md @read' } });

    expect(await screen.findByRole('option', { name: /README\.md/i })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
