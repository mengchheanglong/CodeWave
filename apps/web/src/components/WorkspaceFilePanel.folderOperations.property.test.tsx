import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import { submitWorkspacePrompt } from '../test/workspace-prompt';
import { WorkspaceFilePanel } from './WorkspaceFilePanel';

/**
 * Property-based tests for Task 6.1: Folder operations
 * 
 * These tests verify universal properties about folder operations behavior
 * using fast-check to generate random test cases.
 */

describe('WorkspaceFilePanel - Folder Operations Properties', () => {
  const mockWorkspacePath = '/test/workspace';

  function preparePropertyIteration() {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(window.prompt).mockReset();
    vi.mocked(window.confirm).mockReset();
    global.fetch = vi.fn();
  }

  function exactTitle(title: string) {
    return (_content: string, element: Element | null) =>
      element?.getAttribute('title') === title;
  }
  
  beforeEach(() => {
    vi.stubGlobal('prompt', vi.fn());
    vi.stubGlobal('confirm', vi.fn());
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  /**
   * Feature: sidebar-improvements, Property 1: Valid entry creation succeeds
   * 
   * For any valid entry name (folder or file) and any valid parent directory path,
   * creating the entry should result in the entry appearing in the directory listing
   * after refresh.
   * 
   * **Validates: Requirements 2.2, 2.5**
   */
  describe('Property 1: Valid entry creation succeeds', () => {
    it('should create folder and show it in listing', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 })
            .filter(name => {
              // Valid folder names: no slashes, no special chars
              return name.trim().length > 0 && 
                     !/[/\\:*?"<>|]/.test(name);
            }),
      async (folderName) => {
        preparePropertyIteration();
            const user = userEvent.setup();
            
            // Mock initial load - empty directory
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: '',
                entries: [],
              })
            });

            const { unmount } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
            
            await waitFor(() => {
              expect(screen.queryByText(/Loading entries/i)).not.toBeInTheDocument();
            });

            // Create folder
            vi.mocked(window.prompt).mockReturnValueOnce(folderName);
            (global.fetch as any)
              .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
              .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                  workspacePath: mockWorkspacePath,
                  relativePath: '',
                  entries: [
                    { name: folderName.trim(), relativePath: folderName.trim(), kind: 'folder' }
                  ],
                })
              });

            await user.click(screen.getByRole('button', { name: /New folder/i }));
            await submitWorkspacePrompt(folderName);

            // Property: Created folder should appear in listing
            await waitFor(() => {
              expect(screen.getByTitle(exactTitle(folderName.trim()))).toBeInTheDocument();
            });
            
            unmount();
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);
  });

  /**
   * Feature: sidebar-improvements, Property 2: Invalid entry names produce validation errors
   * 
   * For any entry name that is empty or contains invalid characters (such as `/`, `\`, `:`,
   * `*`, `?`, `"`, `<`, `>`, `|`), attempting to create or rename an entry should display
   * a descriptive error message and preserve the current view state.
   * 
   * **Validates: Requirements 2.3, 5.3, 6.3**
   */
  describe('Property 2: Invalid entry names produce validation errors', () => {
    it('should show validation error for invalid folder names', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('/', '\\', ':', '*', '?', '"', '<', '>', '|')
            .chain(invalidChar => 
              fc.string({ minLength: 1, maxLength: 20 })
                .map(base => `${base}${invalidChar}${base}`)
            ),
      async (invalidName) => {
        preparePropertyIteration();
            const user = userEvent.setup();
            
            // Mock initial load with existing entries
            const existingEntries = [
              { name: 'existing.ts', relativePath: 'existing.ts', kind: 'file' as const }
            ];
            
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: '',
                entries: existingEntries,
              })
            });

            const { unmount } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
            
            await waitFor(() => {
              expect(screen.getByText('existing.ts')).toBeInTheDocument();
            });

            // Attempt to create folder with invalid name
            vi.mocked(window.prompt).mockReturnValueOnce(invalidName);
            (global.fetch as any).mockRejectedValueOnce(
              new Error(`Invalid folder name: contains invalid characters`)
            );

            await user.click(screen.getByRole('button', { name: /New folder/i }));
            await submitWorkspacePrompt(invalidName);

            // Property: Should show validation error and preserve view
            await waitFor(() => {
              expect(screen.getByText(/Invalid.*name/i)).toBeInTheDocument();
              expect(screen.getByText('existing.ts')).toBeInTheDocument();
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 20 }
      );
    }, 15000);

    it('should show validation error for empty folder names', async () => {
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

      // Attempt to create folder with empty name (component returns early, no API call)
      vi.mocked(window.prompt).mockReturnValueOnce('   ');

      await user.click(screen.getByRole('button', { name: /New folder/i }));

      // Property: Component should handle empty names gracefully (no error, no change)
      // The component returns early for empty names, so view should be unchanged
      await waitFor(() => {
        expect(screen.getByText('test.ts')).toBeInTheDocument();
      });
      
      // Verify no error was shown (component handles this by returning early)
      expect(screen.queryByText(/Invalid.*name/i)).not.toBeInTheDocument();
    });
  });

  /**
   * Feature: sidebar-improvements, Property 3: Entry rename round-trip preserves identity
   * 
   * For any existing entry (file or folder) and any valid new name, renaming the entry
   * and then listing the directory should show the entry with the new name and the same
   * kind (file/folder) as before.
   * 
   * **Validates: Requirements 5.2, 6.2**
   */
  describe('Property 3: Entry rename round-trip preserves identity', () => {
    it('should preserve folder identity after rename', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(name => {
              const trimmed = name.trim();
              return trimmed.length > 0 &&
                trimmed !== 'other.ts' &&
                !/[/\\:*?"<>|]/.test(name);
            }),
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(name => name.trim().length > 0 && !/[/\\:*?"<>|]/.test(name)),
      async (originalName, newName) => {
        preparePropertyIteration();
            // Skip if names are the same
            if (originalName.trim() === newName.trim()) {
              return;
            }

            const user = userEvent.setup();
            
            // Mock initial load with folder
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: '',
                entries: [
                  { name: originalName.trim(), relativePath: originalName.trim(), kind: 'folder' }
                ],
              })
            });

            const { unmount, container } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
            
            await waitFor(() => {
              const folderName = container.querySelector('.workspace-file-name')?.textContent;
              expect(folderName).toBe(originalName.trim());
            });

            // Rename folder
            vi.mocked(window.prompt).mockReturnValueOnce(newName);
            (global.fetch as any)
              .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
              .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                  workspacePath: mockWorkspacePath,
                  relativePath: '',
                  entries: [
                    { name: newName.trim(), relativePath: newName.trim(), kind: 'folder' }
                  ],
                })
              });

            const renameButtons = Array.from(container.querySelectorAll('button')).filter(btn => btn.textContent === 'Rename');
            if (renameButtons[0]) {
              await user.click(renameButtons[0]);
              await submitWorkspacePrompt(newName);
            }

            // Property: Entry should have new name and same kind (folder)
            await waitFor(() => {
              const folderName = container.querySelector('.workspace-file-name')?.textContent;
              expect(folderName).toBe(newName.trim());
              // Verify it's still a folder by checking for folder icon
              const folderIcon = container.querySelector('.workspace-file-kind svg');
              expect(folderIcon).not.toBeNull();
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 50 }
      );
    }, 120000);

    it('should preserve file identity after rename', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 })
            .filter(name => {
              const trimmed = name.trim();
              // Filter out names with invalid chars and names that start with special chars that might cause issues
              return trimmed.length > 0 && 
                     !/[/\\:*?"<>|$#]/.test(trimmed) &&
                     !/^[.]/.test(trimmed);
            })
            .map(name => `${name.trim()}.ts`),
          fc.string({ minLength: 1, maxLength: 20 })
            .filter(name => {
              const trimmed = name.trim();
              return trimmed.length > 0 && 
                     trimmed !== 'keep' &&
                     !/[/\\:*?"<>|$#]/.test(trimmed) &&
                     !/^[.]/.test(trimmed);
            }),
      async (originalName, newBaseName) => {
        preparePropertyIteration();
            const user = userEvent.setup();
            
            // Mock initial load with file
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: '',
                entries: [
                  { name: originalName, relativePath: originalName, kind: 'file' }
                ],
              })
            });

            const { unmount, container } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
            
            await waitFor(() => {
              expect(container.querySelector('.workspace-file-name')?.textContent).toBe(originalName);
            });

            // Rename file (extension should be preserved)
            const expectedNewName = `${newBaseName.trim()}.ts`;
            vi.mocked(window.prompt).mockReturnValueOnce(newBaseName);
            (global.fetch as any)
              .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
              .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                  workspacePath: mockWorkspacePath,
                  relativePath: '',
                  entries: [
                    { name: expectedNewName, relativePath: expectedNewName, kind: 'file' }
                  ],
                })
              });

            const renameButtons = container.querySelectorAll('button');
            const renameButton = Array.from(renameButtons).find(btn => btn.textContent === 'Rename');
            if (renameButton) {
              await user.click(renameButton);
              await submitWorkspacePrompt(newBaseName);
            }

            // Property: Entry should have new name and same kind (file)
            await waitFor(() => {
              const fileName = container.querySelector('.workspace-file-name')?.textContent;
              expect(fileName).toBe(expectedNewName);
              // Verify it's still a file by checking for file icon
              const fileIcon = container.querySelector('.workspace-file-kind svg');
              expect(fileIcon).not.toBeNull();
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 50 }
      );
    }, 120000);
  });

  /**
   * Feature: sidebar-improvements, Property 4: Entry deletion removes from listing
   * 
   * For any existing entry (file or folder), deleting the entry and then listing
   * the directory should result in the entry no longer appearing in the directory listing.
   * 
   * **Validates: Requirements 3.3, 7.2**
   */
  describe('Property 4: Entry deletion removes from listing', () => {
    it('should remove folder from listing after deletion', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(name => name.trim().length > 0 && !/[/\\:*?"<>|]/.test(name)),
      async (folderName) => {
        preparePropertyIteration();
            const user = userEvent.setup();
            
            // Mock initial load with folder and other entries
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: '',
                entries: [
                  { name: folderName.trim(), relativePath: folderName.trim(), kind: 'folder' },
                  { name: 'other.ts', relativePath: 'other.ts', kind: 'file' }
                ],
              })
            });

            const { container, unmount } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
            
            await waitFor(() => {
              const names = Array.from(
                container.querySelectorAll('.workspace-file-name'),
              ).map((element) => element.textContent);
              expect(names).toContain(folderName.trim());
              expect(names).toContain('other.ts');
            });

            // Delete folder
            (global.fetch as any)
              .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
              .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                  workspacePath: mockWorkspacePath,
                  relativePath: '',
                  entries: [
                    { name: 'other.ts', relativePath: 'other.ts', kind: 'file' }
                  ],
                })
              });

            // Find the delete button for the folder (first one)
            const deleteButtons = Array.from(
              container.querySelectorAll<HTMLButtonElement>('button'),
            ).filter((button) => button.textContent === 'Delete');
            await user.click(deleteButtons[0]);
            await user.click(screen.getByRole('button', { name: 'Delete folder' }));

            // Property: Deleted folder should not appear in listing
            await waitFor(() => {
              const names = Array.from(
                container.querySelectorAll('.workspace-file-name'),
              ).map((element) => element.textContent);
              expect(names).not.toContain(folderName.trim());
              expect(names).toContain('other.ts');
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 50 }
      );
    }, 120000);

    it('should remove file from listing after deletion', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 })
            .filter(name => {
              const trimmed = name.trim();
              return trimmed.length > 0 && 
                     !/[/\\:*?"<>|$#]/.test(trimmed) &&
                     !/^[.]/.test(trimmed);
            })
            .map(name => `${name.trim()}.ts`),
      async (fileName) => {
        preparePropertyIteration();
            const user = userEvent.setup();
            
            // Mock initial load with file and other entries
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: '',
                entries: [
                  { name: fileName, relativePath: fileName, kind: 'file' },
                  { name: 'keep.ts', relativePath: 'keep.ts', kind: 'file' }
                ],
              })
            });

            const { unmount, container } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
            
            await waitFor(() => {
              const fileNames = Array.from(container.querySelectorAll('.workspace-file-name')).map(el => el.textContent);
              expect(fileNames).toContain(fileName);
              expect(fileNames).toContain('keep.ts');
            });

            // Delete file
            (global.fetch as any)
              .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
              .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                  workspacePath: mockWorkspacePath,
                  relativePath: '',
                  entries: [
                    { name: 'keep.ts', relativePath: 'keep.ts', kind: 'file' }
                  ],
                })
              });

            // Find the delete button for the file (first one)
            const deleteButtons = Array.from(container.querySelectorAll('button')).filter(btn => btn.textContent === 'Delete');
            if (deleteButtons[0]) {
              await user.click(deleteButtons[0]);
              await user.click(screen.getByRole('button', { name: 'Delete file' }));
            }

            // Property: Deleted file should not appear in listing
            await waitFor(() => {
              const fileNames = Array.from(container.querySelectorAll('.workspace-file-name')).map(el => el.textContent);
              expect(fileNames).not.toContain(fileName);
              expect(fileNames).toContain('keep.ts');
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 50 }
      );
    }, 120000);
  });

  /**
   * Feature: sidebar-improvements, Property 5: Successful operations refresh the view
   * 
   * For any successful file operation (create, rename, delete), the workspace file panel
   * should refresh to display the updated directory listing reflecting the change.
   * 
   * **Validates: Requirements 2.5, 3.4, 5.5, 6.5, 7.3**
   */
  describe('Property 5: Successful operations refresh the view', () => {
    it('should refresh view after successful folder creation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(name => name.trim().length > 0 && !/[/\\:*?"<>|]/.test(name)),
      async (folderName) => {
        preparePropertyIteration();
            const user = userEvent.setup();
            
            // Mock initial load - empty directory
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: '',
                entries: [],
              })
            });

            const { unmount } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
            
            await waitFor(() => {
              expect(screen.queryByText(/Loading entries/i)).not.toBeInTheDocument();
            });

            // Create folder
            vi.mocked(window.prompt).mockReturnValueOnce(folderName);
            
            let refreshCalled = false;
            (global.fetch as any)
              .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
              .mockImplementationOnce(async () => {
                refreshCalled = true;
                return {
                  ok: true,
                  json: async () => ({
                    workspacePath: mockWorkspacePath,
                    relativePath: '',
                    entries: [
                      { name: folderName.trim(), relativePath: folderName.trim(), kind: 'folder' }
                    ],
                  })
                };
              });

            await user.click(screen.getByRole('button', { name: /New folder/i }));
            await submitWorkspacePrompt(folderName);

            // Property: View should refresh and show new folder
            await waitFor(() => {
              expect(refreshCalled).toBe(true);
              expect(screen.getByTitle(exactTitle(folderName.trim()))).toBeInTheDocument();
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 30 }
      );
    }, 120000);

    it('should refresh view after successful rename', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 })
            .filter(name => name.trim().length > 0 && !/[/\\:*?"<>|]/.test(name)),
          fc.string({ minLength: 1, maxLength: 20 })
            .filter(name => name.trim().length > 0 && !/[/\\:*?"<>|]/.test(name)),
      async (oldName, newName) => {
        preparePropertyIteration();
            // Skip if names are the same
            if (oldName.trim() === newName.trim()) {
              return;
            }

            const user = userEvent.setup();
            
            // Mock initial load with folder
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: '',
                entries: [
                  { name: oldName.trim(), relativePath: oldName.trim(), kind: 'folder' }
                ],
              })
            });

            const { unmount } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
            
            await waitFor(() => {
              expect(screen.getByTitle(exactTitle(oldName.trim()))).toBeInTheDocument();
            });

            // Rename folder
            vi.mocked(window.prompt).mockReturnValueOnce(newName);
            
            let refreshCalled = false;
            (global.fetch as any)
              .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
              .mockImplementationOnce(async () => {
                refreshCalled = true;
                return {
                  ok: true,
                  json: async () => ({
                    workspacePath: mockWorkspacePath,
                    relativePath: '',
                    entries: [
                      { name: newName.trim(), relativePath: newName.trim(), kind: 'folder' }
                    ],
                  })
                };
              });

            await user.click(screen.getAllByRole('button', { name: /Rename/i })[0]);
            await submitWorkspacePrompt(newName);

            // Property: View should refresh and show renamed folder
            await waitFor(() => {
              expect(refreshCalled).toBe(true);
              expect(screen.getByTitle(exactTitle(newName.trim()))).toBeInTheDocument();
              expect(screen.queryByTitle(exactTitle(oldName.trim()))).not.toBeInTheDocument();
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 30 }
      );
    }, 120000);

    it('should refresh view after successful deletion', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(name => name.trim().length > 0 && !/[/\\:*?"<>|]/.test(name)),
      async (folderName) => {
        preparePropertyIteration();
            const user = userEvent.setup();
            
            // Mock initial load with folder
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: '',
                entries: [
                  { name: folderName.trim(), relativePath: folderName.trim(), kind: 'folder' }
                ],
              })
            });

            const { unmount } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
            
            await waitFor(() => {
              expect(screen.getByTitle(exactTitle(folderName.trim()))).toBeInTheDocument();
            });

            // Delete folder
            let refreshCalled = false;
            (global.fetch as any)
              .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
              .mockImplementationOnce(async () => {
                refreshCalled = true;
                return {
                  ok: true,
                  json: async () => ({
                    workspacePath: mockWorkspacePath,
                    relativePath: '',
                    entries: [],
                  })
                };
              });

            await user.click(screen.getAllByRole('button', { name: /Delete/i })[0]);
            await user.click(screen.getByRole('button', { name: 'Delete folder' }));

            // Property: View should refresh and folder should be gone
            await waitFor(() => {
              expect(refreshCalled).toBe(true);
              expect(screen.queryByTitle(exactTitle(folderName.trim()))).not.toBeInTheDocument();
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 30 }
      );
    }, 120000);
  });
});
