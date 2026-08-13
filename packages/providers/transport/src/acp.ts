import type { ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  client as createAcpClient,
  methods,
  PROTOCOL_VERSION,
  ndJsonStream,
  type ClientConnection,
  type InitializeResponse,
  type PermissionOption,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import {
  inferRoutingToolRequirement,
  type ProviderApprovalDecision,
  type ProviderRunContext,
  type RoutingToolRequirement,
  type ToolDescriptorSource,
  type WorkbenchEvent,
} from '@codewave/protocol';

export type AcpEventPublisher = (
  type: WorkbenchEvent['type'],
  payload: Record<string, unknown>,
) => Promise<void>;

export type AcpProviderProfile = {
  providerId: string;
  displayName: string;
  surface: string;
  inferToolRequirement?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => RoutingToolRequirement | null;
  registrationDetail?: string;
  toolFailureDetail?: string;
  cancelGraceMs?: number;
  initializeTimeoutMs?: number;
};

export type AcpTransportTraceKind =
  | 'initialize'
  | 'initialize.complete'
  | 'session.new'
  | 'session.resume'
  | 'session.load'
  | 'session.persist'
  | 'permission.request'
  | 'permission.resolve'
  | 'session.update'
  | 'prompt.start'
  | 'prompt.complete'
  | 'prompt.fail'
  | 'cancel.request'
  | 'cancel.complete';

export type AcpTransportTrace = {
  sequence: number;
  timestamp: string;
  providerId: string;
  kind: AcpTransportTraceKind;
  detail: Record<string, unknown>;
};

export type AcpRunOptions = {
  child: ChildProcess;
  context: ProviderRunContext;
  publish: AcpEventPublisher;
  profile: AcpProviderProfile;
  trace?: (entry: AcpTransportTrace) => void;
};

export type AcpRunHandle = {
  cancel: () => Promise<void>;
  settled: Promise<void>;
};

const CODEWAVE_ACP_CLIENT_VERSION = '0.1.0-dev';
const ACP_STDOUT_LINE_LIMIT = 1024 * 1024;
const ACP_SESSION_ID_LIMIT = 1024;

type ToolTerminalState = 'completed' | 'failed' | 'denied';

type TrackedTool = {
  toolName: string;
  input: Record<string, unknown>;
  requested: boolean;
  started: boolean;
  terminal: ToolTerminalState | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function extractTextContent(
  content:
    | Array<{ type?: string; content?: { type?: string; text?: string } }>
    | null
    | undefined,
): string {
  if (!Array.isArray(content)) return '';

  return content
    .map((entry) =>
      entry.type === 'content' && entry.content?.type === 'text'
        ? entry.content.text ?? ''
        : '',
    )
    .filter(Boolean)
    .join('\n');
}

function selectPermissionOption(
  options: PermissionOption[],
  decision: ProviderApprovalDecision,
): PermissionOption | null {
  if (decision.behavior === 'cancel') return null;
  const preferredKinds =
    decision.behavior === 'allow'
      ? ['allow_once', 'allow_always']
      : ['reject_once', 'reject_always'];

  return (
    preferredKinds
      .map((kind) => options.find((option) => option.kind === kind))
      .find((option): option is PermissionOption => Boolean(option)) ?? null
  );
}

function extractUsage(result: PromptResponse): Record<string, unknown> {
  if (result.usage && typeof result.usage === 'object') {
    return result.usage as Record<string, unknown>;
  }

  const quota = asRecord(result._meta).quota;
  return quota && typeof quota === 'object'
    ? (quota as Record<string, unknown>)
    : {};
}

function inferSourceFromRequirement(
  requirement: RoutingToolRequirement,
): ToolDescriptorSource {
  return requirement === 'mcp' ? 'mcp' : 'provider';
}

function getSessionId(
  sessionResult: object,
  existingSessionId: string | null,
): string {
  const sessionId =
    'sessionId' in sessionResult && typeof sessionResult.sessionId === 'string'
      ? sessionResult.sessionId.trim()
      : existingSessionId?.trim() ?? '';
  if (
    !sessionId ||
    sessionId.length > ACP_SESSION_ID_LIMIT ||
    /[\u0000-\u001f\u007f]/.test(sessionId)
  ) {
    throw new Error('ACP agent returned an invalid or missing session ID.');
  }
  return sessionId;
}

class CodeWaveAcpClient {
  private readonly assistantMessages = new Map<string, string>();
  private readonly assistantMessageOrder: string[] = [];
  private readonly tools = new Map<string, TrackedTool>();
  private readonly registeredTools = new Set<string>();
  private captureUpdates = false;
  private activeSessionId: string | null = null;
  private updateChain = Promise.resolve();

  constructor(
    private readonly context: ProviderRunContext,
    private readonly publish: AcpEventPublisher,
    private readonly profile: AcpProviderProfile,
    private readonly emitTrace: (
      kind: AcpTransportTraceKind,
      detail?: Record<string, unknown>,
    ) => void,
  ) {}

  getAssistantMessage(): string {
    return this.assistantMessageOrder
      .map((messageId) => this.assistantMessages.get(messageId)?.trim() ?? '')
      .filter(Boolean)
      .join('\n\n');
  }

  beginRestore(sessionId: string): void {
    this.activeSessionId = sessionId;
    this.captureUpdates = false;
    this.resetTurnState();
  }

  startPromptTurn(sessionId: string): void {
    this.activeSessionId = sessionId;
    this.captureUpdates = true;
    this.resetTurnState();
  }

  finishPromptTurn(): void {
    this.captureUpdates = false;
  }

  async drainUpdates(): Promise<void> {
    await this.updateChain;
  }

  private resetTurnState(): void {
    this.assistantMessages.clear();
    this.assistantMessageOrder.length = 0;
    this.tools.clear();
    this.registeredTools.clear();
  }

  private resolveTool(
    toolUseId: string | null,
    toolName: string | null | undefined,
    input: Record<string, unknown> | null | undefined,
  ): { key: string; tool: TrackedTool } {
    const fallbackName = toolName || 'unknown';
    const key = toolUseId ?? fallbackName;
    const existing = this.tools.get(key);
    const tool: TrackedTool = {
      toolName: toolName || existing?.toolName || 'unknown',
      input:
        input && Object.keys(input).length > 0 ? input : (existing?.input ?? {}),
      requested: existing?.requested ?? false,
      started: existing?.started ?? false,
      terminal: existing?.terminal ?? null,
    };
    this.tools.set(key, tool);
    return { key, tool };
  }

  private async emitToolRegisteredIfNeeded({
    toolName,
    input,
    providerSurface,
    toolUseId,
    metadata,
  }: {
    toolName: string;
    input: Record<string, unknown>;
    providerSurface: string;
    toolUseId: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const normalizedName = toolName.trim();
    const registrationKey = normalizedName.toLowerCase();
    if (!normalizedName || this.registeredTools.has(registrationKey)) return;

    const requirement =
      this.profile.inferToolRequirement?.(normalizedName, input) ??
      inferRoutingToolRequirement({ toolName: normalizedName, input });
    if (!requirement) return;

    this.registeredTools.add(registrationKey);
    await this.publish('tool.registered', {
      toolUseId,
      toolName: normalizedName,
      requirement,
      source: inferSourceFromRequirement(requirement),
      input,
      detail:
        this.profile.registrationDetail ??
        `${this.profile.displayName} ACP runtime reported this connected tool through session metadata.`,
      metadata: {
        confirmedBy: 'provider-runtime',
        providerSurface,
        ...(metadata ?? {}),
      },
    });
  }

  private async emitToolRequestedIfNeeded(
    toolUseId: string | null,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<TrackedTool> {
    const resolved = this.resolveTool(toolUseId, toolName, input);
    if (!resolved.tool.requested && !resolved.tool.terminal) {
      await this.publish('tool.requested', {
        toolUseId,
        toolName: resolved.tool.toolName,
        input: resolved.tool.input,
      });
      resolved.tool.requested = true;
      this.tools.set(resolved.key, resolved.tool);
    }
    return resolved.tool;
  }

  private async emitToolStartedIfNeeded(
    toolUseId: string | null,
    toolName: string,
  ): Promise<TrackedTool> {
    const resolved = this.resolveTool(toolUseId, toolName, null);
    if (!resolved.tool.requested) {
      await this.emitToolRequestedIfNeeded(
        toolUseId,
        resolved.tool.toolName,
        resolved.tool.input,
      );
    }
    if (!resolved.tool.started && !resolved.tool.terminal) {
      await this.publish('tool.started', {
        toolUseId,
        toolName: resolved.tool.toolName,
      });
      resolved.tool.started = true;
      this.tools.set(resolved.key, resolved.tool);
    }
    return resolved.tool;
  }

  private async emitToolCompletedIfNeeded({
    toolUseId,
    toolName,
    output,
    isError,
  }: {
    toolUseId: string | null;
    toolName: string;
    output: unknown;
    isError: boolean;
  }): Promise<void> {
    const resolved = this.resolveTool(toolUseId, toolName, null);
    if (resolved.tool.terminal) return;

    await this.emitToolStartedIfNeeded(toolUseId, resolved.tool.toolName);
    await this.publish('tool.completed', {
      toolUseId,
      toolName: resolved.tool.toolName,
      isError,
      output,
      detail:
        isError && typeof output === 'string' && output
          ? output
          : isError
            ? this.profile.toolFailureDetail ??
              `${this.profile.displayName} ACP tool call failed.`
            : null,
    });
    resolved.tool.terminal = isError ? 'failed' : 'completed';
    this.tools.set(resolved.key, resolved.tool);
  }

  async requestPermission(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    if (!this.activeSessionId || params.sessionId !== this.activeSessionId) {
      this.emitTrace('permission.resolve', {
        rejected: 'session_mismatch',
        sessionId: params.sessionId,
      });
      return { outcome: { outcome: 'cancelled' } };
    }
    const toolName = params.toolCall.title || 'unknown';
    const toolUseId = params.toolCall.toolCallId ?? null;
    const input = asRecord(params.toolCall.rawInput);
    const metadata: Record<string, unknown> = {
      permissionOptions: params.options.map((option) => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind,
      })),
    };

    this.emitTrace('permission.request', { toolUseId, toolName });
    await this.emitToolRegisteredIfNeeded({
      toolUseId,
      toolName,
      input,
      providerSurface: `${this.profile.surface}.request_permission`,
      metadata: { permissionOptionCount: params.options.length },
    });
    await this.emitToolRequestedIfNeeded(toolUseId, toolName, input);

    const decision = await this.context.requestApproval({
      toolName,
      toolUseId,
      input,
      metadata,
    });
    const resolved = this.resolveTool(toolUseId, toolName, input);
    if (decision.behavior === 'deny' || decision.behavior === 'cancel') {
      if (!resolved.tool.terminal) {
        await this.publish('tool.denied', {
          toolUseId,
          toolName: resolved.tool.toolName,
          input: resolved.tool.input,
          detail:
            decision.message ??
            (decision.behavior === 'cancel'
              ? 'Tool execution cancelled with the CodeWave run.'
              : 'Tool execution denied in CodeWave.'),
        });
        resolved.tool.terminal = 'denied';
        this.tools.set(resolved.key, resolved.tool);
      }
    } else {
      await this.emitToolStartedIfNeeded(toolUseId, toolName);
    }

    const option = selectPermissionOption(params.options, decision);
    this.emitTrace('permission.resolve', {
      toolUseId,
      toolName,
      behavior: decision.behavior,
      optionId: option?.optionId ?? null,
    });
    return option
      ? { outcome: { outcome: 'selected', optionId: option.optionId } }
      : { outcome: { outcome: 'cancelled' } };
  }

  sessionUpdate(params: SessionNotification): Promise<void> {
    if (this.activeSessionId && params.sessionId !== this.activeSessionId) {
      this.emitTrace('session.update', {
        sessionUpdate: params.update.sessionUpdate,
        rejected: 'session_mismatch',
        sessionId: params.sessionId,
      });
      return Promise.resolve();
    }
    const task = this.updateChain.then(() => this.processSessionUpdate(params));
    this.updateChain = task.catch(() => undefined);
    return task;
  }

  private async processSessionUpdate(
    params: SessionNotification,
  ): Promise<void> {
    const update = params.update;
    this.emitTrace('session.update', {
      sessionUpdate: update.sessionUpdate,
      captureUpdates: this.captureUpdates,
    });
    if (!this.captureUpdates) return;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = update.content.type === 'text' ? update.content.text ?? '' : '';
        if (text) {
          const messageId = update.messageId?.trim() || 'assistant-default';
          if (!this.assistantMessages.has(messageId)) {
            this.assistantMessageOrder.push(messageId);
          }
          this.assistantMessages.set(
            messageId,
            `${this.assistantMessages.get(messageId) ?? ''}${text}`,
          );
          await this.publish('run.output.delta', { stream: 'assistant', text });
        }
        return;
      }
      case 'agent_thought_chunk': {
        const text = update.content.type === 'text' ? update.content.text ?? '' : '';
        if (text) await this.publish('run.output.delta', { stream: 'thinking', text });
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const toolUseId = update.toolCallId ?? null;
        const input = asRecord(update.rawInput);
        const resolved = this.resolveTool(
          toolUseId,
          update.title || null,
          Object.keys(input).length > 0 ? input : null,
        );
        const providerSurface = `${this.profile.surface}.session_update.${update.sessionUpdate}`;
        await this.emitToolRegisteredIfNeeded({
          toolUseId,
          toolName: resolved.tool.toolName,
          input: resolved.tool.input,
          providerSurface,
          metadata: {
            sessionUpdate: update.sessionUpdate,
            status: update.status ?? null,
          },
        });
        await this.emitToolRequestedIfNeeded(
          toolUseId,
          resolved.tool.toolName,
          resolved.tool.input,
        );

        const status = update.status ?? (update.sessionUpdate === 'tool_call' ? 'pending' : null);
        if (status === 'in_progress') {
          await this.emitToolStartedIfNeeded(toolUseId, resolved.tool.toolName);
          return;
        }
        if (status === 'completed' || status === 'failed') {
          const output =
            update.rawOutput ?? extractTextContent(update.content ?? null) ?? null;
          await this.emitToolCompletedIfNeeded({
            toolUseId,
            toolName: resolved.tool.toolName,
            output,
            isError: status === 'failed',
          });
        }
        return;
      }
      default:
        return;
    }
  }
}

