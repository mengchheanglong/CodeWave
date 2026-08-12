import type { RunStatus } from '@codewave/protocol';

export function getWorkspaceLabel(workspacePath: string) {
  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? workspacePath;
}

export function summarizePrompt(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return 'No prompt text recorded yet.';
  }
  return trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed;
}

export function formatRunStatus(status: RunStatus): string {
  return status.replace(/_/g, ' ');
}
