import { useState } from 'react';
import type { ShellPanelsState } from '../lib/shell-panels-state';
import { EmptyState } from './EmptyState';

type ArtifactListPanelProps = {
  artifacts: ShellPanelsState['artifacts'];
  formatTimestamp: (timestamp: string) => string;
};

function ArtifactCard({
  artifact,
  formatTimestamp,
}: {
  artifact: ShellPanelsState['artifacts'][0];
  formatTimestamp: (timestamp: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const content = artifact.content;
  const isLarge = content.length > 4000;
  
  const displayContent = !isLarge || expanded 
    ? content 
    : content.slice(0, 4000) + '\n\n... [Content Truncated]';
  const sizeKB = Math.round(content.length / 1024);

  return (
    <article className="artifact-card qw-inspector-card">
      <header className="qw-inspector-card-header">
        <div className="qw-inspector-card-title-group">
          <strong>{artifact.title}</strong>
        </div>
        <span>{formatTimestamp(artifact.createdAt)}</span>
      </header>
      <pre className="qw-inspector-card-preview">{displayContent}</pre>
      {isLarge && !expanded && (
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--qw-border)' }}>
          <button type="button" className="secondary-button" onClick={() => setExpanded(true)}>
            Show full content ({sizeKB} KB)
          </button>
        </div>
      )}
    </article>
  );
}

export function ArtifactListPanel({
  artifacts,
  formatTimestamp,
}: ArtifactListPanelProps) {
  if (artifacts.length === 0) {
    return (
      <EmptyState
        title="No artifacts captured"
        message="Assistant artifacts will be stored here."
      />
    );
  }

  return (
    <>
      {artifacts
        .slice()
        .reverse()
        .map((artifact, index) => (
          <ArtifactCard
            key={artifact.id ?? `${artifact.title}-${artifact.createdAt}-${index}`}
            artifact={artifact}
            formatTimestamp={formatTimestamp}
          />
        ))}
    </>
  );
}
