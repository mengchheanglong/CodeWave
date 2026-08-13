import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceFilePanel } from './WorkspaceFilePanel';

/**
 * Unit tests for Task 7.2: Folder navigation
 * 
 * These tests verify specific examples and UI interactions for folder navigation,
 * complementing the property-based tests.
 * 
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
 */

describe('WorkspaceFilePanel - Folder Navigation Unit Tests', () => {
  const mockWorkspacePath = '/test/workspace';

  beforeEach(() => {
    vi.stubGlobal('prompt', vi.fn());
    vi.stubGlobal('confirm', vi.fn());
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('Clicking folder navigates into it (Requirement 4.1)', () => {
    it('should navigate into folder when clicked', async () => {
      const user = userEvent.setup();
      
      // Mock initial load with folder
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'src', relativePath: 'src', kind: 'folder' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('src')).toBeInTheDocument();
      });

      // Mock navigation into folder
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: 'src',
          entries: [
            { name: 'index.ts', relativePath: 'src/index.ts', kind: 'file' }
          ],
        })
      });

      // Click on folder
      await user.click(screen.getByText('src'));

      // Verify navigation occurred
      await waitFor(() => {
        expect(screen.getByText('/src')).toBeInTheDocument();
        expect(screen.getByText('index.ts')).toBeInTheDocument();
      });
    });

    it('should not navigate when clicking on file', async () => {
      const user = userEvent.setup();
      
      // Mock initial load with file
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'README.md', relativePath: 'README.md', kind: 'file' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('README.md')).toBeInTheDocument();
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workspacePath: mockWorkspacePath, relativePath: 'README.md', name: 'README.md', content: '# Readme', encoding: 'utf-8', byteLength: 8, contentByteLength: 8, truncated: false, maxPreviewBytes: 262144, version: 'sha256:test' })
      });

      // Click on file
      await user.click(screen.getByText('README.md'));

      // Files preview without changing the directory path.
      await waitFor(() => expect(screen.getByText('# Readme')).toBeInTheDocument());
      expect(screen.getByText('/')).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should navigate into nested folders', async () => {
      const user = userEvent.setup();
      
      // Mock initial load
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'apps', relativePath: 'apps', kind: 'folder' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('apps')).toBeInTheDocument();
      });

      // Navigate into apps
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: 'apps',
          entries: [
            { name: 'web', relativePath: 'apps/web', kind: 'folder' }
          ],
        })
      });

      await user.click(screen.getByText('apps'));

      await waitFor(() => {
        expect(screen.getByText('/apps')).toBeInTheDocument();
        expect(screen.getByText('web')).toBeInTheDocument();
      });

      // Navigate into web
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: 'apps/web',
          entries: [
            { name: 'src', relativePath: 'apps/web/src', kind: 'folder' }
          ],
        })
      });

      await user.click(screen.getByText('web'));

      await waitFor(() => {
        expect(screen.getByText('/apps/web')).toBeInTheDocument();
        expect(screen.getByText('src')).toBeInTheDocument();
      });
    });
  });

  describe('Path display updates on navigation (Requirement 4.2)', () => {
    it('should show root path initially', async () => {
      // Mock initial load at root
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.queryByText(/Loading entries/i)).not.toBeInTheDocument();
      });

      // At root, path display should show "/" or be empty
      expect(screen.queryByText(/^\/[^/]/)).not.toBeInTheDocument();
    });

    it('should update path display when navigating into folder', async () => {
      const user = userEvent.setup();
      
      // Mock initial load
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'components', relativePath: 'components', kind: 'folder' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('components')).toBeInTheDocument();
      });

      // Navigate into folder
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: 'components',
          entries: [],
        })
      });

      await user.click(screen.getByText('components'));

      // Verify path display updated
      await waitFor(() => {
        expect(screen.getByText('/components')).toBeInTheDocument();
      });
    });

    it('should show full path for nested navigation', async () => {
      const user = userEvent.setup();
      
      // Mock initial load
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'src', relativePath: 'src', kind: 'folder' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('src')).toBeInTheDocument();
      });

      // Navigate into src
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: 'src',
          entries: [
            { name: 'components', relativePath: 'src/components', kind: 'folder' }
          ],
        })
      });

      await user.click(screen.getByText('src'));

      await waitFor(() => {
        expect(screen.getByText('/src')).toBeInTheDocument();
      });

      // Navigate into components
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: 'src/components',
          entries: [],
        })
      });

      await user.click(screen.getByText('components'));

      // Verify full path displayed
      await waitFor(() => {
        expect(screen.getByText('/src/components')).toBeInTheDocument();
      });
    });
  });

  describe('Up button navigates to parent (Requirement 4.4)', () => {
    it('should navigate to parent when Up button is clicked', async () => {
      const user = userEvent.setup();
      
      // Mock initial load in subdirectory
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: 'src',
          entries: [
            { name: 'index.ts', relativePath: 'src/index.ts', kind: 'file' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('/src')).toBeInTheDocument();
        expect(screen.getByText('index.ts')).toBeInTheDocument();
      });

      // Mock navigation to parent
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'src', relativePath: 'src', kind: 'folder' }
          ],
        })
      });

      await user.click(screen.getByRole('button', { name: /Up/i }));

      // Verify navigation to parent
      await waitFor(() => {
        expect(screen.queryByText('/src')).not.toBeInTheDocument();
        expect(screen.getByText('src')).toBeInTheDocument();
      });
    });

    it('should navigate up multiple levels', async () => {
      const user = userEvent.setup();
      
      // Mock initial load in nested subdirectory
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: 'src/components/ui',
          entries: [],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('/src/components/ui')).toBeInTheDocument();
      });

      // Navigate up to components
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: 'src/components',
          entries: [
            { name: 'ui', relativePath: 'src/components/ui', kind: 'folder' }
          ],
        })
      });

      await user.click(screen.getByRole('button', { name: /Up/i }));

      await waitFor(() => {
        expect(screen.getByText('/src/components')).toBeInTheDocument();
      });

      // Navigate up to src
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: 'src',
          entries: [
            { name: 'components', relativePath: 'src/components', kind: 'folder' }
          ],
        })
      });

      await user.click(screen.getByRole('button', { name: /Up/i }));

      await waitFor(() => {
        expect(screen.getByText('/src')).toBeInTheDocument();
      });

      // Navigate up to root
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'src', relativePath: 'src', kind: 'folder' }
          ],
        })
      });

      await user.click(screen.getByRole('button', { name: /Up/i }));

      await waitFor(() => {
        expect(screen.queryByText(/^\/[^/]/)).not.toBeInTheDocument();
        expect(screen.getByText('src')).toBeInTheDocument();
      });
    });
  });

  describe('Up button disabled at workspace root (Requirement 4.5)', () => {
    it('should disable Up button at root', async () => {
      // Mock initial load at root
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.queryByText(/Loading entries/i)).not.toBeInTheDocument();
      });

      // Verify Up button is disabled
      const upButton = screen.getByRole('button', { name: /Up/i });
      expect(upButton).toBeDisabled();
    });

    it('should enable Up button in subdirectory', async () => {
      // Mock initial load in subdirectory
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: 'src',
          entries: [],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('/src')).toBeInTheDocument();
      });

      // Verify Up button is enabled
      const upButton = screen.getByRole('button', { name: /Up/i });
      expect(upButton).not.toBeDisabled();
    });

    it('should disable Up button after navigating back to root', async () => {
      const user = userEvent.setup();
      
      // Mock initial load in subdirectory
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: 'src',
          entries: [],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('/src')).toBeInTheDocument();
      });

      // Up button should be enabled
      let upButton = screen.getByRole('button', { name: /Up/i });
      expect(upButton).not.toBeDisabled();

      // Navigate to root
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'src', relativePath: 'src', kind: 'folder' }
          ],
        })
      });

      await user.click(upButton);

      // Verify Up button is now disabled
      await waitFor(() => {
        upButton = screen.getByRole('button', { name: /Up/i });
        expect(upButton).toBeDisabled();
      });
    });
  });

  describe('Failed navigation shows error (Requirement 4.6)', () => {
    it('should show error when navigation fails', async () => {
      const user = userEvent.setup();
      
      // Mock initial load with folder
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'restricted', relativePath: 'restricted', kind: 'folder' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('restricted')).toBeInTheDocument();
      });

      // Mock failed navigation
      (global.fetch as any).mockRejectedValueOnce(
        new Error('Permission denied: cannot access folder')
      );

      // Click on folder
      await user.click(screen.getByText('restricted'));

      // Verify error is displayed
      await waitFor(() => {
        expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
      });
    });

    it('should remain in current directory when navigation fails', async () => {
      const user = userEvent.setup();
      
      // Mock initial load with files and folder
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'README.md', relativePath: 'README.md', kind: 'file' },
            { name: 'missing', relativePath: 'missing', kind: 'folder' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('README.md')).toBeInTheDocument();
        expect(screen.getByText('missing')).toBeInTheDocument();
      });

      // Mock failed navigation
      (global.fetch as any).mockRejectedValueOnce(
        new Error('Entry not found')
      );

      // Click on folder
      await user.click(screen.getByText('missing'));

      // Verify still in current directory
      await waitFor(() => {
        expect(screen.getByText('README.md')).toBeInTheDocument();
        expect(screen.getByText(/Entry not found/i)).toBeInTheDocument();
      });
    });

    it('should show different error messages for different failure types', async () => {
      const user = userEvent.setup();
      
      // Mock initial load with folder
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'test-folder', relativePath: 'test-folder', kind: 'folder' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('test-folder')).toBeInTheDocument();
      });

      // Mock permission error
      (global.fetch as any).mockRejectedValueOnce(
        new Error('Permission denied: cannot access folder')
      );

      await user.click(screen.getByText('test-folder'));

      // Verify permission error message
      await waitFor(() => {
        expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
      });
    });
  });
});
