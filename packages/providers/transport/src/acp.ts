import type { ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
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
  restoreQuietMs?: number;
  restoreTimeoutMs?: number;
  cancelGraceMs?: number;
};

export type AcpTransportTraceKind =
  | 'initialize'
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
  const preferredKinds =
    decision.behavior === 'allow'
      ? ['allow_once', 'allow_always']
      : ['reject_once', 'reject_always'];

  return (
    preferredKinds
      .map((kind) => options.find((option) => option.kind === kind))
      .find((option): option is PermissionOption => Boolean(option)) ??
    options[0] ??
    null
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
  context: ProviderRunContext,
): string {
  return (
    ('sessionId' in sessionResult &&
    typeof sessionResult.sessionId === 'string' &&
    sessionResult.sessionId
      ? sessionResult.sessionId
      : context.session.providerSessionId) ?? context.session.id
  );
}

class CodeWaveAcpClient implements Client {
  private assistantBuffer = '';
  private readonly tools = new Map<string, TrackedTool>();
  private readonly registeredTools = new Set<string>();
  private captureUpdates = false;
  private lastNotificationAt = 0;
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
    return this.assistantBuffer.trim();
  }

  beginRestore(): void {
    this.captureUpdates = false;
    this.resetTurnState();
    this.lastNotificationAt = Date.now();
  }

  startPromptTurn(): void {
    this.captureUpdates = true;
    this.resetTurnState();
  }

  finishPromptTurn(): void {
    this.captureUpdates = false;
  }

  async drainUpdates(): Promise<void> {
    await this.updateChain;
  }

  async waitForQuietPeriod(): Promise<void> {
    const quietMs = Math.max(0, this.profile.restoreQuietMs ?? 400);
    const timeoutMs = Math.max(quietMs, this.profile.restoreTimeoutMs ?? 5000);
    const startedAt = Date.now();
    if (this.lastNotificationAt === 0) this.lastNotificationAt = startedAt;

    while (Date.now() - startedAt < timeoutMs) {
      const idleForMs = Date.now() - this.lastNotificationAt;
      if (idleForMs >= quietMs) return;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(Math.max(quietMs - idleForMs, 25), 100)),
      );
    }
  }

  private resetTurnState(): void {
    this.assistantBuffer = '';
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
    if (decision.behavior === 'deny') {
      if (!resolved.tool.terminal) {
        await this.publish('tool.denied', {
          toolUseId,
          toolName: resolved.tool.toolName,
          input: resolved.tool.input,
          detail: decision.message ?? 'Tool execution denied in CodeWave.',
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
    this.lastNotificationAt = Date.now();
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
          this.assistantBuffer += text;
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
  const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
  const client = new CodeWaveAcpClient(context, publish, profile, emitTrace);
  const clientConnection = new ClientSideConnection(() => client, ndJsonStream(input, output));

  emitTrace('initialize');
  const initializeResult = await clientConnection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
  });
  const supportsResume = Boolean(
    initializeResult.agentCapabilities?.sessionCapabilities?.resume,
  );

  let sessionResult: object;
  if (!context.session.providerSessionId) {
    emitTrace('session.new');
    sessionResult = await clientConnection.newSession({
      cwd: context.session.workspacePath,
      mcpServers: [],
    });
  } else if (supportsResume) {
    emitTrace('session.resume', {
      providerSessionId: context.session.providerSessionId,
    });
    sessionResult = await clientConnection.unstable_resumeSession({
      sessionId: context.session.providerSessionId,
      cwd: context.session.workspacePath,
      mcpServers: [],
    });
  } else {
    emitTrace('session.load', {
      providerSessionId: context.session.providerSessionId,
    });
    client.beginRestore();
    sessionResult = await clientConnection.loadSession({
      sessionId: context.session.providerSessionId,
      cwd: context.session.workspacePath,
      mcpServers: [],
    });
    await client.waitForQuietPeriod();
  }

  const sessionId = getSessionId(sessionResult, context);
  await context.updateSession({ providerSessionId: sessionId });
  emitTrace('session.persist', { providerSessionId: sessionId });

  let cancelled = false;
  client.startPromptTurn();
  emitTrace('prompt.start', { sessionId });
  const settled = clientConnection
    .prompt({
      sessionId,
      prompt: [{ type: 'text', text: context.run.prompt }],
    })
    .then(async (result: PromptResponse) => {
      await client.drainUpdates();
      client.finishPromptTurn();
      const usage = extractUsage(result);
      if (result.stopReason === 'cancelled') {
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
      }
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
        await Promise.race([
          clientConnection.cancel({ sessionId }),
          new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, graceMs);
            timeout.unref?.();
          }),
        ]);
      } catch {
        // The normalized cancellation event below remains authoritative.
      }
      await publish('run.cancelled', { reason: 'Cancelled by user.' });
      if (child.exitCode === null && !child.killed) child.kill();
      emitTrace('cancel.complete', { sessionId });
    },
  };
}
