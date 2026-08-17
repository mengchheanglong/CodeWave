import type { ShellPanelsState } from '../lib/shell-panels-state';
import { EmptyState } from './EmptyState';

type ToolActivityListProps = {
  tools: ShellPanelsState['tools'];
};

function formatToolPayload(tool: ShellPanelsState['tools'][number]) {
  if (typeof tool.detail === 'string' && tool.detail.trim()) {
    return tool.detail;
  }

  const payload = tool.output ?? tool.input ?? {};
  if (typeof payload === 'string') {
    return payload;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return '[unserializable payload]';
  }
}

export function ToolActivityList({ tools }: ToolActivityListProps) {
  if (tools.length === 0) {
    return (
      <EmptyState
        title="No tool activity yet"
        message="Tool activity will appear here."
      />
    );
  }

  return (
    <>
      {tools
        .slice(-20)
        .reverse()
        .map((tool, index) => (
          <div
            className="list-item tool-activity-card qw-inspector-card"
            key={tool.id}
          >
            <div className="tool-activity-card__head qw-inspector-card-header">
              <div className="qw-inspector-card-title-group">
                <strong>{tool.toolName || 'unknown'}</strong>
                <span className="tool-activity-card__meta qw-inspector-subline">
                  {tool.toolUseId ? tool.toolUseId : 'daemon-observed tool event'}
                </span>
              </div>
              <span className={`event-chip tool-status-${tool.status || 'unknown'}`}>
                {tool.status || 'unknown'}
              </span>
            </div>
            <span className="tool-activity-card__body qw-inspector-card-preview">
              {formatToolPayload(tool)}
            </span>
          </div>
        ))}
    </>
  );
}
