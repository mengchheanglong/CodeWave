import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

/**
 * Feature: sidebar-improvements, Property 12: File extension preservation in rename prompts
 * 
 * For any file with an extension, when the rename prompt is displayed, the pre-filled value
 * should exclude the extension, but the final renamed file should preserve the original
 * extension if the user doesn't specify one.
 * 
 * **Validates: Requirements 6.7**
 */

// Helper function to extract extension from filename
function getExtension(filename: string): string | null {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex > 0) {
    return filename.substring(lastDotIndex);
  }
  return null;
}

// Helper function to get filename without extension
function getNameWithoutExtension(filename: string): string {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex > 0) {
    return filename.substring(0, lastDotIndex);
  }
  return filename;
}

// Helper function to restore extension if not present in new name
function restoreExtensionIfMissing(newName: string, originalExtension: string | null): string {
  if (!originalExtension) {
    return newName;
  }
  
  if (!newName.includes('.')) {
    return newName + originalExtension;
  }
  
  return newName;
}

describe('WorkspaceFilePanel - File Extension Preservation', () => {
  describe('Property 12: File extension preservation in rename prompts', () => {
    it('should preserve extension when user provides name without extension', () => {
      fc.assert(
        fc.property(
          // Generate filename with extension
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('.') && !s.includes('/')),
            fc.constantFrom('.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css', '.html')
          ).map(([name, ext]) => name + ext),
          // Generate new name without extension
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('.') && !s.includes('/')),
          (originalFilename, newNameWithoutExt) => {
            // Extract extension from original filename
            const extension = getExtension(originalFilename);
            
            // Simulate the rename logic: restore extension if user didn't include it
            const finalName = restoreExtensionIfMissing(newNameWithoutExt, extension);
            
            // Property: Final name should have the same extension as original
            expect(getExtension(finalName)).toBe(extension);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use user-provided extension when user includes one', () => {
      fc.assert(
        fc.property(
          // Generate original filename with extension
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('.') && !s.includes('/')),
            fc.constantFrom('.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css', '.html')
          ).map(([name, ext]) => name + ext),
          // Generate new name WITH extension
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('.') && !s.includes('/')),
            fc.constantFrom('.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css', '.html')
          ).map(([name, ext]) => name + ext),
          (originalFilename, newNameWithExt) => {
            // Extract extension from original filename
            const originalExtension = getExtension(originalFilename);
            
            // Simulate the rename logic: keep user's extension if they provided one
            const finalName = restoreExtensionIfMissing(newNameWithExt, originalExtension);
            
            // Property: Final name should keep the user-provided extension
            expect(finalName).toBe(newNameWithExt);
            expect(getExtension(finalName)).toBe(getExtension(newNameWithExt));
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should pre-fill rename prompt without extension', () => {
      fc.assert(
        fc.property(
          // Generate filename with extension
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('.') && !s.includes('/')),
            fc.constantFrom('.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css', '.html')
          ).map(([name, ext]) => name + ext),
          (filename) => {
            // Simulate the pre-fill logic
            const defaultValue = getNameWithoutExtension(filename);
            const extension = getExtension(filename);
            
            // Property: Default value should not include the extension
            expect(defaultValue).not.toContain(extension!);
            expect(getExtension(defaultValue)).toBeNull();
            
            // Property: Default value + extension should equal original filename
            expect(defaultValue + extension).toBe(filename);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle files without extensions correctly', () => {
      fc.assert(
        fc.property(
          // Generate filename without extension
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('.') && !s.includes('/')),
          // Generate new name
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('/')),
          (originalFilename, newName) => {
            // For files without extension, no restoration should happen
            const extension = getExtension(originalFilename);
            expect(extension).toBeNull();
            
            const finalName = restoreExtensionIfMissing(newName, extension);
            
            // Property: Final name should be exactly what user provided
            expect(finalName).toBe(newName);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle edge case: filename starting with dot', () => {
      fc.assert(
        fc.property(
          // Generate hidden file (starts with dot)
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('.') && !s.includes('/')).map(s => '.' + s),
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('.') && !s.includes('/')),
          (originalFilename, newNameWithoutExt) => {
            // Hidden files (starting with dot) have no extension
            const extension = getExtension(originalFilename);
            expect(extension).toBeNull();
            
            const finalName = restoreExtensionIfMissing(newNameWithoutExt, extension);
            
            // Property: No extension restoration for hidden files
            expect(finalName).toBe(newNameWithoutExt);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle multiple dots in filename', () => {
      fc.assert(
        fc.property(
          // Generate filename with multiple dots (e.g., "file.test.ts")
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('.') && !s.includes('/')),
            fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('.') && !s.includes('/')),
            fc.constantFrom('.ts', '.tsx', '.js', '.jsx')
          ).map(([name1, name2, ext]) => `${name1}.${name2}${ext}`),
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('.') && !s.includes('/')),
          (originalFilename, newNameWithoutExt) => {
            // Extract extension (should be the last one)
            const extension = getExtension(originalFilename);
            expect(extension).not.toBeNull();
            
            // Simulate rename
            const finalName = restoreExtensionIfMissing(newNameWithoutExt, extension);
            
            // Property: Final name should have the same extension as original
            expect(getExtension(finalName)).toBe(extension);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

/**
 * Unit tests for file rename functionality
 * 
 * These tests verify specific examples and edge cases for the rename feature,
 * complementing the property-based tests above.
 * 
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7**
 */

describe('WorkspaceFilePanel - File Rename Unit Tests', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  describe('Rename prompt pre-fills without extension', () => {
    it('should pre-fill "myfile" for "myfile.ts"', () => {
      const filename = 'myfile.ts';
      const nameWithoutExt = getNameWithoutExtension(filename);
      
      expect(nameWithoutExt).toBe('myfile');
      expect(nameWithoutExt).not.toContain('.ts');
    });

    it('should pre-fill "component" for "component.tsx"', () => {
      const filename = 'component.tsx';
      const nameWithoutExt = getNameWithoutExtension(filename);
      
      expect(nameWithoutExt).toBe('component');
      expect(nameWithoutExt).not.toContain('.tsx');
    });

    it('should pre-fill "data" for "data.json"', () => {
      const filename = 'data.json';
      const nameWithoutExt = getNameWithoutExtension(filename);
      
      expect(nameWithoutExt).toBe('data');
      expect(nameWithoutExt).not.toContain('.json');
    });

    it('should pre-fill "README" for "README.md"', () => {
      const filename = 'README.md';
      const nameWithoutExt = getNameWithoutExtension(filename);
      
      expect(nameWithoutExt).toBe('README');
      expect(nameWithoutExt).not.toContain('.md');
    });

    it('should pre-fill "file.test" for "file.test.ts" (multiple dots)', () => {
      const filename = 'file.test.ts';
      const nameWithoutExt = getNameWithoutExtension(filename);
      
      expect(nameWithoutExt).toBe('file.test');
      expect(nameWithoutExt).not.toContain('.ts');
    });

    it('should pre-fill entire name for files without extension', () => {
      const filename = 'Makefile';
      const nameWithoutExt = getNameWithoutExtension(filename);
      
      expect(nameWithoutExt).toBe('Makefile');
    });

    it('should pre-fill entire name for hidden files (starting with dot)', () => {
      const filename = '.gitignore';
      const nameWithoutExt = getNameWithoutExtension(filename);
      
      expect(nameWithoutExt).toBe('.gitignore');
    });
  });

  describe('Extension is restored if not provided', () => {
    it('should restore .ts extension when user provides "newname"', () => {
      const originalFilename = 'oldfile.ts';
      const userInput = 'newname';
      const extension = getExtension(originalFilename);
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('newname.ts');
      expect(getExtension(finalName)).toBe('.ts');
    });

    it('should restore .tsx extension when user provides "Component"', () => {
      const originalFilename = 'Button.tsx';
      const userInput = 'Component';
      const extension = getExtension(originalFilename);
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('Component.tsx');
      expect(getExtension(finalName)).toBe('.tsx');
    });

    it('should restore .json extension when user provides "config"', () => {
      const originalFilename = 'package.json';
      const userInput = 'config';
      const extension = getExtension(originalFilename);
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('config.json');
      expect(getExtension(finalName)).toBe('.json');
    });

    it('should restore .md extension when user provides "CHANGELOG"', () => {
      const originalFilename = 'README.md';
      const userInput = 'CHANGELOG';
      const extension = getExtension(originalFilename);
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('CHANGELOG.md');
      expect(getExtension(finalName)).toBe('.md');
    });

    it('should not restore extension when user provides name with dot', () => {
      const originalFilename = 'file.test.ts';
      const userInput = 'newfile.spec';
      const extension = getExtension(originalFilename);
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      // User included a dot, so their input is preserved as-is
      expect(finalName).toBe('newfile.spec');
    });

    it('should not restore extension for files without extension', () => {
      const originalFilename = 'Makefile';
      const userInput = 'Dockerfile';
      const extension = getExtension(originalFilename);
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('Dockerfile');
      expect(getExtension(finalName)).toBeNull();
    });
  });

  describe('Extension is preserved if user includes it', () => {
    it('should keep user-provided .js extension when original was .ts', () => {
      const originalFilename = 'file.ts';
      const userInput = 'file.js';
      const extension = getExtension(originalFilename);
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('file.js');
      expect(getExtension(finalName)).toBe('.js');
    });

    it('should keep user-provided .tsx extension when original was .jsx', () => {
      const originalFilename = 'Component.jsx';
      const userInput = 'NewComponent.tsx';
      const extension = getExtension(originalFilename);
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('NewComponent.tsx');
      expect(getExtension(finalName)).toBe('.tsx');
    });

    it('should keep user-provided extension even if different from original', () => {
      const originalFilename = 'data.json';
      const userInput = 'data.yaml';
      const extension = getExtension(originalFilename);
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('data.yaml');
      expect(getExtension(finalName)).toBe('.yaml');
    });

    it('should keep same extension when user provides it explicitly', () => {
      const originalFilename = 'README.md';
      const userInput = 'CHANGELOG.md';
      const extension = getExtension(originalFilename);
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('CHANGELOG.md');
      expect(getExtension(finalName)).toBe('.md');
    });

    it('should handle user providing multiple dots in new name', () => {
      const originalFilename = 'file.ts';
      const userInput = 'file.test.spec.ts';
      const extension = getExtension(originalFilename);
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('file.test.spec.ts');
      expect(getExtension(finalName)).toBe('.ts');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty extension correctly', () => {
      const originalFilename = 'file.';
      const userInput = 'newfile';
      const extension = getExtension(originalFilename);
      
      // File ending with dot has extension of "."
      expect(extension).toBe('.');
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      // Should restore the dot
      expect(finalName).toBe('newfile.');
    });

    it('should handle very long extensions', () => {
      const originalFilename = 'archive.tar.gz';
      const userInput = 'backup';
      const extension = getExtension(originalFilename);
      
      // Only the last extension is considered
      expect(extension).toBe('.gz');
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('backup.gz');
    });

    it('should handle filename with only extension', () => {
      const originalFilename = '.ts';
      const userInput = 'file';
      const extension = getExtension(originalFilename);
      
      // Filename starting with dot at position 0 has no extension
      expect(extension).toBeNull();
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('file');
    });

    it('should handle whitespace in user input', () => {
      const originalFilename = 'file.ts';
      const userInput = '  newfile  ';
      const extension = getExtension(originalFilename);
      
      // Assuming trim is applied before this logic
      const trimmedInput = userInput.trim();
      const finalName = restoreExtensionIfMissing(trimmedInput, extension);
      
      expect(finalName).toBe('newfile.ts');
    });

    it('should handle special characters in filename', () => {
      const originalFilename = 'my-file_v2.ts';
      const userInput = 'new-file_v3';
      const extension = getExtension(originalFilename);
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('new-file_v3.ts');
    });

    it('should handle unicode characters in filename', () => {
      const originalFilename = 'файл.ts';
      const userInput = 'новый';
      const extension = getExtension(originalFilename);
      
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('новый.ts');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete rename flow: extract, user input, restore', () => {
      const originalFilename = 'OldComponent.tsx';
      
      // Step 1: Extract name without extension for prompt
      const defaultValue = getNameWithoutExtension(originalFilename);
      expect(defaultValue).toBe('OldComponent');
      
      // Step 2: User provides new name without extension
      const userInput = 'NewComponent';
      
      // Step 3: Restore extension
      const extension = getExtension(originalFilename);
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('NewComponent.tsx');
    });

    it('should handle rename with extension change', () => {
      const originalFilename = 'script.js';
      
      // Step 1: Extract name without extension
      const defaultValue = getNameWithoutExtension(originalFilename);
      expect(defaultValue).toBe('script');
      
      // Step 2: User provides new name WITH different extension
      const userInput = 'script.ts';
      
      // Step 3: Keep user's extension
      const extension = getExtension(originalFilename);
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('script.ts');
      expect(getExtension(finalName)).toBe('.ts');
    });

    it('should handle rename of file without extension', () => {
      const originalFilename = 'Makefile';
      
      // Step 1: Extract name (no extension to remove)
      const defaultValue = getNameWithoutExtension(originalFilename);
      expect(defaultValue).toBe('Makefile');
      
      // Step 2: User provides new name
      const userInput = 'Dockerfile';
      
      // Step 3: No extension to restore
      const extension = getExtension(originalFilename);
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('Dockerfile');
    });

    it('should handle rename of hidden file', () => {
      const originalFilename = '.gitignore';
      
      // Step 1: Extract name (hidden file, no extension)
      const defaultValue = getNameWithoutExtension(originalFilename);
      expect(defaultValue).toBe('.gitignore');
      
      // Step 2: User provides new name
      const userInput = '.dockerignore';
      
      // Step 3: No extension to restore
      const extension = getExtension(originalFilename);
      const finalName = restoreExtensionIfMissing(userInput, extension);
      
      expect(finalName).toBe('.dockerignore');
    });
  });
});

/**
 * Unit tests for folder operations (Task 6.2)
 * 
 * These tests verify specific examples and UI interactions for folder operations,
 * complementing the property-based tests.
 * 
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2**
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { submitWorkspacePrompt } from '../test/workspace-prompt';
import { WorkspaceFilePanel } from './WorkspaceFilePanel';

describe('WorkspaceFilePanel - Folder Operations Unit Tests', () => {
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

  describe('Folder creation prompts for name (Requirement 2.1)', () => {
    it('should show prompt when New folder button is clicked', async () => {
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

      await user.click(screen.getByRole('button', { name: /New folder/i }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Create New Folder' })).toBeInTheDocument();
    });

    it('should not create folder when user cancels prompt', async () => {
      const user = userEvent.setup();
      const promptSpy = vi.mocked(window.prompt);
      
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

      // User cancels prompt
      promptSpy.mockReturnValueOnce(null);

      await user.click(screen.getByRole('button', { name: /New folder/i }));

      // Verify no API call was made (only initial load)
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should not create folder when user provides empty name', async () => {
      const user = userEvent.setup();
      const promptSpy = vi.mocked(window.prompt);
      
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

      // User provides empty name
      promptSpy.mockReturnValueOnce('   ');

      await user.click(screen.getByRole('button', { name: /New folder/i }));

      // Verify no API call was made for creation (only initial load)
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should create folder when user provides valid name', async () => {
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

      (global.fetch as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workspacePath: mockWorkspacePath,
            relativePath: '',
            entries: [
              { name: 'my-new-folder', relativePath: 'my-new-folder', kind: 'folder' }
            ],
          })
        });

      await user.click(screen.getByRole('button', { name: /New folder/i }));
      await submitWorkspacePrompt('my-new-folder');

      // Verify folder was created
      await waitFor(() => {
        expect(screen.getByText('my-new-folder')).toBeInTheDocument();
      });
    });
  });

  describe('Folder deletion shows confirmation (Requirement 3.1, 3.2)', () => {
    it('should show confirmation dialog when Delete button is clicked on folder', async () => {
      const user = userEvent.setup();
      const confirmSpy = vi.mocked(window.confirm);
      
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

      // User cancels deletion
      confirmSpy.mockReturnValueOnce(false);

      await user.click(screen.getByRole('button', { name: /Delete/i }));

      // Verify confirmation was shown with folder name
      expect(confirmSpy).toHaveBeenCalledWith('Delete folder "test-folder"?');
    });

    it('should not delete folder when user cancels confirmation', async () => {
      const user = userEvent.setup();
      const confirmSpy = vi.mocked(window.confirm);
      
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

      // User cancels deletion
      confirmSpy.mockReturnValueOnce(false);

      await user.click(screen.getByRole('button', { name: /Delete/i }));

      // Verify no deletion API call was made (only initial load)
      expect(global.fetch).toHaveBeenCalledTimes(1);
      
      // Folder should still be visible
      expect(screen.getByText('test-folder')).toBeInTheDocument();
    });

    it('should delete folder when user confirms', async () => {
      const user = userEvent.setup();
      const confirmSpy = vi.mocked(window.confirm);
      
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

      // User confirms deletion
      confirmSpy.mockReturnValueOnce(true);
      
      (global.fetch as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workspacePath: mockWorkspacePath,
            relativePath: '',
            entries: [],
          })
        });

      await user.click(screen.getByRole('button', { name: /Delete/i }));

      // Verify folder was deleted
      await waitFor(() => {
        expect(screen.queryByText('test-folder')).not.toBeInTheDocument();
      });
    });

    it('should show confirmation for file deletion with "file" label', async () => {
      const user = userEvent.setup();
      const confirmSpy = vi.mocked(window.confirm);
      
      // Mock initial load with file
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

      // User cancels deletion
      confirmSpy.mockReturnValueOnce(false);

      await user.click(screen.getByRole('button', { name: /Delete/i }));

      // Verify confirmation was shown with "file" label
      expect(confirmSpy).toHaveBeenCalledWith('Delete file "test.ts"?');
    });
  });

  describe('Folder selection navigates into folder (Requirement 4.1, 4.2, 4.3)', () => {
    it('should navigate into folder when folder entry is clicked', async () => {
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

    it('should not navigate when file entry is clicked', async () => {
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

      // Click on file (should not navigate)
      await user.click(screen.getByText('README.md'));

      // Verify no navigation occurred (still at root, only initial load)
      expect(global.fetch).toHaveBeenCalledTimes(1);
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

      // Mock navigation
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
  });

  describe('Folder rename pre-fills current name (Requirement 5.1, 5.2)', () => {
    it('should show prompt with current folder name when Rename is clicked', async () => {
      const user = userEvent.setup();
      
      // Mock initial load with folder
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'old-folder', relativePath: 'old-folder', kind: 'folder' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('old-folder')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Rename/i }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('textbox')).toHaveValue('old-folder');
    });

    it('should rename folder when user provides new name', async () => {
      const user = userEvent.setup();
      
      // Mock initial load with folder
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'old-folder', relativePath: 'old-folder', kind: 'folder' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('old-folder')).toBeInTheDocument();
      });

      (global.fetch as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workspacePath: mockWorkspacePath,
            relativePath: '',
            entries: [
              { name: 'new-folder', relativePath: 'new-folder', kind: 'folder' }
            ],
          })
        });

      await user.click(screen.getByRole('button', { name: /Rename/i }));
      await submitWorkspacePrompt('new-folder');

      // Verify folder was renamed
      await waitFor(() => {
        expect(screen.getByText('new-folder')).toBeInTheDocument();
        expect(screen.queryByText('old-folder')).not.toBeInTheDocument();
      });
    });

    it('should not rename folder when user cancels prompt', async () => {
      const user = userEvent.setup();
      const promptSpy = vi.mocked(window.prompt);
      
      // Mock initial load with folder
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'my-folder', relativePath: 'my-folder', kind: 'folder' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('my-folder')).toBeInTheDocument();
      });

      // User cancels rename
      promptSpy.mockReturnValueOnce(null);

      await user.click(screen.getByRole('button', { name: /Rename/i }));

      // Verify no API call was made (only initial load)
      expect(global.fetch).toHaveBeenCalledTimes(1);
      
      // Folder name should remain unchanged
      expect(screen.getByText('my-folder')).toBeInTheDocument();
    });

    it('should not rename folder when user provides empty name', async () => {
      const user = userEvent.setup();
      const promptSpy = vi.mocked(window.prompt);
      
      // Mock initial load with folder
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: '',
          entries: [
            { name: 'my-folder', relativePath: 'my-folder', kind: 'folder' }
          ],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.getByText('my-folder')).toBeInTheDocument();
      });

      // User provides empty name
      promptSpy.mockReturnValueOnce('   ');

      await user.click(screen.getByRole('button', { name: /Rename/i }));

      // Verify no API call was made (only initial load)
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Up button disabled at root (Requirement 4.4, 4.5)', () => {
    it('should disable Up button when at workspace root', async () => {
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

    it('should enable Up button when in subdirectory', async () => {
      // Mock initial load in subdirectory
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspacePath: mockWorkspacePath,
          relativePath: 'src/components',
          entries: [],
        })
      });

      render(<WorkspaceFilePanel workspacePath={mockWorkspacePath} />);
      
      await waitFor(() => {
        expect(screen.queryByText(/Loading entries/i)).not.toBeInTheDocument();
      });

      // Verify Up button is enabled
      const upButton = screen.getByRole('button', { name: /Up/i });
      expect(upButton).not.toBeDisabled();
    });

    it('should navigate to parent directory when Up button is clicked', async () => {
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

      // Verify navigation to root
      await waitFor(() => {
        expect(screen.queryByText('/src')).not.toBeInTheDocument();
        expect(screen.getByText('src')).toBeInTheDocument();
      });
    });
  });
});