function boundNdJsonInput(
  input: ReadableStream<Uint8Array>,
  maxLineBytes = ACP_STDOUT_LINE_LIMIT,
): ReadableStream<Uint8Array> {
  const reader = input.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const line = new Uint8Array(maxLineBytes);
  let lineBytes = 0;

  const validateLine = (): void => {
    if (lineBytes === 0) return;
    const text = decoder.decode(line.subarray(0, lineBytes)).trim();
    if (!text) return;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error('ACP stdout contains malformed JSON.');
    }
    if (value === null || typeof value !== 'object') {
      throw new Error('ACP stdout record must be a JSON object or batch array.');
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          validateLine();
          controller.close();
          return;
        }
        for (const byte of result.value) {
          if (byte === 0x0a) {
            validateLine();
            lineBytes = 0;
          } else {
            if (lineBytes >= maxLineBytes) {
              throw new Error(
                `ACP stdout record exceeds the ${maxLineBytes}-byte line limit.`,
              );
            }
            line[lineBytes] = byte;
            lineBytes += 1;
          }
        }
        controller.enqueue(result.value);
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout: () => void,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(message));
          onTimeout();
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function startAcpRun({
  child,
  context,
  publish,
  profile,
  trace,
}: AcpRunOptions): Promise<AcpRunHandle> {
  if (!child.stdin || !child.stdout) {
    throw new Error(`${profile.displayName} ACP process does not expose stdio.`);
  }

  const workspacePath = context.session.workspacePath.trim();
  if (
    !workspacePath ||
    !path.isAbsolute(workspacePath) ||
    !existsSync(workspacePath) ||
    !statSync(workspacePath).isDirectory()
  ) {
    throw new Error(
      `${profile.displayName} ACP workspace must be an existing absolute directory.`,
    );
  }

  let traceSequence = 0;
  const emitTrace = (
    kind: AcpTransportTraceKind,
    detail: Record<string, unknown> = {},
  ): void => {
    trace?.({
      sequence: ++traceSequence,
      timestamp: new Date().toISOString(),
      providerId: profile.providerId,
      kind,
      detail,
    });
  };

  const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
  const output = boundNdJsonInput(
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );
  const client = new CodeWaveAcpClient(context, publish, profile, emitTrace);
  const clientApp = createAcpClient({ name: 'codewave' })
    .onRequest(methods.client.session.requestPermission, ({ params }) =>
      client.requestPermission(params),
    )
    .onNotification(methods.client.session.update, ({ params }) =>
      client.sessionUpdate(params),
    );
  const connection: ClientConnection = clientApp.connect(
    ndJsonStream(input, output),
  );
  let cleanedUp = false;
  const cleanup = async (error?: unknown): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;
    connection.close(error);
    if (child.exitCode === null && !child.killed) child.kill();
    await Promise.race([
      connection.closed.catch(() => undefined),
      new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 250);
        timeout.unref?.();
      }),
    ]);
  };

  let initializeResult: InitializeResponse;
  let sessionResult: object;
  let sessionId: string;
  try {
    const initializeTimeoutMs = Math.min(
      30_000,
      Math.max(100, profile.initializeTimeoutMs ?? 5_000),
    );
    emitTrace('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      timeoutMs: initializeTimeoutMs,
    });
    initializeResult = await withTimeout(
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: {
          name: 'codewave',
          title: 'CodeWave',
          version: CODEWAVE_ACP_CLIENT_VERSION,
        },
      }),
      initializeTimeoutMs,
      `${profile.displayName} ACP initialize timed out.`,
      () => {
        connection.close(new Error('ACP initialize timeout'));
        if (child.exitCode === null && !child.killed) child.kill();
      },
    );
    if (initializeResult.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(
        `${profile.displayName} ACP selected incompatible protocol v${initializeResult.protocolVersion}; CodeWave requires v${PROTOCOL_VERSION}.`,
      );
    }
    const capabilities = initializeResult.agentCapabilities;
    const supportsResume = Boolean(capabilities?.sessionCapabilities?.resume);
    const supportsLoad = capabilities?.loadSession === true;
    emitTrace('initialize.complete', {
      protocolVersion: initializeResult.protocolVersion,
      agentName:
        typeof initializeResult.agentInfo?.name === 'string'
          ? initializeResult.agentInfo.name.slice(0, 128)
          : null,
      agentVersion:
        typeof initializeResult.agentInfo?.version === 'string'
          ? initializeResult.agentInfo.version.slice(0, 64)
          : null,
      continuity: supportsResume ? 'resume' : supportsLoad ? 'load' : 'none',
      authMethodCount: Array.isArray(initializeResult.authMethods)
        ? Math.min(initializeResult.authMethods.length, 32)
        : 0,
    });

    const existingSessionId = context.session.providerSessionId?.trim() || null;
    if (!existingSessionId) {
      emitTrace('session.new');
      sessionResult = await connection.agent.request(methods.agent.session.new, {
        cwd: workspacePath,
        mcpServers: [],
      });
    } else if (supportsResume) {
      emitTrace('session.resume', { providerSessionId: existingSessionId });
      sessionResult = await connection.agent.request(methods.agent.session.resume, {
        sessionId: existingSessionId,
        cwd: workspacePath,
        mcpServers: [],
      });
    } else if (supportsLoad) {
      emitTrace('session.load', { providerSessionId: existingSessionId });
      client.beginRestore(existingSessionId);
      sessionResult =
        (await connection.agent.request(methods.agent.session.load, {
          sessionId: existingSessionId,
          cwd: workspacePath,
          mcpServers: [],
        })) ?? {};
      await client.drainUpdates();
    } else {
      throw new Error(
        `${profile.displayName} ACP cannot restore this existing session; start a new CodeWave session.`,
      );
    }

    sessionId = getSessionId(sessionResult, existingSessionId);
    await context.updateSession({ providerSessionId: sessionId });
    emitTrace('session.persist', { providerSessionId: sessionId });
  } catch (error) {
    await cleanup(error);
    throw error;
  }

  let cancelled = false;
  let promptFinished = false;
  const promptCancellation = new AbortController();
  client.startPromptTurn(sessionId);
  emitTrace('prompt.start', { sessionId });
  const settled = connection.agent
    .request(
      methods.agent.session.prompt,
      {
        sessionId,
        prompt: [{ type: 'text', text: context.run.prompt }],
      },
      { cancellationSignal: promptCancellation.signal },
    )
    .then(async (result: PromptResponse) => {
      await client.drainUpdates();
      client.finishPromptTurn();
      const usage = extractUsage(result);
      if (cancelled || result.stopReason === 'cancelled') {
        cancelled = true;
        emitTrace('prompt.complete', { stopReason: result.stopReason });
        await publish('run.cancelled', { reason: 'Cancelled by user.', usage });
        return;
      }
      if (result.stopReason !== 'end_turn') {
        emitTrace('prompt.fail', { stopReason: result.stopReason });
        await publish('run.failed', {
          message: `${profile.displayName} ACP run stopped with ${result.stopReason}.`,
          usage,
        });
        return;
      }

      const message = client.getAssistantMessage();
      if (message) {
        await publish('message.created', { role: 'assistant', content: message });
      }
      emitTrace('prompt.complete', { stopReason: result.stopReason });
      await publish('run.completed', {
        result: message,
        usage,
        capabilities: initializeResult.agentCapabilities ?? {},
      });
    })
    .catch(async (error) => {
      client.finishPromptTurn();
      emitTrace('prompt.fail', {
        cancelled,
        message: error instanceof Error ? error.message : String(error),
      });
      if (!cancelled) {
        await publish('run.failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      } else {
        await publish('run.cancelled', { reason: 'Cancelled by user.' });
      }
    })
    .finally(async () => {
      promptFinished = true;
      await cleanup();
    });
  void settled.catch(() => undefined);

  return {
    settled,
    cancel: async () => {
      if (cancelled) return;
      cancelled = true;
      const graceMs = Math.max(0, profile.cancelGraceMs ?? 1500);
      emitTrace('cancel.request', { sessionId, graceMs });
      try {
        await connection.agent.notify(methods.agent.session.cancel, { sessionId });
      } catch {
        // The bounded terminal path below remains authoritative.
      }
      await Promise.race([
        settled.catch(() => undefined),
        new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, graceMs);
          timeout.unref?.();
        }),
      ]);
      if (!promptFinished) {
        await publish('run.cancelled', { reason: 'Cancelled by user.' });
        promptCancellation.abort();
        await cleanup(new Error('ACP prompt cancellation timed out'));
      }
      emitTrace('cancel.complete', { sessionId });
    },
  };
}
