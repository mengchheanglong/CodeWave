import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from './use-keyboard-shortcuts';
import * as appController from '../app-controller';
import type { ShellControlsState } from './shell-controls-state';
import type { ShellPanelsState } from './shell-panels-state';

describe('useKeyboardShortcuts Hook Tests', () => {
  const defaultControls: ShellControlsState = {
    providerId: 'gemini',
    sessionApprovalPolicy: 'prompt',
    selectedSessionApprovalPolicy: 'prompt',
    steerPrompt: '',
    startRunDisabled: false,
    cancelRunDisabled: true,
  };

  const defaultPanels: ShellPanelsState = {
    selectedSessionId: 'session-1',
    selectedProviderId: 'gemini',
    recentSessions: [],
    archivedSessions: [],
    tools: [],
    artifacts: [],
    checkpoints: [],
    approvals: [
      {
        id: 'approval-1',
        runId: 'run-1',
        toolName: 'execute_command',
        status: 'requested',
        createdAt: '2026-08-17T00:00:00.000Z',
      },
      {
        id: 'approval-2',
        runId: 'run-1',
        toolName: 'write_file',
        status: 'requested',
        createdAt: '2026-08-17T00:01:00.000Z',
      },
    ],
  };

  it('triggers QuickOpen toggle on Cmd/Ctrl+K', () => {
    const setQuickOpen = vi.fn();
    const filterInput = { current: document.createElement('input') };

    renderHook(() =>
      useKeyboardShortcuts({
        railFilterInputRef: filterInput,
        setQuickOpenVisible: setQuickOpen,
        setFocusView: vi.fn(),
        setUtilityCollapsed: vi.fn(),
        setRailView: vi.fn(),
        setRunViewTab: vi.fn(),
        setUtilityView: vi.fn(),
        setShowThinking: vi.fn(),
        focusComposer: vi.fn(),
        hasActiveSession: true,
        shellControlsState: defaultControls,
        shellPanelsState: defaultPanels,
        onPolicyChange: vi.fn(),
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    );

    expect(setQuickOpen).toHaveBeenCalledTimes(1);
  });

  it('toggles right utility rail on Cmd/Ctrl+\\', () => {
    const setUtilityCollapsed = vi.fn();
    const filterInput = { current: document.createElement('input') };

    renderHook(() =>
      useKeyboardShortcuts({
        railFilterInputRef: filterInput,
        setQuickOpenVisible: vi.fn(),
        setFocusView: vi.fn(),
        setUtilityCollapsed,
        setRailView: vi.fn(),
        setRunViewTab: vi.fn(),
        setUtilityView: vi.fn(),
        setShowThinking: vi.fn(),
        focusComposer: vi.fn(),
        hasActiveSession: true,
        shellControlsState: defaultControls,
        shellPanelsState: defaultPanels,
        onPolicyChange: vi.fn(),
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '\\', ctrlKey: true, bubbles: true }),
    );

    expect(setUtilityCollapsed).toHaveBeenCalledTimes(1);
  });

  it('approves first requested approval on Shift+A', () => {
    const filterInput = { current: document.createElement('input') };
    const approvalSpy = vi
      .spyOn(appController, 'requestApprovalResolution')
      .mockImplementation(vi.fn());

    renderHook(() =>
      useKeyboardShortcuts({
        railFilterInputRef: filterInput,
        setQuickOpenVisible: vi.fn(),
        setFocusView: vi.fn(),
        setUtilityCollapsed: vi.fn(),
        setRailView: vi.fn(),
        setRunViewTab: vi.fn(),
        setUtilityView: vi.fn(),
        setShowThinking: vi.fn(),
        focusComposer: vi.fn(),
        hasActiveSession: true,
        shellControlsState: defaultControls,
        shellPanelsState: defaultPanels,
        onPolicyChange: vi.fn(),
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'A', shiftKey: true, bubbles: true }),
    );

    expect(approvalSpy).toHaveBeenCalledWith('approval-1', 'approved');
    approvalSpy.mockRestore();
  });

  it('denies first requested approval on Shift+D', () => {
    const filterInput = { current: document.createElement('input') };
    const approvalSpy = vi
      .spyOn(appController, 'requestApprovalResolution')
      .mockImplementation(vi.fn());

    renderHook(() =>
      useKeyboardShortcuts({
        railFilterInputRef: filterInput,
        setQuickOpenVisible: vi.fn(),
        setFocusView: vi.fn(),
        setUtilityCollapsed: vi.fn(),
        setRailView: vi.fn(),
        setRunViewTab: vi.fn(),
        setUtilityView: vi.fn(),
        setShowThinking: vi.fn(),
        focusComposer: vi.fn(),
        hasActiveSession: true,
        shellControlsState: defaultControls,
        shellPanelsState: defaultPanels,
        onPolicyChange: vi.fn(),
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'D', shiftKey: true, bubbles: true }),
    );

    expect(approvalSpy).toHaveBeenCalledWith('approval-1', 'denied');
    approvalSpy.mockRestore();
  });

  it('approves all requested approvals on Shift+Enter', () => {
    const filterInput = { current: document.createElement('input') };
    const approvalSpy = vi
      .spyOn(appController, 'requestApprovalResolution')
      .mockImplementation(vi.fn());

    renderHook(() =>
      useKeyboardShortcuts({
        railFilterInputRef: filterInput,
        setQuickOpenVisible: vi.fn(),
        setFocusView: vi.fn(),
        setUtilityCollapsed: vi.fn(),
        setRailView: vi.fn(),
        setRunViewTab: vi.fn(),
        setUtilityView: vi.fn(),
        setShowThinking: vi.fn(),
        focusComposer: vi.fn(),
        hasActiveSession: true,
        shellControlsState: defaultControls,
        shellPanelsState: defaultPanels,
        onPolicyChange: vi.fn(),
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
    );

    expect(approvalSpy).toHaveBeenCalledTimes(2);
    expect(approvalSpy).toHaveBeenNthCalledWith(1, 'approval-1', 'approved');
    expect(approvalSpy).toHaveBeenNthCalledWith(2, 'approval-2', 'approved');
    approvalSpy.mockRestore();
  });

  it('cycles approval policy on Ctrl+Space', () => {
    const filterInput = { current: document.createElement('input') };
    const onPolicyChange = vi.fn();

    renderHook(() =>
      useKeyboardShortcuts({
        railFilterInputRef: filterInput,
        setQuickOpenVisible: vi.fn(),
        setFocusView: vi.fn(),
        setUtilityCollapsed: vi.fn(),
        setRailView: vi.fn(),
        setRunViewTab: vi.fn(),
        setUtilityView: vi.fn(),
        setShowThinking: vi.fn(),
        focusComposer: vi.fn(),
        hasActiveSession: true,
        shellControlsState: { ...defaultControls, selectedSessionApprovalPolicy: 'manual' as ApprovalPolicy },
        shellPanelsState: defaultPanels,
        onPolicyChange,
      }),
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true }),
    );

    expect(onPolicyChange).toHaveBeenCalledWith('allow');
  });
});
