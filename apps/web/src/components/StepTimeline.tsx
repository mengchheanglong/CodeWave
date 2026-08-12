import {
  AssistantCard,
  DiffCard,
  ThinkingBlock,
  ToolCard,
  UserCard,
  type ToolStatus,
} from '@codewave/ui-kit';
import type { TimelineStep } from '../lib/run-inspector-views';

type StepTimelineProps = {
  steps: TimelineStep[];
  showThinking: boolean;
  expandedToolIds: ReadonlySet<string>;
  onToggleTool: (key: string) => void;
  formatTimestamp: (timestamp: string) => string;
};

export function toolStepKey(step: TimelineStep, index: number): string {
  if (step.kind !== 'tool') {
    return `${step.kind}-${index}`;
  }
  return step.toolUseId ?? `${step.toolName}-${step.startedAt ?? ''}-${index}`;
}

function summarizeToolInput(input: unknown): string {
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    if (typeof record.command === 'string') {
      return `$ ${record.command}`;
    }
    if (typeof record.file_path === 'string') {
      return record.file_path;
    }
    if (typeof record.path === 'string') {
      return record.path;
    }
    if (typeof record.pattern === 'string') {
      return `pattern: ${record.pattern}`;
    }
    if (typeof record.name === 'string') {
      return record.name;
    }
  }
  const text = JSON.stringify(input ?? {});
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function formatToolOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function formatDuration(step: Extract<TimelineStep, { kind: 'tool' }>): string {
  if (!step.startedAt || !step.completedAt) {
    return '';
  }
  const started = new Date(step.startedAt).getTime();
  const completed = new Date(step.completedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(completed) || completed < started) {
    return '';
  }
  const ms = completed - started;
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function isDiffLike(text: string): boolean {
  const lines = text.split('\n').slice(0, 40);
  const markers = lines.filter(
    (line) =>
      line.startsWith('+++ ') ||
      line.startsWith('--- ') ||
      line.startsWith('@@ ') ||
      line.startsWith('diff --git'),
  ).length;
  return markers >= 2;
}

type ToolTimelineStep = Extract<TimelineStep, { kind: 'tool' }>;

function mapToolStatus(status: ToolTimelineStep['status']): ToolStatus {
  switch (status) {
    case 'completed':
      return 'success';
    case 'started':
      return 'running';
    case 'requested':
      return 'pending';
    case 'denied':
      return 'denied';
    case 'failed':
      return 'error';
    default:
      return 'unknown';
  }
}

export function StepTimeline({
  steps,
  showThinking,
  expandedToolIds,
  onToggleTool,
  formatTimestamp,
}: StepTimelineProps) {
  return (
    <>
      {steps.map((step, index) => {
        if (step.kind === 'thinking' && !showThinking) {
          return null;
        }

        if (step.kind === 'user') {
          return (
            <div className="timeline-item user-card-wrap" key={toolStepKey(step, index)}>
              <UserCard
                text={step.text}
                timestamp={formatTimestamp(step.timestamp)}
              />
            </div>
          );
        }

        if (step.kind === 'assistant') {
          return (
            <div className="timeline-item assistant-card-wrap" key={toolStepKey(step, index)}>
              <AssistantCard
                text={step.text}
                timestamp={formatTimestamp(step.timestamp)}
              />
            </div>
          );
        }

        if (step.kind === 'thinking') {
          return (
            <ThinkingBlock
              key={toolStepKey(step, index)}
              text={step.text}
              title={formatTimestamp(step.timestamp)}
            />
          );
        }

        if (step.kind === 'run' || step.kind === 'system') {
          return (
            <article
              className={`timeline-item terminal-line run-meta-step run-meta-${step.kind}`}
              key={toolStepKey(step, index)}
              title={formatTimestamp(step.timestamp)}
            >
              <span className="run-meta-text">{step.text}</span>
            </article>
          );
        }

        const key = toolStepKey(step, index);
        const expanded = expandedToolIds.has(key);
        const duration = formatDuration(step);
        const outputText =
          step.output !== undefined && step.output !== null
            ? formatToolOutput(step.output)
            : undefined;

        return (
          <div
            className="timeline-item tool-step-card-wrap"
            key={key}
            title={formatTimestamp(step.startedAt ?? step.completedAt ?? '')}
          >
            <ToolCard
              toolName={step.toolName}
              status={mapToolStatus(step.status)}
              summary={summarizeToolInput(step.input)}
              detail={step.detail}
              duration={duration || undefined}
              input={step.input}
              output={
                outputText !== undefined && isDiffLike(outputText) ? (
                  <DiffCard diff={outputText} />
                ) : (
                  outputText
                )
              }
              expanded={expanded}
              onToggle={() => {
                onToggleTool(key);
              }}
            />
          </div>
        );
      })}
    </>
  );
}
