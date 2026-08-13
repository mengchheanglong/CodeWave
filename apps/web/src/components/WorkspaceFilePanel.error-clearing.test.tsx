import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { submitWorkspacePrompt } from '../test/workspace-prompt';
import { WorkspaceFilePanel } from './WorkspaceFilePanel';

/**
 * Tests for Task 4.2: Implement error clearing on success
 * 
 * Verifies that setError(null) is called before each operation attempt
 * and that successful operations clear previous error messages.
 * 
 * **Validates: Requirements 9.4**
 */

describe('WorkspaceFilePanel - Error Clearing on Success', () => {
  const mockWorkspacePath = '/test/workspace';
  
  beforeEach(() => {
    // Mock window.prompt and window.confirm
    vi.stubGlobal('prompt', vi.fn());
    vi.stubGlobal('confirm', vi.fn());
    
    // Mock fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should clear error when createFolder succeeds after previous error', async () => {
    const user = userEvent.setup();
    
    // Mock initial load - success
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspacePath: mockWorkspacePath,
        relativePath: '',
        entries: []
      })
    });

    render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
    
    await waitFor(() => {
      expect(screen.queryByText(/Loading entries/i)).not.toBeInTheDocument();
    });

    // First operation: createFolder fails
    vi.mocked(window.prompt).mockReturnValueOnce('test-folder');
    (global.fetch as any).mockRejectedValueOnce(new Error('Folder already exists: test-folder'));

    const newFolderButton = screen.getByRole('button', { name: /New folder/i });
    await user.click(newFolderButton);
    await submitWorkspacePrompt('test-folder');

    // Verify error is displayed
    await waitFor(() => {
      expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    });

    // Second operation: createFolder succeeds
    vi.mocked(window.prompt).mockReturnValueOnce('new-folder');
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [{ name: 'new-folder', relativePath: 'new-folder', kind: 'folder' }]
        })
      });

    await user.click(newFolderButton);
    await submitWorkspacePrompt('new-folder');

    // Verify error is cleared
    await waitFor(() => {
      expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument();
    });
  });

  it('should clear error when renameEntry succeeds after previous error', async () => {
    const user = userEvent.setup();
    
    // Mock initial load with one entry
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspacePath: mockWorkspacePath,
        relativePath: '',
        entries: [
          { name: 'test.ts', relativePath: 'test.ts', kind: 'file' }
        ]
      })
    });

    render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
    
    await waitFor(() => {
      expect(screen.getByText('test.ts')).toBeInTheDocument();
    });

    // First operation: rename fails
    vi.mocked(window.prompt).mockReturnValueOnce('invalid/name');
    (global.fetch as any).mockRejectedValueOnce(new Error('Invalid file name: contains invalid characters'));

    const renameButton = screen.getAllByRole('button', { name: /Rename/i })[0];
    await user.click(renameButton);
    await submitWorkspacePrompt('invalid/name');

    // Verify error is displayed
    await waitFor(() => {
      expect(screen.getByText(/Invalid file name/i)).toBeInTheDocument();
    });

    // Second operation: rename succeeds
    vi.mocked(window.prompt).mockReturnValueOnce('renamed');
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'renamed.ts', relativePath: 'renamed.ts', kind: 'file' }
          ]
        })
      });

    await user.click(renameButton);
    await submitWorkspacePrompt('renamed');

    // Verify error is cleared
    await waitFor(() => {
      expect(screen.queryByText(/Invalid file name/i)).not.toBeInTheDocument();
    });
  });

  it('should clear error when deleteEntry succeeds after previous error', async () => {
    const user = userEvent.setup();
    
    // Mock initial load with one entry
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspacePath: mockWorkspacePath,
        relativePath: '',
        entries: [
          { name: 'test.ts', relativePath: 'test.ts', kind: 'file' }
        ]
      })
    });

    render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
    
    await waitFor(() => {
      expect(screen.getByText('test.ts')).toBeInTheDocument();
    });

    // First operation: delete fails
    vi.mocked(window.confirm).mockReturnValueOnce(true);
    (global.fetch as any).mockRejectedValueOnce(new Error('Permission denied'));

    const deleteButton = screen.getAllByRole('button', { name: /Delete/i })[0];
    await user.click(deleteButton);

    // Verify error is displayed
    await waitFor(() => {
      expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
    });

    // Second operation: delete succeeds
    vi.mocked(window.confirm).mockReturnValueOnce(true);
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: []
        })
      });

    await user.click(deleteButton);

    // Verify error is cleared
    await waitFor(() => {
      expect(screen.queryByText(/Permission denied/i)).not.toBeInTheDocument();
    });
  });

  it('should clear error when refresh succeeds after previous error', async () => {
    const user = userEvent.setup();
    
    // Mock initial load - fails
    (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

    render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
    
    // Verify error is displayed
    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });

    // Click refresh - succeeds
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspacePath: mockWorkspacePath,
        relativePath: '',
        entries: []
      })
    });

    const refreshButton = screen.getByRole('button', { name: /Refresh/i });
    await user.click(refreshButton);

    // Verify error is cleared
    await waitFor(() => {
      expect(screen.queryByText(/Network error/i)).not.toBeInTheDocument();
    });
  });

  it('should clear error when navigating to parent succeeds after previous error', async () => {
    const user = userEvent.setup();
    
    // Mock initial load in subfolder
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspacePath: mockWorkspacePath,
        relativePath: 'subfolder',
        entries: []
      })
    });

    render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
    
    await waitFor(() => {
      expect(screen.getByText('/subfolder')).toBeInTheDocument();
    });

    // Create folder fails
    vi.mocked(window.prompt).mockReturnValueOnce('test');
    (global.fetch as any).mockRejectedValueOnce(new Error('Permission denied'));

    const newFolderButton = screen.getByRole('button', { name: /New folder/i });
    await user.click(newFolderButton);
    await submitWorkspacePrompt('test');

    // Verify error is displayed
    await waitFor(() => {
      expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
    });

    // Navigate up - succeeds
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspacePath: mockWorkspacePath,
        relativePath: '',
        entries: []
      })
    });

    const upButton = screen.getByRole('button', { name: /Up/i });
    await user.click(upButton);

    // Verify error is cleared
    await waitFor(() => {
      expect(screen.queryByText(/Permission denied/i)).not.toBeInTheDocument();
    });
  });

  it('should clear error when navigating into folder succeeds after previous error', async () => {
    const user = userEvent.setup();
    
    // Mock initial load with folder
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspacePath: mockWorkspacePath,
        relativePath: '',
        entries: [
          { name: 'subfolder', relativePath: 'subfolder', kind: 'folder' }
        ]
      })
    });

    render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
    
    await waitFor(() => {
      expect(screen.getByText('subfolder')).toBeInTheDocument();
    });

    // Create folder fails
    vi.mocked(window.prompt).mockReturnValueOnce('test');
    (global.fetch as any).mockRejectedValueOnce(new Error('Invalid folder name'));

    const newFolderButton = screen.getByRole('button', { name: /New folder/i });
    await user.click(newFolderButton);
    await submitWorkspacePrompt('test');

    // Verify error is displayed
    await waitFor(() => {
      expect(screen.getByText(/Invalid folder name/i)).toBeInTheDocument();
    });

    // Navigate into folder - succeeds
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        workspacePath: mockWorkspacePath,
        relativePath: 'subfolder',
        entries: []
      })
    });

    const folderButton = screen.getByRole('button', { name: /subfolder/i });
    await user.click(folderButton);

    // Verify error is cleared
    await waitFor(() => {
      expect(screen.queryByText(/Invalid folder name/i)).not.toBeInTheDocument();
    });
  });
});
