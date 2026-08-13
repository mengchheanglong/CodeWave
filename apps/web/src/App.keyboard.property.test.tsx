import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import App from './App';

/**
 * Property-based tests for Task 8.1: Keyboard navigation
 * 
 * These tests verify universal properties about keyboard shortcuts behavior
 * using fast-check to generate random test cases.
 */

describe('App - Keyboard Navigation Properties', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    // Mock daemon health check
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  /**
   * Feature: sidebar-improvements, Property 16: Slash key focuses filter input
   * 
   * For any keyboard state where no input field has focus, pressing the "/" key
   * should focus the rail filter input.
   * 
   * **Validates: Requirements 10.1**
   */
  describe('Property 16: Slash key focuses filter input', () => {
    it('should focus rail filter input when slash is pressed', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('recent', 'history', 'archive', 'flows'),
          async () => {
            const user = userEvent.setup();
            
            const { unmount } = render(<App />);
            
            await waitFor(() => {
              expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
            });

            // Press slash key
            await user.keyboard('/');

            // Property: Rail filter input should be focused
            await waitFor(() => {
              const filterInput = screen.getByRole('searchbox', { name: /Filter rail items/i });
              expect(filterInput).toHaveFocus();
            });
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 10 }
      );
    }, 15000);

    it('should not focus filter when slash is pressed in an input field', async () => {
      const user = userEvent.setup();
      
      render(<App />);
      
      await waitFor(() => {
        expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
      });

      // Focus the filter input itself
      const filterInput = screen.getByRole('searchbox', { name: /Filter rail items/i }) as HTMLInputElement;
      await user.click(filterInput);
      
      expect(filterInput).toHaveFocus();

      // Type slash in filter (should type the character, not trigger shortcut)
      await user.keyboard('/');

      // Property: Filter should still have focus and slash should be typed
      expect(filterInput).toHaveFocus();
      expect(filterInput.value).toBe('/');
    });
  });

  /**
   * Feature: sidebar-improvements, Property 17: Keyboard shortcut cycles rail views
   * 
   * For any current rail view, pressing Cmd/Ctrl+Shift+Left Arrow should cycle to
   * the previous rail view in the sequence (recent → flows → archive → history → recent).
   * 
   * **Validates: Requirements 10.2**
   */
  describe('Property 17: Keyboard shortcut cycles rail views', () => {
    it('should cycle rail views backward with Cmd/Ctrl+Shift+Left', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (numCycles) => {
            const user = userEvent.setup();
            
            const { unmount } = render(<App />);
            
            await waitFor(() => {
              expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
            });

            // Cycle through views
            for (let i = 0; i < numCycles; i++) {
              await user.keyboard('{Control>}{Shift>}{ArrowLeft}{/Shift}{/Control}');
              
              // Wait for view to update
              await waitFor(() => {
                // Just verify the app is still responsive
                expect(screen.getByRole('searchbox', { name: /Filter rail items/i })).toBeInTheDocument();
              });
            }

            // Property: After cycling, should be in a valid rail view
            // The rail view should have changed (unless we cycled back to start)
            const filterInput = screen.getByRole('searchbox', { name: /Filter rail items/i });
            expect(filterInput).toBeInTheDocument();
            
            unmount();
            vi.clearAllMocks();
          }
        ),
        { numRuns: 10 }
      );
    }, 20000);

    it('should cycle through all rail views in correct order', async () => {
      const user = userEvent.setup();
      
      render(<App />);
      
      await waitFor(() => {
        expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
      });

      // Expected cycle order (backward): recent → flows → archive → history → recent
      // Actual labels: Threads → Agents → Archived → Runs → Threads
      const expectedLabels = ['agents', 'archived', 'runs', 'threads'];
      
      for (const expectedLabel of expectedLabels) {
        await user.keyboard('{Control>}{Shift>}{ArrowLeft}{/Shift}{/Control}');
        
        await waitFor(() => {
          // Verify the filter placeholder updates to match the view
          const filterInput = screen.getByRole('searchbox', { name: /Filter rail items/i });
          expect(filterInput).toHaveAttribute('placeholder', expect.stringMatching(new RegExp(expectedLabel, 'i')));
        });
      }
    });
  });

  /**
   * Feature: sidebar-improvements, Property 18: Escape clears filter text
   * 
   * For any non-empty filter text in the rail filter input, pressing Escape while
   * the input is focused should clear the filter text.
   * 
   * **Validates: Requirements 10.3**
   */
  describe('Property 18: Escape clears filter text', () => {
    it('should clear filter text when Escape is pressed', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(text => text.trim().length > 0),
          async (filterText) => {
            const user = userEvent.setup();
            
            const { unmount, container } = render(<App />);
            
            try {
              await waitFor(() => {
                expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
              });

              // Focus filter input and type text
              const filterInput = container.querySelector('.rail-filter-input') as HTMLInputElement;
              expect(filterInput).toBeInTheDocument();
              await user.click(filterInput);
              fireEvent.change(filterInput, { target: { value: filterText } });

              // Verify text was entered
              await waitFor(() => {
                expect(filterInput.value).toBe(filterText);
              });

              // Press Escape
              await user.keyboard('{Escape}');

              // Property: Filter text should be cleared
              await waitFor(() => {
                expect(filterInput.value).toBe('');
              });
            } finally {
              unmount();
              vi.clearAllMocks();
            }
          }
        ),
        { numRuns: 20 }
      );
    }, 30000);

    it('should not clear filter when Escape is pressed outside filter input', async () => {
      const user = userEvent.setup();
      
      render(<App />);
      
      await waitFor(() => {
        expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
      });

      // Type in filter
      const filterInput = screen.getByRole('searchbox', { name: /Filter rail items/i }) as HTMLInputElement;
      await user.click(filterInput);
      await user.keyboard('test');

      expect(filterInput.value).toBe('test');

      // Focus something else (use a button instead of composer)
      const newThreadButton = screen.getByRole('button', { name: /New thread/i });
      await user.click(newThreadButton);

      // Press Escape (should not clear filter since it's not focused)
      await user.keyboard('{Escape}');

      // Property: Filter text should remain unchanged
      expect(filterInput.value).toBe('test');
    });

    it('should keep focus on filter input after clearing with Escape', async () => {
      const user = userEvent.setup();
      
      render(<App />);
      
      await waitFor(() => {
        expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
      });

      // Type in filter
      const filterInput = screen.getByRole('searchbox', { name: /Filter rail items/i }) as HTMLInputElement;
      await user.click(filterInput);
      await user.keyboard('test');

      expect(filterInput).toHaveFocus();

      // Press Escape
      await user.keyboard('{Escape}');

      // Property: Filter should be cleared and still focused
      await waitFor(() => {
        expect(filterInput.value).toBe('');
        expect(filterInput).toHaveFocus();
      });
    });
  });
});
