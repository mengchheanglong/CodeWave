type HintBarProps = {
  workspacePath: string;
};

export function HintBar({ workspacePath }: HintBarProps) {
  return (
    <div className="hintbar" aria-hidden="true">
      <span>Ctrl+K palette</span>
      <span>Ctrl+Enter send</span>
      <span>⇧A / ⇧D approve / deny</span>
      <span>⇧Enter approve all</span>
      <span>Ctrl+Space cycle mode</span>
      <span>Ctrl+T thinking</span>
      <span className="hintbar-path" title={workspacePath}>
        {workspacePath || 'workspace unavailable'}
      </span>
    </div>
  );
}
