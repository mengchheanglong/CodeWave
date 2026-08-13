import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnProviderCommand } from '@codewave/provider-runtime';
import { FreebuffCliProvider } from '@codewave/provider-freebuff';
import { GeminiCliProvider } from '@codewave/provider-gemini';
import { OpenCodeCliProvider } from '@codewave/provider-opencode';
import { QwenCliProvider } from '@codewave/provider-qwen';
import {
  createRunEventPublisher,
  launchJsonLineTransport,
  type StructuredTransportTrace,
} from '@codewave/provider-transport';
import type {
  ProviderId,
  ProviderRunContext,
  ProviderSessionUpdate,
  WorkbenchEvent,
} from '@codewave/protocol';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(
  root,
  'scripts',
  'fixtures',
  'fake-structured-jsonl-agent.mjs',
);

function createContext(
  emitted: WorkbenchEvent[],
  options: {
    providerId?: ProviderId;
    onEvent?: (event: WorkbenchEvent) => void;
    onUpdateSession?: (updates: ProviderSessionUpdate) => void;
    prompt?: string;
  } = {},
): ProviderRunContext {
  const providerId = options.providerId ?? 'freebuff';
  return {
    launchAttemptId: '00000000-0000-4000-8000-000000000001',
    session: {
      id: 'transport-session',
      workspacePath: root,
      providerId,
      providerConfigurationRevision: 'sha256:transport-test',
      createdAt: '2026-08-13T00:00:00.000Z',
      providerSessionId: null,
      approvalPolicy: 'manual',
      recovery: null,
      orchestration: null,
    },
    run: {
      id: 'transport-run',
      sessionId: 'transport-session',
      providerId,
      providerConfigurationRevision: 'sha256:transport-test',
      prompt: options.prompt ?? 'validate transport',
      status: 'running',
      mode: 'execute',
      preRunCommit: null,
      createdAt: '2026-08-13T00:00:00.000Z',
      startedAt: '2026-08-13T00:00:00.000Z',
      completedAt: null,
      errorMessage: null,
    },
    emitEvent: async (event) => {
      emitted.push(event);
      options.onEvent?.(event);
    },
    updateSession: async (updates) => options.onUpdateSession?.(updates),
    requestApproval: async () => ({ behavior: 'deny' }),
  };
}

const emitted: WorkbenchEvent[] = [];
const publisher = createRunEventPublisher(createContext(emitted), 'freebuff');
assert.equal(
  await publisher.publish('run.output.delta', { stream: 'assistant', text: 'ok' }),
  true,
);
assert.equal(await publisher.publish('run.completed', { result: 'ok' }), true);
assert.equal(
  await publisher.publish('run.failed', { message: 'must be suppressed' }),
  false,
);
assert.deepEqual(
  emitted.map((event) => event.type),
  ['run.output.delta', 'run.completed'],
);
assert.equal(publisher.terminalEventType, 'run.completed');

const cancelledEvents: WorkbenchEvent[] = [];
const cancellingPublisher = createRunEventPublisher(
  createContext(cancelledEvents),
  'freebuff',
);
cancellingPublisher.requestCancellation();
assert.equal(
  await cancellingPublisher.publish('run.output.delta', { text: 'late output' }),
  false,
);
assert.equal(
  await cancellingPublisher.publish('run.failed', { message: 'close race' }),
  false,
);
assert.equal(
  await cancellingPublisher.publish('run.cancelled', { reason: 'requested' }),
  true,
);
assert.deepEqual(
  cancelledEvents.map((event) => event.type),
  ['run.cancelled'],
);

