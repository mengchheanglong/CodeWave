import type { RunViewState } from './run-view-state.js';

type RunEvent = RunViewState['events'][number];
type RunSummary = RunViewState['selectedRun'];

export type RunDeltaEvent = RunEvent & {
  type: 'run.output.delta';
  payload?: {
    stream?: unknown;
    text?: unknown;
  };
};

export type RunMessageEvent = RunEvent & {
  type: 'message.created';
  payload?: {
    content?: unknown;
    role?: unknown;
  };
};

export type ConversationRole = 'user' | 'assistant' | 'thinking' | 'system';

export type ConversationBlock = {
  role: ConversationRole;
  text: string;
  timestamp: string;
};

export type SplitRunInspectorViews = {
  deltas: RunDeltaEvent[];
  messages: RunMessageEvent[];
  timeline: RunEvent[];
};

export function splitRunInspectorViews(events: RunEvent[]): SplitRunInspectorViews {
  const deltas: RunDeltaEvent[] = [];
  const messages: RunMessageEvent[] = [];
  const timeline: RunEvent[] = [];

  for (const event of events) {
    if (event.type === 'run.output.delta') {
      deltas.push(event as RunDeltaEvent);
      continue;
    }

    if (
      event.type === 'message.created' &&
      typeof (event.payload as { content?: unknown } | undefined)?.content === 'string'
    ) {
      messages.push(event as RunMessageEvent);
      continue;
    }

    timeline.push(event);
  }

  return {
    deltas,
    messages,
    timeline,
  };
}

function normalizeDeltaRole(event: RunDeltaEvent): ConversationRole {
  const stream =
    typeof event.payload?.stream === 'string'
      ? event.payload.stream.toLowerCase()
      : 'system';
  if (stream === 'assistant') {
    return 'assistant';
  }
  if (stream === 'thinking') {
    return 'thinking';
  }
  return 'system';
}

function pushConversationBlock(
  blocks: ConversationBlock[],
  role: ConversationRole,
  text: string,
  timestamp: string,
) {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  const previous = blocks.at(-1);
  if (previous && previous.role === role) {
    previous.text += text;
    previous.timestamp = timestamp;
    return;
  }

  blocks.push({
    role,
    text,
    timestamp,
  });
}

export function buildConversationBlocks(
  selectedRun: RunSummary,
  deltas: RunDeltaEvent[],
  messages: RunMessageEvent[],
): ConversationBlock[] {
  const blocks: ConversationBlock[] = [];

  if (selectedRun?.prompt?.trim()) {
    blocks.push({
      role: 'user',
      text: selectedRun.prompt.trim(),
      timestamp: selectedRun.createdAt,
    });
  }

  for (const event of deltas) {
    const text =
      typeof event.payload?.text === 'string'
        ? event.payload.text
        : JSON.stringify(event.payload ?? {});
    pushConversationBlock(blocks, normalizeDeltaRole(event), text, event.timestamp);
  }

  if (messages.length > 0) {
    const finalMessage = messages[messages.length - 1];
    const content =
      typeof finalMessage.payload?.content === 'string'
        ? finalMessage.payload.content.trim()
        : '';
    if (content) {
      const lastAssistantIndex = [...blocks]
        .reverse()
        .findIndex((entry) => entry.role === 'assistant');
      if (lastAssistantIndex !== -1) {
        const absoluteIndex = blocks.length - 1 - lastAssistantIndex;
        blocks[absoluteIndex] = {
          role: 'assistant',
          text: content,
          timestamp: finalMessage.timestamp,
        };
      } else {
        blocks.push({
          role: 'assistant',
          text: content,
          timestamp: finalMessage.timestamp,
        });
      }
    }
  }

  return blocks.map((block) => ({
    ...block,
    text: block.text.replace(/\n{3,}/g, '\n\n').trim(),
  }));
}

export type ToolStepStatus =
  | 'requested'
  | 'started'
  | 'completed'
  | 'failed'
  | 'denied';

export type TimelineStep =
  | { kind: 'run'; text: string; timestamp: string }
  | { kind: 'user'; text: string; timestamp: string }
  | { kind: 'assistant'; text: string; timestamp: string }
  | { kind: 'thinking'; text: string; timestamp: string }
  | {
      kind: 'tool';
      toolName: string;
      toolUseId: string | null;
      input: unknown;
      output: unknown;
      detail: string | null;
      status: ToolStepStatus;
      isError: boolean;
      startedAt: string | null;
      completedAt: string | null;
    }
  | { kind: 'system'; text: string; timestamp: string };

type ToolEventPayload = {
  toolUseId?: unknown;
  toolName?: unknown;
  input?: unknown;
  output?: unknown;
  detail?: unknown;
  isError?: unknown;
};

function appendTextStep(
  steps: TimelineStep[],
  kind: 'user' | 'assistant' | 'thinking' | 'system',
  text: string,
  timestamp: string,
) {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  const previous = steps.at(-1);
  if (
    (kind === 'assistant' && previous?.kind === 'assistant') ||
    (kind === 'thinking' && previous?.kind === 'thinking') ||
    (kind === 'system' && previous?.kind === 'system')
  ) {
    previous.text += text;
    previous.timestamp = timestamp;
    return;
  }

  steps.push({ kind, text, timestamp });
}

function lastOpenToolIndex(steps: TimelineStep[]): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (
      step?.kind === 'tool' &&
      step.status !== 'completed' &&
      step.status !== 'failed' &&
      step.status !== 'denied'
    ) {
      return index;
    }
  }
  return -1;
}

