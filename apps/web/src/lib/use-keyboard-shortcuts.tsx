import { useEffect, type RefObject } from 'react';
import type { ApprovalPolicy } from '@codewave/protocol';
import type { ShellControlsState } from './shell-controls-state';
import type { ShellPanelsState } from './shell-panels-state';
import type { RailView, RunViewTab, UtilityView } from './shell-format';
import { requestApprovalResolution } from '../app-controller';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  );
}

function cycleValue<T extends string>(
  values: readonly T[],
  current: T,
  direction: 1 | -1,
): T {
  const currentIndex = values.indexOf(current);
  if (currentIndex === -1) {
    return values[0];
  }
  const nextIndex = (currentIndex + direction + values.length) % values.length;
  return values[nextIndex];
}

const RAIL_VIEW_ORDER: readonly RailView[] = ['recent', 'history', 'archive', 'flows'];
const RUN_VIEW_ORDER: readonly RunViewTab[] = ['chat', 'timeline'];
const UTILITY_VIEW_ORDER: readonly UtilityView[] = [
  'approvals',
  'tools',
  'files',
  'changes',
  'artifacts',
  'checkpoints',
];

type UseKeyboardShortcutsOptions = {
  railFilterInputRef: RefObject<HTMLInputElement | null>;
  setQuickOpenVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setFocusView: React.Dispatch<React.SetStateAction<boolean>>;
  setUtilityCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setRailView: React.Dispatch<React.SetStateAction<RailView>>;
  setRunViewTab: React.Dispatch<React.SetStateAction<RunViewTab>>;
  setUtilityView: React.Dispatch<React.SetStateAction<UtilityView>>;
  setShowThinking: React.Dispatch<React.SetStateAction<boolean>>;
  focusComposer: () => void;
  hasActiveSession: boolean;
  shellControlsState: ShellControlsState;
  shellPanelsState: ShellPanelsState;
  onPolicyChange: (policy: ApprovalPolicy) => void;
};

export function useKeyboardShortcuts({
  railFilterInputRef,
  setQuickOpenVisible,
  setFocusView,
  setUtilityCollapsed,
  setRailView,
  setRunViewTab,
  setUtilityView,
  setShowThinking,
  focusComposer,
  hasActiveSession,
  shellControlsState,
  shellPanelsState,
  onPolicyChange,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isMetaKey = event.metaKey || event.ctrlKey;

      if (
        !isMetaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key === '/' &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        railFilterInputRef.current?.focus();
        railFilterInputRef.current?.select();
        return;
      }

      if (isMetaKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuickOpenVisible((current) => !current);
        return;
      }

      if (isMetaKey && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFocusView((current) => !current);
        return;
      }

      if (isMetaKey && event.shiftKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        focusComposer();
        return;
      }

      if (isMetaKey && event.key === '\\') {
        event.preventDefault();
        setUtilityCollapsed((current) => !current);
        return;
      }

      if (isMetaKey && event.shiftKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        setRailView((current) => cycleValue(RAIL_VIEW_ORDER, current, -1));
        return;
      }

      if (isMetaKey && event.shiftKey && event.key === 'ArrowUp') {
        event.preventDefault();
        setRunViewTab((current) => cycleValue(RUN_VIEW_ORDER, current, -1));
        return;
      }

      if (isMetaKey && event.shiftKey && event.key === 'ArrowRight') {
        event.preventDefault();
        setUtilityCollapsed(false);
        setUtilityView((current) => cycleValue(UTILITY_VIEW_ORDER, current, 1));
        return;
      }

      if (event.key === 'Escape') {
        setQuickOpenVisible(false);
      }

      if (
        isMetaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key === ' '
      ) {
        event.preventDefault();
        const order: ApprovalPolicy[] = ['manual', 'allow', 'deny'];
        const current = hasActiveSession
          ? shellControlsState.selectedSessionApprovalPolicy
          : shellControlsState.sessionApprovalPolicy;
        const next = order[(order.indexOf(current) + 1) % order.length];
        onPolicyChange(next);
        return;
      }

      if (
        isMetaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 't' &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        setShowThinking((current) => !current);
        return;
      }

      if (
        event.shiftKey &&
        !isMetaKey &&
        !event.altKey &&
        event.key === 'Enter' &&
        !isEditableTarget(event.target)
      ) {
        const pendingApprovals = shellPanelsState.approvals.filter(
          (approval) => approval.status === 'requested',
        );
        if (pendingApprovals.length > 0) {
          event.preventDefault();
          for (const approval of pendingApprovals) {
            void requestApprovalResolution(approval.id, 'approved');
          }
          return;
        }
      }

      if (
        event.shiftKey &&
        !isMetaKey &&
        !event.altKey &&
        (event.key === 'A' || event.key === 'a' || event.key === 'D' || event.key === 'd') &&
        !isEditableTarget(event.target)
      ) {
        const pendingApproval = shellPanelsState.approvals.find(
          (approval) => approval.status === 'requested',
        );
        if (pendingApproval) {
          event.preventDefault();
          void requestApprovalResolution(
            pendingApproval.id,
            event.key.toLowerCase() === 'a' ? 'approved' : 'denied',
          );
          return;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    railFilterInputRef,
    setQuickOpenVisible,
    setFocusView,
    setUtilityCollapsed,
    setRailView,
    setRunViewTab,
    setUtilityView,
    setShowThinking,
    focusComposer,
    hasActiveSession,
    shellControlsState,
    shellPanelsState,
    onPolicyChange,
  ]);
}