type FixtureRecord = { type: string; sequence: number };
const callbacks: string[] = [];
const traces: StructuredTransportTrace[] = [];
const transport = launchJsonLineTransport<FixtureRecord>({
  spawn: () => spawnProviderCommand({ command: fixture }, ['--sequence']),
  maxLineChars: 80,
  onRecord: async (record) => {
    callbacks.push(`record:${record.sequence}:start`);
    if (record.sequence === 1) {
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    if (record.sequence === 2) {
      throw new Error('intentional record failure');
    }
    callbacks.push(`record:${record.sequence}:end`);
  },
  onStdoutText: async (line) => {
    callbacks.push(`stdout:${line}`);
  },
  onStderrLine: async (line) => {
    callbacks.push(`stderr:${line}`);
  },
  onLineTooLong: async (channel, length) => {
    callbacks.push(`oversize:${channel}:${length}`);
  },
  onHandlerError: async (error, context) => {
    callbacks.push(
      `handler:${context.kind}:${error instanceof Error ? error.message : String(error)}`,
    );
  },
  onProcessError: async (error) => {
    callbacks.push(`process-error:${error.message}`);
  },
  onClose: async (code) => {
    callbacks.push(`close:${code}`);
  },
  trace: (entry) => traces.push(entry),
});
await transport.settled;

const stdoutCallbacks = callbacks.filter(
  (entry) => !entry.startsWith('stderr:') && !entry.startsWith('close:'),
);
assert.deepEqual(stdoutCallbacks, [
  'record:1:start',
  'record:1:end',
  'stdout:plain diagnostic output',
  'record:2:start',
  'handler:record:intentional record failure',
  'oversize:stdout:256',
  'record:3:start',
  'record:3:end',
]);
assert.ok(callbacks.includes('stderr:structured-agent warning'));
assert.equal(callbacks.at(-1), 'close:0');
assert.deepEqual(
  traces.map((entry) => entry.sequence),
  traces.map((_, index) => index + 1),
);
assert.ok(traces.some((entry) => entry.kind === 'handler-error'));
assert.ok(traces.some((entry) => entry.kind === 'line-too-long'));

let heldRecordResolve: (() => void) | null = null;
const heldRecord = new Promise<void>((resolve) => {
  heldRecordResolve = resolve;
});
const cancellationTraces: StructuredTransportTrace[] = [];
const heldTransport = launchJsonLineTransport<FixtureRecord>({
  spawn: () => spawnProviderCommand({ command: fixture }, ['--hold']),
  onRecord: async () => heldRecordResolve?.(),
  onStdoutText: async () => {},
  onStderrLine: async () => {},
  onHandlerError: async () => {},
  onProcessError: async () => {},
  onClose: async () => {},
  trace: (entry) => cancellationTraces.push(entry),
});
await heldRecord;
await heldTransport.cancel({ graceMs: 1000 });
await heldTransport.settled;
assert.ok(cancellationTraces.some((entry) => entry.kind === 'cancel'));
assert.ok(cancellationTraces.some((entry) => entry.kind === 'close'));
assert.ok(
  cancellationTraces.findIndex((entry) => entry.kind === 'cancel') <
    cancellationTraces.findIndex((entry) => entry.kind === 'close'),
);

function waitForTerminal(
  providerId: ProviderId,
): {
  promise: Promise<void>;
  observe: (event: WorkbenchEvent) => void;
} {
  let resolveTerminal: (() => void) | null = null;
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve;
  });
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${providerId} transport trace timed out.`)),
      5000,
    );
    timer.unref?.();
  });
  return {
    promise: Promise.race([terminal, timeout]),
    observe: (event) => {
      if (
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled'
      ) {
        resolveTerminal?.();
        resolveTerminal = null;
      }
    },
  };
}

const freebuffFixture = path.join(
  root,
  'scripts',
  'fixtures',
  'fake-freebuff-bridge.mjs',
);
const freebuffEvents: WorkbenchEvent[] = [];
const freebuffTerminal = waitForTerminal('freebuff');
const freebuffUpdates: ProviderSessionUpdate[] = [];
const freebuff = new FreebuffCliProvider({
  command: `"${process.execPath}" "${freebuffFixture}"`,
  rootPath: root,
});
const freebuffHandle = await freebuff.startRun(
  createContext(freebuffEvents, {
    providerId: 'freebuff',
    onEvent: freebuffTerminal.observe,
    onUpdateSession: (updates) => freebuffUpdates.push(updates),
    prompt: '[native-steering] validate transport',
  }),
);
assert.equal(
  (
    await freebuffHandle.steer?.({
      steeringId: 'freebuff-steering-accepted',
      prompt: 'focus on the transport boundary',
      createdAt: '2026-08-13T00:00:01.000Z',
    })
  )?.disposition,
  'accepted',
);
assert.equal(
  (
    await freebuffHandle.steer?.({
      steeringId: 'freebuff-steering-rejected',
      prompt: '[reject] unsafe update',
      createdAt: '2026-08-13T00:00:02.000Z',
    })
  )?.disposition,
  'rejected',
);
await freebuffTerminal.promise;
assert.deepEqual(
  freebuffEvents.map((event) => event.type),
  [
    'tool.requested',
    'tool.completed',
    'checkpoint.saved',
    'message.created',
    'run.completed',
  ],
);
assert.equal(
  freebuffEvents.filter((event) => event.type.startsWith('run.') && event.type !== 'run.output.delta').length,
  1,
);
assert.equal(freebuffUpdates.at(-1)?.providerSessionId, 'fake-freebuff-session');
assert.match(
  String(freebuffEvents.at(-1)?.payload.result),
  /steered: focus on the transport boundary/,
);

async function runFreebuffIntegrityScenario(prompt: string): Promise<WorkbenchEvent[]> {
  const events: WorkbenchEvent[] = [];
  const terminal = waitForTerminal('freebuff');
  await freebuff.startRun(
    createContext(events, {
      providerId: 'freebuff',
      onEvent: terminal.observe,
      prompt,
    }),
  );
  await terminal.promise;
  return events;
}

const missingHelloEvents = await runFreebuffIntegrityScenario('[missing-hello]');
assert.equal(missingHelloEvents.at(-1)?.type, 'run.failed');
assert.match(String(missingHelloEvents.at(-1)?.payload.message), /qualification failed/i);

const missingResultEvents = await runFreebuffIntegrityScenario('[missing-result]');
assert.equal(missingResultEvents.at(-1)?.type, 'run.failed');
assert.match(String(missingResultEvents.at(-1)?.payload.message), /without an explicit terminal result/i);

const resultOnlyEvents = await runFreebuffIntegrityScenario('[result-only]');
assert.deepEqual(
  resultOnlyEvents.map((event) => event.type),
  ['message.created', 'run.completed'],
);
assert.match(String(resultOnlyEvents[0]?.payload.content), /result-only/);

const geminiFixture = path.join(
  root,
  'scripts',
  'fixtures',
  'fake-gemini-stream-json.mjs',
);
const previousGeminiMode = process.env.CODEWAVE_GEMINI_MODE;
process.env.CODEWAVE_GEMINI_MODE = 'stream-json';
try {
  const geminiEvents: WorkbenchEvent[] = [];
  const geminiTerminal = waitForTerminal('gemini');
  const geminiUpdates: ProviderSessionUpdate[] = [];
  const gemini = new GeminiCliProvider(
    `"${process.execPath}" "${geminiFixture}"`,
  );
  await gemini.startRun(
    createContext(geminiEvents, {
      providerId: 'gemini',
      onEvent: geminiTerminal.observe,
      onUpdateSession: (updates) => geminiUpdates.push(updates),
    }),
  );
  await geminiTerminal.promise;
  assert.deepEqual(
    geminiEvents.map((event) => event.type),
    [
      'run.output.delta',
      'tool.requested',
      'tool.started',
      'tool.completed',
      'run.output.delta',
      'run.output.delta',
      'message.created',
      'run.completed',
    ],
  );
  assert.equal(
    geminiEvents.find((event) => event.type === 'message.created')?.payload.content,
    'Calm waves',
  );
  assert.equal(
    geminiEvents.filter((event) => event.type === 'run.completed').length,
    1,
  );
  assert.equal(
    geminiUpdates.at(-1)?.providerSessionId,
    'fake-gemini-stream-session',
  );
} finally {
  if (previousGeminiMode === undefined) {
    delete process.env.CODEWAVE_GEMINI_MODE;
  } else {
    process.env.CODEWAVE_GEMINI_MODE = previousGeminiMode;
  }
}

const acpFixture = path.join(
  root,
  'scripts',
  'fixtures',
  'fake-gemini-acp-agent.mjs',
);
const previousGeminiAcpMode = process.env.CODEWAVE_GEMINI_MODE;
const previousAcpPermission = process.env.CODEWAVE_FAKE_ACP_PERMISSION;
const previousGeminiToolTitles = process.env.CODEWAVE_FAKE_GEMINI_TOOL_TITLES;
process.env.CODEWAVE_GEMINI_MODE = 'acp';
process.env.CODEWAVE_FAKE_ACP_PERMISSION = '1';
process.env.CODEWAVE_FAKE_GEMINI_TOOL_TITLES = 'run_shell_command,read_file';
try {
  const geminiAcpEvents: WorkbenchEvent[] = [];
  const geminiAcpTerminal = waitForTerminal('gemini');
  const geminiAcpUpdates: ProviderSessionUpdate[] = [];
  const geminiAcp = new GeminiCliProvider(
    `"${process.execPath}" "${acpFixture}"`,
  );
  await geminiAcp.startRun(
    createContext(geminiAcpEvents, {
      providerId: 'gemini',
      onEvent: geminiAcpTerminal.observe,
      onUpdateSession: (updates) => geminiAcpUpdates.push(updates),
    }),
  );
  await geminiAcpTerminal.promise;
  assert.equal(
    geminiAcpEvents.filter((event) => event.type === 'tool.registered').length,
    2,
  );
  assert.equal(
    geminiAcpEvents.filter((event) => event.type === 'tool.denied').length,
    1,
  );
  assert.equal(
    geminiAcpEvents.filter((event) => event.type === 'tool.completed').length,
    1,
    'duplicate ACP terminal tool updates must be suppressed',
  );
  assert.ok(
    geminiAcpEvents.some(
      (event) =>
        event.type === 'run.output.delta' &&
        event.payload.stream === 'thinking' &&
        event.payload.text === 'Deterministic private reasoning trace.',
    ),
  );
  assert.equal(
    geminiAcpEvents.filter((event) => event.type === 'run.completed').length,
    1,
  );
  assert.match(
    geminiAcpUpdates.at(-1)?.providerSessionId ?? '',
    /^fake-gemini-/,
  );
} finally {
  if (previousGeminiAcpMode === undefined) delete process.env.CODEWAVE_GEMINI_MODE;
  else process.env.CODEWAVE_GEMINI_MODE = previousGeminiAcpMode;
  if (previousAcpPermission === undefined) delete process.env.CODEWAVE_FAKE_ACP_PERMISSION;
  else process.env.CODEWAVE_FAKE_ACP_PERMISSION = previousAcpPermission;
  if (previousGeminiToolTitles === undefined) delete process.env.CODEWAVE_FAKE_GEMINI_TOOL_TITLES;
  else process.env.CODEWAVE_FAKE_GEMINI_TOOL_TITLES = previousGeminiToolTitles;
}

const previousOpenCodeMode = process.env.CODEWAVE_OPENCODE_MODE;
process.env.CODEWAVE_OPENCODE_MODE = 'acp';
try {
  const openCodeEvents: WorkbenchEvent[] = [];
  const openCodeTerminal = waitForTerminal('opencode');
  const openCode = new OpenCodeCliProvider({
    command: `"${process.execPath}" "${acpFixture}"`,
    rootPath: root,
  });
  await openCode.startRun(
    createContext(openCodeEvents, {
      providerId: 'opencode',
      onEvent: openCodeTerminal.observe,
    }),
  );
  await openCodeTerminal.promise;
  assert.equal(
    openCodeEvents.filter((event) => event.type === 'run.completed').length,
    1,
  );
  assert.equal(
    openCodeEvents.find((event) => event.type === 'message.created')?.payload.content,
    'Deterministic fake Gemini ACP response.',
  );
  assert.ok(openCodeEvents.some((event) => event.type === 'tool.completed'));
  assert.equal(
    openCodeEvents.filter((event) => event.type === 'tool.completed').length,
    1,
    'OpenCode must inherit shared ACP duplicate-terminal suppression',
  );
} finally {
  if (previousOpenCodeMode === undefined) {
    delete process.env.CODEWAVE_OPENCODE_MODE;
  } else {
    process.env.CODEWAVE_OPENCODE_MODE = previousOpenCodeMode;
  }
}

const qwenFixture = path.join(
  root,
  'scripts',
  'fixtures',
  'fake-qwen-runtime.mjs',
);
const previousQwenDiagnostic = process.env.CODEWAVE_FAKE_QWEN_STDOUT_DIAGNOSTIC;
const previousQwenDuplicate = process.env.CODEWAVE_FAKE_QWEN_DUPLICATE_RESULT;
const previousQwenHold = process.env.CODEWAVE_FAKE_QWEN_HOLD;
process.env.CODEWAVE_FAKE_QWEN_STDOUT_DIAGNOSTIC = '1';
process.env.CODEWAVE_FAKE_QWEN_DUPLICATE_RESULT = '1';
delete process.env.CODEWAVE_FAKE_QWEN_HOLD;
try {
  const qwenEvents: WorkbenchEvent[] = [];
  const qwenTerminal = waitForTerminal('qwen');
  const qwenUpdates: ProviderSessionUpdate[] = [];
  const qwenTraces: StructuredTransportTrace[] = [];
  const qwen = new QwenCliProvider({
    command: `"${process.execPath}" "${qwenFixture}"`,
    rootPath: root,
    transportTrace: (entry) => qwenTraces.push(entry),
  });
  await qwen.startRun(
    createContext(qwenEvents, {
      providerId: 'qwen',
      onEvent: qwenTerminal.observe,
      onUpdateSession: (updates) => qwenUpdates.push(updates),
    }),
  );
  await qwenTerminal.promise;
  assert.equal(
    qwenEvents.filter((event) => event.type === 'run.completed').length,
    1,
    'duplicate Qwen result records must be suppressed',
  );
  assert.equal(
    qwenEvents.find((event) => event.type === 'message.created')?.payload.content,
    'Deterministic fake Qwen response.',
  );
  assert.ok(
    qwenEvents.some(
      (event) =>
        event.type === 'run.output.delta' &&
        event.payload.stream === 'stdout' &&
        event.payload.text === 'deterministic qwen plain-text diagnostic',
    ),
  );
  assert.equal(
    qwenEvents.filter((event) => event.type === 'tool.registered').length,
    2,
  );
  assert.equal(qwenUpdates.at(-1)?.providerSessionId, 'fake-qwen-session');
  assert.deepEqual(
    qwenTraces.map((entry) => entry.sequence),
    qwenTraces.map((_, index) => index + 1),
  );
  assert.ok(qwenTraces.some((entry) => entry.kind === 'record'));

  process.env.CODEWAVE_FAKE_QWEN_STDOUT_DIAGNOSTIC = '0';
  process.env.CODEWAVE_FAKE_QWEN_DUPLICATE_RESULT = '0';
  process.env.CODEWAVE_FAKE_QWEN_HOLD = '1';
  const cancelledQwenEvents: WorkbenchEvent[] = [];
  const cancelledQwenTerminal = waitForTerminal('qwen');
  const cancelledQwenTraces: StructuredTransportTrace[] = [];
  const heldQwen = new QwenCliProvider({
    command: `"${process.execPath}" "${qwenFixture}"`,
    rootPath: root,
    transportTrace: (entry) => cancelledQwenTraces.push(entry),
  });
  const heldHandle = await heldQwen.startRun(
    createContext(cancelledQwenEvents, {
      providerId: 'qwen',
      onEvent: cancelledQwenTerminal.observe,
    }),
  );
  await heldHandle.cancel();
  await cancelledQwenTerminal.promise;
  assert.deepEqual(
    cancelledQwenEvents.filter(
      (event) =>
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled',
    ).map((event) => event.type),
    ['run.cancelled'],
  );
  assert.ok(cancelledQwenTraces.some((entry) => entry.kind === 'cancel'));
  assert.ok(cancelledQwenTraces.some((entry) => entry.kind === 'close'));
} finally {
  if (previousQwenDiagnostic === undefined) delete process.env.CODEWAVE_FAKE_QWEN_STDOUT_DIAGNOSTIC;
  else process.env.CODEWAVE_FAKE_QWEN_STDOUT_DIAGNOSTIC = previousQwenDiagnostic;
  if (previousQwenDuplicate === undefined) delete process.env.CODEWAVE_FAKE_QWEN_DUPLICATE_RESULT;
  else process.env.CODEWAVE_FAKE_QWEN_DUPLICATE_RESULT = previousQwenDuplicate;
  if (previousQwenHold === undefined) delete process.env.CODEWAVE_FAKE_QWEN_HOLD;
  else process.env.CODEWAVE_FAKE_QWEN_HOLD = previousQwenHold;
}

process.stdout.write(
  'Structured transport validation passed: ordered JSONL delivery, plain-text fallback, line ceilings, isolated handler failures, exactly-once terminal events, lifecycle traces, bounded cancellation, Freebuff/Gemini/Qwen normalization parity, shared Gemini/OpenCode ACP permission and tool lifecycle parity, and Qwen cancellation traces.\n',
);
