import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import type {
  EventSource,
  ProviderRunContext,
  WorkbenchEvent,
  WorkbenchEventType,
} from '@codewave/protocol';

export * from './acp.js';

const TERMINAL_EVENT_TYPES = new Set<WorkbenchEventType>([
  'run.completed',
  'run.failed',
  'run.cancelled',
]);

export type RunEventPublisher = {
  readonly terminalEventType: WorkbenchEventType | null;
  readonly cancellationRequested: boolean;
  readonly sealed: boolean;
  publish: (
    type: WorkbenchEventType,
    payload: Record<string, unknown>,
  ) => Promise<boolean>;
  requestCancellation: () => void;
  seal: () => void;
};

export function createRunEventPublisher(
  context: ProviderRunContext,
  source: EventSource,
): RunEventPublisher {
  let terminalEventType: WorkbenchEventType | null = null;
  let cancellationRequested = false;
  let sealed = false;

  return {
    get terminalEventType() {
      return terminalEventType;
    },
    get cancellationRequested() {
      return cancellationRequested;
    },
    get sealed() {
      return sealed;
    },
    async publish(type, payload) {
      if (sealed || terminalEventType) return false;
      if (cancellationRequested && type !== 'run.cancelled') return false;
      const isTerminal = TERMINAL_EVENT_TYPES.has(type);
      if (isTerminal) terminalEventType = type;

      const event: WorkbenchEvent = {
        id: randomUUID(),
        sessionId: context.session.id,
        runId: context.run.id,
        timestamp: new Date().toISOString(),
        source,
        type,
        payload,
      };

      try {
        await context.emitEvent(event);
        return true;
      } catch (error) {
        if (isTerminal && terminalEventType === type) terminalEventType = null;
        throw error;
      }
    },
    requestCancellation() {
      cancellationRequested = true;
    },
    seal() {
      sealed = true;
    },
  };
}

export type StructuredTransportChannel = 'stdout' | 'stderr' | 'process';
export type StructuredTransportTraceKind =
  | 'record'
  | 'text'
  | 'line-too-long'
  | 'handler-error'
  | 'process-error'
  | 'close'
  | 'cancel';

export type StructuredTransportTrace = {
  sequence: number;
  timestamp: string;
  channel: StructuredTransportChannel;
  kind: StructuredTransportTraceKind;
  detail: Record<string, unknown>;
};

export type JsonLineTransportOptions<TRecord> = {
  spawn: () => ChildProcess;
  parseRecord?: (line: string) => TRecord;
  onRecord: (record: TRecord, rawLine: string) => Promise<void>;
  onStdoutText: (line: string) => Promise<void>;
  onStderrLine: (line: string) => Promise<void>;
  onLineTooLong?: (
    channel: Exclude<StructuredTransportChannel, 'process'>,
    length: number,
  ) => Promise<void>;
  onHandlerError: (
    error: unknown,
    context: {
      channel: StructuredTransportChannel;
      kind: StructuredTransportTraceKind;
      line?: string;
    },
  ) => Promise<void>;
  onProcessError: (error: Error) => Promise<void>;
  onClose: (code: number | null, signal: NodeJS.Signals | null) => Promise<void>;
  maxLineChars?: number;
  trace?: (entry: StructuredTransportTrace) => void;
};

export type JsonLineTransportHandle = {
  child: ChildProcess;
  settled: Promise<void>;
  drain: () => Promise<void>;
  cancel: (options?: { graceMs?: number }) => Promise<void>;
};

export function launchJsonLineTransport<TRecord>(
  options: JsonLineTransportOptions<TRecord>,
): JsonLineTransportHandle {
  const child = options.spawn();
  const maxLineChars = Math.max(1, options.maxLineChars ?? 1024 * 1024);
  const parseRecord =
    options.parseRecord ??
    ((line: string) => JSON.parse(line) as TRecord);
  let traceSequence = 0;
  let taskChain = Promise.resolve();
  let settledResolve: (() => void) | null = null;
  let closeObserved = false;
  let cancelled = false;

  const emitTrace = (
    channel: StructuredTransportChannel,
    kind: StructuredTransportTraceKind,
    detail: Record<string, unknown> = {},
  ): void => {
    traceSequence += 1;
    options.trace?.({
      sequence: traceSequence,
      timestamp: new Date().toISOString(),
      channel,
      kind,
      detail,
    });
  };

  const enqueue = (
    task: () => Promise<void>,
    context: {
      channel: StructuredTransportChannel;
      kind: StructuredTransportTraceKind;
      line?: string;
    },
  ): void => {
    taskChain = taskChain.then(task).catch(async (error) => {
      emitTrace(context.channel, 'handler-error', {
        operation: context.kind,
        message: error instanceof Error ? error.message : String(error),
      });
      try {
        await options.onHandlerError(error, context);
      } catch {
        // A diagnostic hook must not break ordered delivery or close handling.
      }
    });
  };

  const handleLine = (
    channel: Exclude<StructuredTransportChannel, 'process'>,
    line: string,
  ): void => {
    if (line.length > maxLineChars) {
      emitTrace(channel, 'line-too-long', {
        length: line.length,
        maxLineChars,
      });
      enqueue(
        () => options.onLineTooLong?.(channel, line.length) ?? Promise.resolve(),
        { channel, kind: 'line-too-long' },
      );
      return;
    }

    if (channel === 'stderr') {
      emitTrace('stderr', 'text', { length: line.length });
      enqueue(() => options.onStderrLine(line), {
        channel: 'stderr',
        kind: 'text',
        line,
      });
      return;
    }

    let record: TRecord;
    try {
      record = parseRecord(line);
    } catch {
      emitTrace('stdout', 'text', { length: line.length });
      enqueue(() => options.onStdoutText(line), {
        channel: 'stdout',
        kind: 'text',
        line,
      });
      return;
    }

    emitTrace('stdout', 'record', { length: line.length });
    enqueue(() => options.onRecord(record, line), {
      channel: 'stdout',
      kind: 'record',
      line,
    });
  };

  if (child.stdout) {
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      handleLine('stdout', line);
    });
  }
  if (child.stderr) {
    readline.createInterface({ input: child.stderr }).on('line', (line) => {
      handleLine('stderr', line);
    });
  }

  child.on('error', (error) => {
    emitTrace('process', 'process-error', { message: error.message });
    enqueue(() => options.onProcessError(error), {
      channel: 'process',
      kind: 'process-error',
    });
  });

  const settled = new Promise<void>((resolve) => {
    settledResolve = resolve;
  });
  child.on('close', (code, signal) => {
    closeObserved = true;
    emitTrace('process', 'close', { code, signal, cancelled });
    enqueue(
      async () => {
        try {
          await options.onClose(code, signal);
        } finally {
          settledResolve?.();
          settledResolve = null;
        }
      },
      { channel: 'process', kind: 'close' },
    );
  });

  return {
    child,
    settled,
    drain: () => taskChain,
    async cancel({ graceMs = 1500 } = {}) {
      if (closeObserved || child.exitCode !== null) {
        await taskChain;
        return;
      }
      cancelled = true;
      emitTrace('process', 'cancel', { graceMs });
      child.kill();
      await Promise.race([
        settled,
        new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (!closeObserved && child.exitCode === null) child.kill('SIGKILL');
            resolve();
          }, Math.max(0, graceMs));
          timeout.unref?.();
        }),
      ]);
      await taskChain;
    },
  };
}