function pushToolStep(
  event: RunEvent,
  steps: TimelineStep[],
  toolIndexByUseId: Map<string, number>,
) {
  const payload = (event.payload ?? {}) as ToolEventPayload;
  const toolUseId =
    typeof payload.toolUseId === 'string' ? payload.toolUseId : null;
  const toolName =
    typeof payload.toolName === 'string' ? payload.toolName : 'tool';
  const existingIndex = toolUseId
    ? toolIndexByUseId.get(toolUseId)
    : undefined;

  if (event.type === 'tool.started' || event.type === 'tool.requested') {
    if (existingIndex !== undefined && steps[existingIndex]?.kind === 'tool') {
      const step = steps[existingIndex];
      step.status = event.type === 'tool.started' ? 'started' : 'requested';
      if (event.type === 'tool.started') {
        step.startedAt = event.timestamp;
      }
      if (payload.input !== undefined) {
        step.input = payload.input;
      }
      if (typeof payload.detail === 'string') {
        step.detail = payload.detail;
      }
      return;
    }

    const index = steps.length;
    steps.push({
      kind: 'tool',
      toolName,
      toolUseId,
      input: payload.input ?? {},
      output: null,
      detail: typeof payload.detail === 'string' ? payload.detail : null,
      status: event.type === 'tool.started' ? 'started' : 'requested',
      isError: false,
      startedAt: event.type === 'tool.started' ? event.timestamp : null,
      completedAt: null,
    });
    if (toolUseId) {
      toolIndexByUseId.set(toolUseId, index);
    }
    return;
  }

  if (event.type === 'tool.completed' || event.type === 'tool.denied') {
    const index = existingIndex ?? lastOpenToolIndex(steps);
    if (index !== -1 && steps[index]?.kind === 'tool') {
      const step = steps[index];
      step.status = event.type === 'tool.denied' ? 'denied' : payload.isError === true ? 'failed' : 'completed';
      step.isError = payload.isError === true;
      step.completedAt = event.timestamp;
      if (event.type === 'tool.completed' && payload.output !== undefined) {
        step.output = payload.output;
      }
      return;
    }

    steps.push({
      kind: 'tool',
      toolName,
      toolUseId,
      input: payload.input ?? {},
      output: event.type === 'tool.completed' ? (payload.output ?? null) : null,
      detail: typeof payload.detail === 'string' ? payload.detail : null,
      status: event.type === 'tool.denied' ? 'denied' : 'completed',
      isError: payload.isError === true,
      startedAt: null,
      completedAt: event.timestamp,
    });
    if (toolUseId) {
      toolIndexByUseId.set(toolUseId, index === -1 ? steps.length - 1 : index);
    }
    return;
  }
}

export function buildTimelineSteps(
  selectedRun: RunSummary,
  events: RunEvent[],
): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const toolIndexByUseId = new Map<string, number>();

  if (selectedRun?.prompt?.trim()) {
    steps.push({
      kind: 'user',
      text: selectedRun.prompt.trim(),
      timestamp: selectedRun.createdAt,
    });
  }

  for (const event of events) {
    switch (event.type) {
      case 'run.started':
        steps.push({ kind: 'run', text: 'Run started', timestamp: event.timestamp });
        break;

      case 'run.output.delta': {
        const payload = (event.payload ?? {}) as { stream?: unknown; text?: unknown };
        const stream =
          typeof payload.stream === 'string' ? payload.stream.toLowerCase() : 'system';
        const text =
          typeof payload.text === 'string'
            ? payload.text
            : JSON.stringify(payload ?? {});
        const role =
          stream === 'assistant'
            ? 'assistant'
            : stream === 'thinking'
              ? 'thinking'
              : 'system';
        appendTextStep(steps, role, text, event.timestamp);
        break;
      }

      case 'message.created': {
        const payload = (event.payload ?? {}) as { content?: unknown };
        const content =
          typeof payload.content === 'string' ? payload.content.trim() : '';
        if (content) {
          const previous = steps.at(-1);
          if (previous?.kind === 'assistant') {
            previous.text = content;
            previous.timestamp = event.timestamp;
          } else {
            steps.push({ kind: 'assistant', text: content, timestamp: event.timestamp });
          }
        }
        break;
      }

      case 'tool.started':
      case 'tool.requested':
      case 'tool.completed':
      case 'tool.denied':
        pushToolStep(event, steps, toolIndexByUseId);
        break;

      case 'tool.registered':
        break;

      case 'approval.requested':
      case 'approval.resolved':
        break;

      case 'artifact.created':
        steps.push({ kind: 'system', text: '📦 Artifact created', timestamp: event.timestamp });
        break;

      case 'checkpoint.saved':
        steps.push({ kind: 'system', text: '💾 Checkpoint saved', timestamp: event.timestamp });
        break;

      case 'run.completed':
        steps.push({ kind: 'system', text: '✓ Run completed', timestamp: event.timestamp });
        break;

      case 'run.failed': {
        const payload = (event.payload ?? {}) as { errorMessage?: unknown };
        const error =
          typeof payload.errorMessage === 'string' && payload.errorMessage
            ? ` — ${payload.errorMessage}`
            : '';
        steps.push({ kind: 'system', text: `✕ Run failed${error}`, timestamp: event.timestamp });
        break;
      }

      case 'run.cancelled':
        steps.push({ kind: 'system', text: '■ Run cancelled', timestamp: event.timestamp });
        break;

      default:
        break;
    }
  }

  return steps;
}
