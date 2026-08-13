import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import { WorkspaceFilePanel } from './WorkspaceFilePanel';

/**
 * Property-based tests for Task 7.1: Folder navigation
 * 
 * These tests verify universal properties about folder navigation behavior
 * using fast-check to generate random test cases.
 */

describe('WorkspaceFilePanel - Folder Navigation Properties', () => {
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
   * Feature: sidebar-improvements, Property 9: Folder navigation updates path display
   * 
   * For any folder in the current directory, clicking the folder should navigate into it
   * and update the path display to reflect the new current location.
   * 
   * **Validates: Requirements 4.1, 4.2**
   */
  describe('Property 9: Folder navigation updates path display', () => {
    it('should update path display when navigating into folder', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(name => name.trim().length > 0 && !/[/\\:*?"<>|]/.test(name)),
      async (folderName) => {
        preparePropertyIteration();
            const user = userEvent.setup();
            
            // Mock initial load at root with folder
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
            const normalizedFolderName = folderName.trim();
            let folderButton: HTMLButtonElement;
            await waitFor(() => {
              folderButton = screen.getByTitle(
                exactTitle(normalizedFolderName),
              ) as HTMLButtonElement;
            });

            // Mock navigation into folder
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: folderName.trim(),
                entries: [],
              })
            });

            // Click on folder
            await user.click(folderButton!);

            // Property: Path display should show the folder path
            await waitFor(() => {
              expect(screen.getByTitle(mockWorkspacePath).textContent).toBe(
                `/${normalizedFolderName}`,
              );
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 50 }
      );
    }, 120000);

    it('should update path display for nested folder navigation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 20 })
              .filter(name => name.trim().length > 0 && !/[/\\:*?"<>|]/.test(name)),
            fc.string({ minLength: 1, maxLength: 20 })
              .filter(name => name.trim().length > 0 && !/[/\\:*?"<>|]/.test(name))
          ),
      async ([folder1, folder2]) => {
        preparePropertyIteration();
            const user = userEvent.setup();
            
            // Mock initial load at root
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: '',
                entries: [
                  { name: folder1.trim(), relativePath: folder1.trim(), kind: 'folder' }
                ],
              })
            });

            const { unmount } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
            
            await waitFor(() => {
              expect(screen.getByTitle(exactTitle(folder1.trim()))).toBeInTheDocument();
            });

            // Navigate into first folder
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: folder1.trim(),
                entries: [
                  { name: folder2.trim(), relativePath: `${folder1.trim()}/${folder2.trim()}`, kind: 'folder' }
                ],
              })
            });

            await user.click(screen.getByTitle(exactTitle(folder1.trim())));

            await waitFor(() => {
              expect(screen.getByTitle(mockWorkspacePath).textContent).toBe(`/${folder1.trim()}`);
              expect(
                screen.getByTitle(exactTitle(`${folder1.trim()}/${folder2.trim()}`)),
              ).toBeInTheDocument();
            });

            // Navigate into second folder
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: `${folder1.trim()}/${folder2.trim()}`,
                entries: [],
              })
            });

            await user.click(
              screen.getByTitle(exactTitle(`${folder1.trim()}/${folder2.trim()}`)),
            );

            // Property: Path display should show nested path
            await waitFor(() => {
              expect(screen.getByTitle(mockWorkspacePath).textContent).toBe(
                `/${folder1.trim()}/${folder2.trim()}`,
              );
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 30 }
      );
    }, 120000);
  });

  /**
   * Feature: sidebar-improvements, Property 10: Folder navigation loads contents
   * 
   * For any folder in the current directory, navigating into the folder should load
   * and display all entries (files and folders) contained within that folder.
   * 
   * **Validates: Requirements 4.3**
   */
  describe('Property 10: Folder navigation loads contents', () => {
    it('should load and display folder contents after navigation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 })
            .filter(name => name.trim().length > 0 && !/[/\\:*?"<>|]/.test(name)),
          fc.array(
            fc.string({ minLength: 1, maxLength: 20 })
              .filter(name => {
                const trimmed = name.trim();
                return trimmed.length > 0 && 
                       !/[/\\:*?"<>|$#]/.test(trimmed) &&
                       !/^[.]/.test(trimmed);
              })
              .map(name => `${name.trim()}.ts`),
            { minLength: 1, maxLength: 5 }
          ),
      async (folderName, fileNames) => {
        preparePropertyIteration();
            const user = userEvent.setup();
            
            // Mock initial load at root with folder
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

            const { unmount, container } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
            
            await waitFor(() => {
              expect(screen.getByTitle(exactTitle(folderName.trim()))).toBeInTheDocument();
            });

            // Mock navigation into folder with files
            const folderEntries = fileNames.map(fileName => ({
              name: fileName,
              relativePath: `${folderName.trim()}/${fileName}`,
              kind: 'file' as const
            }));

            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: folderName.trim(),
                entries: folderEntries,
              })
            });

            // Click on folder
            await user.click(screen.getByTitle(exactTitle(folderName.trim())));

            // Property: All files should be displayed
            await waitFor(() => {
              const displayedFiles = Array.from(container.querySelectorAll('.workspace-file-name'))
                .map(el => el.textContent);
              
              for (const fileName of fileNames) {
                expect(displayedFiles).toContain(fileName);
              }
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 30 }
      );
    }, 120000);

    it('should load empty folder contents', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(name => name.trim().length > 0 && !/[/\\:*?"<>|]/.test(name)),
      async (folderName) => {
        preparePropertyIteration();
            const user = userEvent.setup();
            
            // Mock initial load at root with folder
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

            const { unmount, container } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
            
            await waitFor(() => {
              expect(screen.getByTitle(exactTitle(folderName.trim()))).toBeInTheDocument();
            });

            // Mock navigation into empty folder
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: folderName.trim(),
                entries: [],
              })
            });

            // Click on folder
            await user.click(screen.getByTitle(exactTitle(folderName.trim())));

            // Property: Should show empty folder (no entries)
            await waitFor(() => {
              expect(screen.getByTitle(mockWorkspacePath).textContent).toBe(`/${folderName.trim()}`);
              const fileEntries = container.querySelectorAll('.workspace-file-name');
              expect(fileEntries.length).toBe(0);
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 30 }
      );
    }, 20000);
  });

  /**
   * Feature: sidebar-improvements, Property 11: Failed navigation preserves current directory
   * 
   * For any folder navigation that fails (due to permissions or missing directories),
   * the system should remain in the current directory and display an error message.
   * 
   * **Validates: Requirements 4.6**
   */
  describe('Property 11: Failed navigation preserves current directory', () => {
    it('should preserve current directory when navigation fails', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(name => name.trim().length > 0 && !/[/\\:*?"<>|]/.test(name)),
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(name => name.trim().length > 0 && !/[/\\:*?"<>|]/.test(name)),
          async (existingFile, folderName) => {
            preparePropertyIteration();
            if (`${existingFile.trim()}.ts` === folderName.trim()) return;
            const user = userEvent.setup();
            
            // Mock initial load at root with existing file and folder
            (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: async () => ({
                workspacePath: mockWorkspacePath,
                relativePath: '',
                entries: [
                  { name: existingFile.trim() + '.ts', relativePath: existingFile.trim() + '.ts', kind: 'file' },
                  { name: folderName.trim(), relativePath: folderName.trim(), kind: 'folder' }
                ],
              })
            });

            const { unmount } = render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);

            await waitFor(() => {
              expect(screen.getByTitle(exactTitle(existingFile.trim() + '.ts'))).toBeInTheDocument();
              expect(screen.getByTitle(exactTitle(folderName.trim()))).toBeInTheDocument();
            });

            // Mock failed navigation (permission denied or not found)
            (global.fetch as any).mockRejectedValueOnce(
              new Error('Permission denied: cannot access folder')
            );

            // Click on folder
            await user.click(screen.getByTitle(exactTitle(folderName.trim())));

            // Property: Should remain in current directory and show error
            await waitFor(() => {
              // Still at root (no path display change)
              expect(screen.getByTitle(mockWorkspacePath)).toHaveTextContent('/');
              // Original file still visible
              expect(screen.getByTitle(exactTitle(existingFile.trim() + '.ts'))).toBeInTheDocument();
              // Error message displayed
              expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 30 }
      );
    }, 120000);

    it('should show error message when navigation fails', async () => {
      const user = userEvent.setup();
      
      // Mock initial load at root with folder
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
        new Error('Entry not found')
      );

      // Click on folder
      await user.click(screen.getByText('restricted'));

      // Property: Error message should be displayed
      await waitFor(() => {
        expect(screen.getByText(/Entry not found/i)).toBeInTheDocument();
      });
    });
  });
});
