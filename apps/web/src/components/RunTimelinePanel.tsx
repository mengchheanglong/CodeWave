import { useEffect, useRef } from 'react';
import type { RunViewState } from '../lib/run-view-state';
import { EmptyState } from './EmptyState';

type RunTimelinePanelProps = {
  selectedRun: RunViewState['selectedRun'];
  timeline: RunViewState['events'];
  formatTimestamp: (timestamp: string) => string;
};

export function RunTimelinePanel({
  selectedRun,
  timeline,
  formatTimestamp,
}: RunTimelinePanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || !selectedRun || timeline.length === 0) {
      return;
    }

    const el = containerRef.current;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [selectedRun, timeline]);

  if (!selectedRun) {
    return (
      <EmptyState
        title="No run selected"
        message="Select a session and start a run."
      />
    );
  }

  if (timeline.length === 0) {
    return (
      <EmptyState
        title="Timeline is empty"
        message="No run lifecycle events yet."
      />
    );
  }

  return (
    <div ref={containerRef} className="timeline-stream terminal-stream">
      {timeline.map((event, index) => (
        <article
          className="timeline-item terminal-line"
          key={`${event.timestamp}-${event.type}-${index}`}
        >
          <header className="terminal-line-header">
            <span className="event-chip system">{event.type}</span>
            <span>{formatTimestamp(event.timestamp)}</span>
          </header>
          <pre className="terminal-line-body">
            {JSON.stringify(event.payload ?? {}, null, 2)}
          </pre>
        </article>
      ))}
    </div>
  );
}
