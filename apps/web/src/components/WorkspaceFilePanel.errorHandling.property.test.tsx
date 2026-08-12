import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import { submitWorkspacePrompt } from '../test/workspace-prompt';
import { WorkspaceFilePanel } from './WorkspaceFilePanel';

/**
 * Property-based tests for Task 4.3: Error handling
 * 
 * These tests verify universal properties about error handling behavior
 * using fast-check to generate random test cases.
 */

describe('WorkspaceFilePanel - Error Handling Properties', () => {
  const mockWorkspacePath = '/test/workspace';
  
  beforeEach(() => {
    vi.stubGlobal('prompt', vi.fn());
    vi.stubGlobal('confirm', vi.fn());
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Feature: sidebar-improvements, Property 6: Failed operations preserve view state
   * 
   * For any file operation that fails (due to permissions, conflicts, or validation errors),
   * the current view state should remain unchanged and an error message should be displayed.
   * 
   * **Validates: Requirements 2.6, 3.5, 7.4, 9.3**
   */
  describe('Property 6: Failed operations preserve view state', () => {
    it('should preserve entries when createFolder fails', async () => {
      const user = userEvent.setup();
      
      // Mock initial load with entries
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'file1.ts', relativePath: 'file1.ts', kind: 'file' },
            { name: 'file2.ts', relativePath: 'file2.ts', kind: 'file' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('file1.ts')).toBeInTheDocument();
        expect(screen.getByText('file2.ts')).toBeInTheDocument();
      });

      // Attempt to create folder - fails
      vi.mocked(window.prompt).mockReturnValueOnce('newfolder');
      (global.fetch as any).mockRejectedValueOnce(new Error('Permission denied'));

      await user.click(screen.getByRole('button', { name: /New folder/i }));
      await submitWorkspacePrompt('newfolder');

      // Property: View state should be preserved
      await waitFor(() => {
        // Error should be displayed
        expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
        
        // All original entries should still be visible
        expect(screen.getByText('file1.ts')).toBeInTheDocument();
        expect(screen.getByText('file2.ts')).toBeInTheDocument();
      });
    });

    it('should preserve entries when rename fails', async () => {
      const user = userEvent.setup();
      
      // Mock initial load with entries
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'original.ts', relativePath: 'original.ts', kind: 'file' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('original.ts')).toBeInTheDocument();
      });

      // Attempt to rename - fails
      vi.mocked(window.prompt).mockReturnValueOnce('newname');
      (global.fetch as any).mockRejectedValueOnce(new Error('Invalid file name'));

      await user.click(screen.getAllByRole('button', { name: /Rename/i })[0]);
      await submitWorkspacePrompt('newname');

      // Property: View state should be preserved
      await waitFor(() => {
        // Error should be displayed
        expect(screen.getByText(/Invalid file name/i)).toBeInTheDocument();
        
        // Original entry should still be visible with original name
        expect(screen.getByText('original.ts')).toBeInTheDocument();
      });
    });

    it('should preserve entries when delete fails', async () => {
      const user = userEvent.setup();
      
      // Mock initial load with entries
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'protected.ts', relativePath: 'protected.ts', kind: 'file' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('protected.ts')).toBeInTheDocument();
      });

      // Attempt to delete - fails
      vi.mocked(window.confirm).mockReturnValueOnce(true);
      (global.fetch as any).mockRejectedValueOnce(new Error('Permission denied'));

      await user.click(screen.getAllByRole('button', { name: /Delete/i })[0]);

      // Property: View state should be preserved
      await waitFor(() => {
        // Error should be displayed
        expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
        
        // Entry should still be visible
        expect(screen.getByText('protected.ts')).toBeInTheDocument();
      });
    });
  });

  /**
   * Feature: sidebar-improvements, Property 7: Error messages distinguish error types
   * 
   * For any file operation failure, the error message should clearly indicate whether
   * the failure was due to permissions, not-found conditions, or naming conflicts,
   * allowing users to understand the specific issue.
   * 
   * **Validates: Requirements 9.1, 9.2**
   */
  describe('Property 7: Error messages distinguish error types', () => {
    it('should format permission errors distinctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('create', 'rename', 'delete'),
          async (operation) => {
            const user = userEvent.setup();
            
            // Mock initial load
            const initialEntries = operation === 'create' ? [] : [
              { name: 'test.ts', relativePath: 'test.ts', kind: 'file' as const }
            ];
            
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: '',
                entries: initialEntries,
              })
            });

            const { unmount } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
            
            await waitFor(() => {
              expect(screen.queryByText(/Loading entries/i)).not.toBeInTheDocument();
            });

            // Trigger operation with permission error
            (global.fetch as any).mockRejectedValueOnce(new Error('Permission denied'));

            if (operation === 'create') {
              vi.mocked(window.prompt).mockReturnValueOnce('newfolder');
              await user.click(screen.getByRole('button', { name: /New folder/i }));
              await submitWorkspacePrompt('newfolder');
            } else if (operation === 'rename') {
              vi.mocked(window.prompt).mockReturnValueOnce('newname');
              await user.click(screen.getAllByRole('button', { name: /Rename/i })[0]);
              await submitWorkspacePrompt('newname');
            } else {
              vi.mocked(window.confirm).mockReturnValueOnce(true);
              await user.click(screen.getAllByRole('button', { name: /Delete/i })[0]);
            }

            // Property: Error message should clearly indicate permission issue
            await waitFor(() => {
              const errorElement = screen.getByText(/Permission denied/i);
              expect(errorElement).toBeInTheDocument();
              expect(errorElement.textContent).toMatch(/cannot/i);
            });
            
            unmount();
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should format conflict errors distinctly', async () => {
      const user = userEvent.setup();
      
      // Mock initial load
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

      // Trigger create with conflict error
      vi.mocked(window.prompt).mockReturnValueOnce('existing');
      (global.fetch as any).mockRejectedValueOnce(new Error('Folder already exists: existing'));

      await user.click(screen.getByRole('button', { name: /New folder/i }));
      await submitWorkspacePrompt('existing');

      // Property: Error message should clearly indicate conflict
      await waitFor(() => {
        const errorElement = screen.getByText(/already exists/i);
        expect(errorElement).toBeInTheDocument();
        expect(errorElement.textContent).toContain('existing');
      });
    });

    it('should format validation errors distinctly', async () => {
      const user = userEvent.setup();
      
      // Mock initial load
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

      // Trigger create with validation error
      vi.mocked(window.prompt).mockReturnValueOnce('invalid/name');
      (global.fetch as any).mockRejectedValueOnce(new Error('Invalid folder name: contains invalid characters'));

      await user.click(screen.getByRole('button', { name: /New folder/i }));
      await submitWorkspacePrompt('invalid/name');

      // Property: Error message should clearly indicate validation issue
      await waitFor(() => {
        const errorElement = screen.getByText(/Invalid.*name/i);
        expect(errorElement).toBeInTheDocument();
        expect(errorElement.textContent).toMatch(/contains invalid characters/i);
      });
    });

    it('should format not-found errors distinctly', async () => {
      const user = userEvent.setup();
      
      // Mock initial load with entry
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'missing.ts', relativePath: 'missing.ts', kind: 'file' as const }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('missing.ts')).toBeInTheDocument();
      });

      // Trigger delete with not-found error
      vi.mocked(window.confirm).mockReturnValueOnce(true);
      (global.fetch as any).mockRejectedValueOnce(new Error('File not found: missing.ts'));

      await user.click(screen.getAllByRole('button', { name: /Delete/i })[0]);

      // Property: Error message should clearly indicate not-found issue
      await waitFor(() => {
        const errorElement = screen.getByText(/not found/i);
        expect(errorElement).toBeInTheDocument();
        expect(errorElement.textContent).toContain('missing.ts');
      });
    });
  });

  /**
   * Feature: sidebar-improvements, Property 8: Successful operations clear previous errors
   * 
   * For any error state followed by a successful operation, the error message
   * should be cleared from the display.
   * 
   * **Validates: Requirements 9.4**
   */
  describe('Property 8: Successful operations clear previous errors', () => {
    it('should clear error when createFolder succeeds after failure', async () => {
      const user = userEvent.setup();
      
      // Mock initial load
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

      // First operation: createFolder fails
      vi.mocked(window.prompt).mockReturnValueOnce('badfolder');
      (global.fetch as any).mockRejectedValueOnce(new Error('Permission denied'));

      await user.click(screen.getByRole('button', { name: /New folder/i }));
      await submitWorkspacePrompt('badfolder');

      // Verify error is displayed
      await waitFor(() => {
        expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
      });

      // Second operation: createFolder succeeds
      vi.mocked(window.prompt).mockReturnValueOnce('goodfolder');
      (global.fetch as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workspacePath: mockWorkspacePath,
            relativePath: '',
            entries: [
              { name: 'goodfolder', relativePath: 'goodfolder', kind: 'folder' }
            ],
          })
        });

      await user.click(screen.getByRole('button', { name: /New folder/i }));
      await submitWorkspacePrompt('goodfolder');

      // Property: Error should be cleared
      await waitFor(() => {
        expect(screen.queryByText(/Permission denied/i)).not.toBeInTheDocument();
        expect(screen.getByText('goodfolder')).toBeInTheDocument();
      });
    });

    it('should clear error when refresh succeeds after failure', async () => {
      const user = userEvent.setup();
      
      // Mock initial load
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'test.ts', relativePath: 'test.ts', kind: 'file' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('test.ts')).toBeInTheDocument();
      });

      // First operation: createFolder fails
      vi.mocked(window.prompt).mockReturnValueOnce('badfolder');
      (global.fetch as any).mockRejectedValueOnce(new Error('Invalid folder name'));

      await user.click(screen.getByRole('button', { name: /New folder/i }));
      await submitWorkspacePrompt('badfolder');

      // Verify error is displayed
      await waitFor(() => {
        expect(screen.getByText(/Invalid folder name/i)).toBeInTheDocument();
      });

      // Second operation: refresh succeeds
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'test.ts', relativePath: 'test.ts', kind: 'file' }
          ],
        })
      });

      await user.click(screen.getByRole('button', { name: /Refresh/i }));

      // Property: Error should be cleared
      await waitFor(() => {
        expect(screen.queryByText(/Invalid folder name/i)).not.toBeInTheDocument();
        expect(screen.getByText('test.ts')).toBeInTheDocument();
      });
    });

    it('should clear error when rename succeeds after failure', async () => {
      const user = userEvent.setup();
      
      // Mock initial load
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'old.ts', relativePath: 'old.ts', kind: 'file' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('old.ts')).toBeInTheDocument();
      });

      // First operation: rename fails
      vi.mocked(window.prompt).mockReturnValueOnce('invalid/name');
      (global.fetch as any).mockRejectedValueOnce(new Error('Invalid file name'));

      await user.click(screen.getAllByRole('button', { name: /Rename/i })[0]);
      await submitWorkspacePrompt('invalid/name');

      // Verify error is displayed
      await waitFor(() => {
        expect(screen.getByText(/Invalid file name/i)).toBeInTheDocument();
      });

      // Second operation: rename succeeds
      vi.mocked(window.prompt).mockReturnValueOnce('new');
      (global.fetch as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workspacePath: mockWorkspacePath,
            relativePath: '',
            entries: [
              { name: 'new.ts', relativePath: 'new.ts', kind: 'file' }
            ],
          })
        });

      await user.click(screen.getAllByRole('button', { name: /Rename/i })[0]);
      await submitWorkspacePrompt('new');

      // Property: Error should be cleared
      await waitFor(() => {
        expect(screen.queryByText(/Invalid file name/i)).not.toBeInTheDocument();
        expect(screen.getByText('new.ts')).toBeInTheDocument();
      });
    });
  });
});
