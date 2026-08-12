import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import fc from 'fast-check';
import { RecentSessionList } from './RecentSessionList';
import type { ShellPanelsState } from '../lib/shell-panels-state';

/**
 * Property-based tests for Task 9.1: Context menu interactions
 * 
 * These tests verify universal properties about context menu behavior
 * using fast-check to generate random test cases.
 */

describe('RecentSessionList - Context Menu Properties', () => {
  const mockSessions: ShellPanelsState['recentSessions'] = [
    {
      id: 'session-1',
      workspacePath: '/workspace/project-a',
      providerId: 'freebuff',
      approvalPolicy: 'manual',
      providerSessionId: null,
      latestRunPrompt: 'Session 1',
      recovery: null,
      orchestration: null,
    },
    {
      id: 'session-2',
      workspacePath: '/workspace/project-a',
      providerId: 'opencode',
      approvalPolicy: 'manual',
      providerSessionId: null,
      latestRunPrompt: 'Session 2',
      recovery: null,
      orchestration: null,
    },
    {
      id: 'session-3',
      workspacePath: '/workspace/project-b',
      providerId: 'freebuff',
      approvalPolicy: 'manual',
      providerSessionId: null,
      latestRunPrompt: 'Session 3',
      recovery: null,
      orchestration: null,
    },
  ];

  const defaultProps = {
    sessions: mockSessions,
    selectedSessionId: null,
    emptyMessage: 'No sessions',
    onSelectSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onDeleteWorkspaceGroup: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Feature: sidebar-improvements, Property 13: Context menu exclusivity
   * 
   * For any context menu (session or folder group), opening a different context menu
   * should close the previously open menu, ensuring only one menu is open at any time.
   * 
   * **Validates: Requirements 8.3, 8.4**
   */
  describe('Property 13: Context menu exclusivity', () => {
    it('should ensure only one context menu is open at a time', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom([0, 1] as const, [1, 0] as const),
          async ([firstMenuIndex, secondMenuIndex]) => {
            const { container, unmount } = render(<RecentSessionList {...defaultProps} />);

            try {
              // Get all menu triggers
              const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
              const folderMenuTriggers = screen.getAllByLabelText(/Folder menu for/);

              // Open first menu (either session or folder)
              const firstTrigger = firstMenuIndex === 0 ? sessionMenuTriggers[0] : folderMenuTriggers[0];
              fireEvent.click(firstTrigger);

              // Verify first menu is open
              await waitFor(() => {
                const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
                expect(openMenus.length).toBe(1);
              });

              // Open second menu (either session or folder)
              const secondTrigger = secondMenuIndex === 0 ? sessionMenuTriggers[0] : folderMenuTriggers[0];
              fireEvent.click(secondTrigger);

              // Property: Only one menu should be open
              await waitFor(() => {
                const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
                expect(openMenus.length).toBe(1);
              });
            } finally {
              unmount();
            }
          }
        ),
        { numRuns: 10 }
      );
    }, 15000);

    it('should close previous session menu when opening another session menu', async () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open first session menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      await waitFor(() => {
        const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
        expect(openMenus.length).toBe(1);
      });

      // Open second session menu
      fireEvent.click(sessionMenuTriggers[1]);

      // Property: Only one menu should be open
      await waitFor(() => {
        const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
        expect(openMenus.length).toBe(1);
      });
    });

    it('should close session menu when opening folder menu', async () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open session menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      await waitFor(() => {
        const sessionMenu = container.querySelector('.session-item-menu-popover:not([hidden])');
        expect(sessionMenu).toBeInTheDocument();
      });

      // Open folder menu
      const folderMenuTriggers = screen.getAllByLabelText(/Folder menu for/);
      fireEvent.click(folderMenuTriggers[0]);

      // Property: Only folder menu should be open
      await waitFor(() => {
        const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
        expect(openMenus.length).toBe(1);
      });
    });
  });

  /**
   * Feature: sidebar-improvements, Property 14: Click-outside closes context menus
   * 
   * For any open context menu (session or folder group), clicking outside the menu
   * should close it.
   * 
   * **Validates: Requirements 8.1, 8.2**
   */
  describe('Property 14: Click-outside closes context menus', () => {
    it('should close any open menu when clicking outside', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('session', 'folder'),
          async (menuType) => {
            const { container, unmount } = render(<RecentSessionList {...defaultProps} />);

            try {
              // Open menu based on type
              if (menuType === 'session') {
                const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
                fireEvent.click(sessionMenuTriggers[0]);
              } else {
                const folderMenuTriggers = screen.getAllByLabelText(/Folder menu for/);
                fireEvent.click(folderMenuTriggers[0]);
              }

              // Verify menu is open
              await waitFor(() => {
                const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
                expect(openMenus.length).toBe(1);
              });

              // Click outside the menu
              fireEvent.pointerDown(document.body);

              // Property: Menu should be closed
              await waitFor(() => {
                const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
                expect(openMenus.length).toBe(0);
              });
            } finally {
              unmount();
            }
          }
        ),
        { numRuns: 10 }
      );
    }, 15000);

    it('should close session menu when clicking outside', async () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open session menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      await waitFor(() => {
        const sessionMenu = container.querySelector('.session-item-menu-popover:not([hidden])');
        expect(sessionMenu).toBeInTheDocument();
      });

      // Click outside
      fireEvent.pointerDown(document.body);

      // Property: Menu should be closed
      await waitFor(() => {
        const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
        expect(openMenus.length).toBe(0);
      });
    });

    it('should close folder menu when clicking outside', async () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open folder menu
      const folderMenuTriggers = screen.getAllByLabelText(/Folder menu for/);
      fireEvent.click(folderMenuTriggers[0]);

      await waitFor(() => {
        const folderMenu = container.querySelector('.project-item-menu-popover:not([hidden])');
        expect(folderMenu).toBeInTheDocument();
      });

      // Click outside
      fireEvent.pointerDown(document.body);

      // Property: Menu should be closed
      await waitFor(() => {
        const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
        expect(openMenus.length).toBe(0);
      });
    });

    it('should not close menu when clicking inside the menu', async () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open session menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      await waitFor(() => {
        const sessionMenu = container.querySelector('.session-item-menu-popover:not([hidden])');
        expect(sessionMenu).toBeInTheDocument();
      });

      // Click inside the menu
      const menu = container.querySelector('.session-item-menu-popover:not([hidden])');
      if (menu) {
        fireEvent.pointerDown(menu);
      }

      // Property: Menu should still be open
      const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
      expect(openMenus.length).toBe(1);
    });
  });

  /**
   * Feature: sidebar-improvements, Property 15: Escape key closes context menus
   * 
   * For any open context menu, pressing the Escape key should close the menu.
   * 
   * **Validates: Requirements 8.5**
   */
  describe('Property 15: Escape key closes context menus', () => {
    it('should close any open menu when Escape is pressed', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('session', 'folder'),
          async (menuType) => {
            const { container, unmount } = render(<RecentSessionList {...defaultProps} />);

            try {
              // Open menu based on type
              if (menuType === 'session') {
                const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
                fireEvent.click(sessionMenuTriggers[0]);
              } else {
                const folderMenuTriggers = screen.getAllByLabelText(/Folder menu for/);
                fireEvent.click(folderMenuTriggers[0]);
              }

              // Verify menu is open
              await waitFor(() => {
                const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
                expect(openMenus.length).toBe(1);
              });

              // Press Escape
              fireEvent.keyDown(window, { key: 'Escape' });

              // Property: Menu should be closed
              await waitFor(() => {
                const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
                expect(openMenus.length).toBe(0);
              });
            } finally {
              unmount();
            }
          }
        ),
        { numRuns: 10 }
      );
    }, 15000);

    it('should close session menu when Escape is pressed', async () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open session menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      await waitFor(() => {
        const sessionMenu = container.querySelector('.session-item-menu-popover:not([hidden])');
        expect(sessionMenu).toBeInTheDocument();
      });

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' });

      // Property: Menu should be closed
      await waitFor(() => {
        const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
        expect(openMenus.length).toBe(0);
      });
    });

    it('should close folder menu when Escape is pressed', async () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open folder menu
      const folderMenuTriggers = screen.getAllByLabelText(/Folder menu for/);
      fireEvent.click(folderMenuTriggers[0]);

      await waitFor(() => {
        const folderMenu = container.querySelector('.project-item-menu-popover:not([hidden])');
        expect(folderMenu).toBeInTheDocument();
      });

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' });

      // Property: Menu should be closed
      await waitFor(() => {
        const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
        expect(openMenus.length).toBe(0);
      });
    });

    it('should not close menu when pressing other keys', async () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open session menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      await waitFor(() => {
        const sessionMenu = container.querySelector('.session-item-menu-popover:not([hidden])');
        expect(sessionMenu).toBeInTheDocument();
      });

      // Press other keys
      fireEvent.keyDown(window, { key: 'Enter' });
      fireEvent.keyDown(window, { key: 'Space' });
      fireEvent.keyDown(window, { key: 'Tab' });

      // Property: Menu should still be open
      const openMenus = container.querySelectorAll('.session-item-menu-popover:not([hidden]), .project-item-menu-popover:not([hidden])');
      expect(openMenus.length).toBe(1);
    });
  });
});
