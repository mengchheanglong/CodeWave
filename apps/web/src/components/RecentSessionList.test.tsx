import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecentSessionList } from './RecentSessionList';
import type { ShellPanelsState } from '../lib/shell-panels-state';

describe('RecentSessionList - Context Menu Behavior', () => {
  const mockSessions: ShellPanelsState['recentSessions'] = [
    {
      id: 'session-1',
      providerId: 'freebuff',
      workspacePath: '/workspace/project-a',
      approvalPolicy: 'manual',
      providerSessionId: null,
      latestRunPrompt: 'Test prompt 1',
      recovery: null,
      orchestration: null,
    },
    {
      id: 'session-2',
      providerId: 'opencode',
      workspacePath: '/workspace/project-a',
      approvalPolicy: 'manual',
      providerSessionId: null,
      latestRunPrompt: 'Test prompt 2',
      recovery: null,
      orchestration: null,
    },
    {
      id: 'session-3',
      providerId: 'freebuff',
      workspacePath: '/workspace/project-b',
      approvalPolicy: 'manual',
      providerSessionId: null,
      latestRunPrompt: 'Test prompt 3',
      recovery: null,
      orchestration: null,
    },
  ];

  const defaultProps = {
    sessions: mockSessions,
    selectedSessionId: null,
    emptyMessage: 'No sessions',
    onSelectSession: vi.fn(),
    onDeleteWorkspaceGroup: vi.fn(),
    onDeleteSession: vi.fn(),
  };

  describe('Click-outside closes context menus', () => {
    it('should close session context menu when clicking outside', () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open session context menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      // Verify menu is open
      const sessionMenu = container.querySelector('.session-item-menu-shell.open');
      expect(sessionMenu).toBeInTheDocument();

      // Click outside the menu
      fireEvent.pointerDown(document.body);

      // Verify menu is closed
      const closedMenu = container.querySelector('.session-item-menu-shell.open');
      expect(closedMenu).not.toBeInTheDocument();
    });

    it('should close folder context menu when clicking outside', () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open folder context menu
      const folderMenuTriggers = screen.getAllByLabelText(/Folder menu for/);
      fireEvent.click(folderMenuTriggers[0]);

      // Verify menu is open
      const folderMenu = container.querySelector('.project-item-menu-shell.open');
      expect(folderMenu).toBeInTheDocument();

      // Click outside the menu
      fireEvent.pointerDown(document.body);

      // Verify menu is closed
      const closedMenu = container.querySelector('.project-item-menu-shell.open');
      expect(closedMenu).not.toBeInTheDocument();
    });

    it('should not close menu when clicking inside the menu', () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open session context menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      // Click inside the menu shell
      const menuShell = container.querySelector('.session-item-menu-shell.open');
      expect(menuShell).toBeInTheDocument();
      fireEvent.pointerDown(menuShell!);

      // Verify menu is still open
      const stillOpenMenu = container.querySelector('.session-item-menu-shell.open');
      expect(stillOpenMenu).toBeInTheDocument();
    });
  });

  describe('Escape key closes context menus', () => {
    it('should close session context menu when pressing Escape', () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open session context menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      // Verify menu is open
      const sessionMenu = container.querySelector('.session-item-menu-shell.open');
      expect(sessionMenu).toBeInTheDocument();

      // Press Escape key
      fireEvent.keyDown(window, { key: 'Escape' });

      // Verify menu is closed
      const closedMenu = container.querySelector('.session-item-menu-shell.open');
      expect(closedMenu).not.toBeInTheDocument();
    });

    it('should close folder context menu when pressing Escape', () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open folder context menu
      const folderMenuTriggers = screen.getAllByLabelText(/Folder menu for/);
      fireEvent.click(folderMenuTriggers[0]);

      // Verify menu is open
      const folderMenu = container.querySelector('.project-item-menu-shell.open');
      expect(folderMenu).toBeInTheDocument();

      // Press Escape key
      fireEvent.keyDown(window, { key: 'Escape' });

      // Verify menu is closed
      const closedMenu = container.querySelector('.project-item-menu-shell.open');
      expect(closedMenu).not.toBeInTheDocument();
    });

    it('should not close menu when pressing other keys', () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open session context menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      // Press a different key
      fireEvent.keyDown(window, { key: 'Enter' });

      // Verify menu is still open
      const stillOpenMenu = container.querySelector('.session-item-menu-shell.open');
      expect(stillOpenMenu).toBeInTheDocument();
    });
  });

  describe('Opening one menu closes other menus', () => {
    it('should close previous session menu when opening another session menu', () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open first session context menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      // Verify first menu is open
      let openMenus = container.querySelectorAll('.session-item-menu-shell.open');
      expect(openMenus).toHaveLength(1);

      // Open second session context menu
      fireEvent.click(sessionMenuTriggers[1]);

      // Verify only second menu is open
      openMenus = container.querySelectorAll('.session-item-menu-shell.open');
      expect(openMenus).toHaveLength(1);
    });

    it('should close session menu when opening folder menu', () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open session context menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      // Verify session menu is open
      let sessionMenu = container.querySelector('.session-item-menu-shell.open');
      expect(sessionMenu).toBeInTheDocument();

      // Open folder context menu
      const folderMenuTriggers = screen.getAllByLabelText(/Folder menu for/);
      fireEvent.click(folderMenuTriggers[0]);

      // Verify session menu is closed and folder menu is open
      sessionMenu = container.querySelector('.session-item-menu-shell.open');
      expect(sessionMenu).not.toBeInTheDocument();

      const folderMenu = container.querySelector('.project-item-menu-shell.open');
      expect(folderMenu).toBeInTheDocument();
    });

    it('should close folder menu when opening session menu', () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open folder context menu
      const folderMenuTriggers = screen.getAllByLabelText(/Folder menu for/);
      fireEvent.click(folderMenuTriggers[0]);

      // Verify folder menu is open
      let folderMenu = container.querySelector('.project-item-menu-shell.open');
      expect(folderMenu).toBeInTheDocument();

      // Open session context menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      // Verify folder menu is closed and session menu is open
      folderMenu = container.querySelector('.project-item-menu-shell.open');
      expect(folderMenu).not.toBeInTheDocument();

      const sessionMenu = container.querySelector('.session-item-menu-shell.open');
      expect(sessionMenu).toBeInTheDocument();
    });

    it('should close previous folder menu when opening another folder menu', () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open first folder context menu
      const folderMenuTriggers = screen.getAllByLabelText(/Folder menu for/);
      fireEvent.click(folderMenuTriggers[0]);

      // Verify first menu is open
      let openMenus = container.querySelectorAll('.project-item-menu-shell.open');
      expect(openMenus).toHaveLength(1);

      // Open second folder context menu
      fireEvent.click(folderMenuTriggers[1]);

      // Verify only second menu is open
      openMenus = container.querySelectorAll('.project-item-menu-shell.open');
      expect(openMenus).toHaveLength(1);
    });
  });

  describe('Menu toggle behavior', () => {
    it('should toggle session menu when clicking trigger twice', () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open session context menu
      const sessionMenuTriggers = screen.getAllByLabelText(/Thread menu for/);
      fireEvent.click(sessionMenuTriggers[0]);

      // Verify menu is open
      let sessionMenu = container.querySelector('.session-item-menu-shell.open');
      expect(sessionMenu).toBeInTheDocument();

      // Click trigger again to close
      fireEvent.click(sessionMenuTriggers[0]);

      // Verify menu is closed
      sessionMenu = container.querySelector('.session-item-menu-shell.open');
      expect(sessionMenu).not.toBeInTheDocument();
    });

    it('should toggle folder menu when clicking trigger twice', () => {
      const { container } = render(<RecentSessionList {...defaultProps} />);

      // Open folder context menu
      const folderMenuTriggers = screen.getAllByLabelText(/Folder menu for/);
      fireEvent.click(folderMenuTriggers[0]);

      // Verify menu is open
      let folderMenu = container.querySelector('.project-item-menu-shell.open');
      expect(folderMenu).toBeInTheDocument();

      // Click trigger again to close
      fireEvent.click(folderMenuTriggers[0]);

      // Verify menu is closed
      folderMenu = container.querySelector('.project-item-menu-shell.open');
      expect(folderMenu).not.toBeInTheDocument();
    });
  });
});
