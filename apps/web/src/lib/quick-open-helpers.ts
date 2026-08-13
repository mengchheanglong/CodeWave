export function getWorkspaceLabel(workspacePath: string) {
  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? workspacePath;
}
