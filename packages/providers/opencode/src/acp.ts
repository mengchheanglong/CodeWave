import { randomUUID } from 'node:crypto';
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
import type {
  ProviderApprovalDecision,
  ProviderRunContext,
  RoutingToolRequirement,
  ToolDescriptorSource,
  WorkbenchEvent,
} from '@qwemini/protocol';
import { inferRoutingToolRequirement } from '@qwemini/protocol';

type Publish = (
  type: WorkbenchEvent['type'],
  payload: Record<string, unknown>,
) => Promise<void>;

type OpenCodeAcpBridgeOptions = {
  child: ChildProcess;
  context: ProviderRunContext;
  publish: Publish;
};

type ToolState = 'requested' | 'started' | 'completed' | 'failed';
type TrackedTool = {
  toolName: string;
  input: Record<string, unknown>;
  status: ToolState;
};

const TOOL_REQUIREMENT_MAP: Record<string, RoutingToolRequirement> = {
  bash: 'shell',
  read: 'workspace-read',
  glob: 'workspace-read',
  grep: 'workspace-read',
  write: 'workspace-write',
  edit: 'workspace-write',
  webfetch: 'network',
  websearch: 'network',
};

function extractTextContent(
  content: Array<{ type?: string; content?: { type?: string; text?: string } }> | null | undefined,
): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((entry) => {
      if (entry.type !== 'content') {
        return '';
      }

      return entry.content?.type === 'text' ? entry.content.text ?? '' : '';
    })
    .filter(Boolean)
    .join('\n');
}

function selectPermissionOption(
  options: PermissionOption[],
  decision: ProviderApprovalDecision,
): PermissionOption | null {
  const preferredKind =
    decision.behavior === 'allow' ? 'allow_once' : 'reject_once';
  return (
    options.find((option) => option.kind === preferredKind) ??
    options[0] ??
    null
  );
}

function extractUsage(result: PromptResponse): Record<string, unknown> {
  if (result.usage && typeof result.usage === 'object') {
    return result.usage as Record<string, unknown>;
  }

  if (result._meta && typeof result._meta === 'object') {
    const quota = (result._meta as Record<string, unknown>).quota;
    if (quota && typeof quota === 'object') {
      return quota as Record<string, unknown>;
    }
  }

  return {};
}

function inferRequirementFromToolName(
  toolName: string,
  input: Record<string, unknown>,
): RoutingToolRequirement | null {
  return (
    TOOL_REQUIREMENT_MAP[toolName.trim().toLowerCase()] ??
    inferRoutingToolRequirement({
      toolName,
      input,
    })
  );
}

function inferSourceFromRequirement(
  requirement: RoutingToolRequirement,
): ToolDescriptorSource {
  return requirement === 'mcp' ? 'mcp' : 'provider';
}

class OpenCodeAcpClient implements Client {
  private assistantBuffer = '';
  private readonly tools = new Map<string, TrackedTool>();
  private readonly registeredTools = new Set<string>();
  private captureUpdates = false;
  private lastNotificationAt = 0;

  constructor(
    private readonly context: ProviderRunContext,
    private readonly publish: Publish,
  ) {}

  getAssistantMessage(): string {
    return this.assistantBuffer.trim();
  }

  beginRestore(): void {
    this.captureUpdates = false;
    this.assistantBuffer = '';
    this.tools.clear();
    this.registeredTools.clear();
    this.lastNotificationAt = Date.now();
  }

  startPromptTurn(): void {
    this.captureUpdates = true;
    this.assistantBuffer = '';
    this.tools.clear();
    this.registeredTools.clear();
  }

  finishPromptTurn(): void {
    this.captureUpdates = false;
  }

  async waitForQuietPeriod(
    quietMs = 400,
    timeoutMs = 5000,
  ): Promise<void> {
    const startedAt = Date.now();
    if (this.lastNotificationAt === 0) {
      this.lastNotificationAt = startedAt;
    }

    while (Date.now() - startedAt < timeoutMs) {
      const idleForMs = Date.now() - this.lastNotificationAt;
      if (idleForMs >= quietMs) {
        return;
      }

      const remainingMs = Math.max(quietMs - idleForMs, 25);
      await new Promise((resolve) => setTimeout(resolve, Math.min(remainingMs, 100)));
    }
  }

  private getToolKey(toolUseId: string | null, toolName: string): string {
    return toolUseId ?? toolName;
  }

  private resolveTool(
    toolUseId: string | null,
    toolName: string | null | undefined,
    input: Record<string, unknown> | null | undefined,
  ): { key: string; toolName: string; input: Record<string, unknown>; status?: ToolState } {
    const fallbackName = toolName || 'unknown';
    const key = this.getToolKey(toolUseId, fallbackName);
    const existing = this.tools.get(key);
    const next: TrackedTool = {
      toolName: toolName || existing?.toolName || 'unknown',
      input:
        input && Object.keys(input).length > 0 ? input : (existing?.input ?? {}),
      status: existing?.status ?? 'requested',
    };
    this.tools.set(key, next);
    return { key, toolName: next.toolName, input: next.input, status: existing?.status };
  }

  private async emitToolRequestedIfNeeded(
    toolUseId: string | null,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    const tool = this.resolveTool(toolUseId, toolName, input);
    if (tool.status) {
      return;
    }

    await this.publish('tool.requested', {
      toolUseId,
      toolName: tool.toolName,
      input: tool.input,
    });
    this.tools.set(tool.key, {
      toolName: tool.toolName,
      input: tool.input,
      status: 'requested',
    });
  }

  private async emitToolStartedIfNeeded(
    toolUseId: string | null,
    toolName: string,
  ): Promise<void> {
    const tool = this.resolveTool(toolUseId, toolName, null);
    if (
      tool.status === 'started' ||
      tool.status === 'completed' ||
      tool.status === 'failed'
    ) {
      return;
    }

    await this.publish('tool.started', {
      toolUseId,
      toolName: tool.toolName,
    });
    this.tools.set(tool.key, {
      toolName: tool.toolName,
      input: tool.input,
      status: 'started',
    });
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
    if (!normalizedName) {
      return;
    }

    const registrationKey = normalizedName.toLowerCase();
    if (this.registeredTools.has(registrationKey)) {
      return;
    }

    const requirement = inferRequirementFromToolName(normalizedName, input);
    if (!requirement) {
      return;
    }

    this.registeredTools.add(registrationKey);
    await this.publish('tool.registered', {
      toolUseId,
      toolName: normalizedName,
      requirement,
      source: inferSourceFromRequirement(requirement),
      input,
      detail: 'OpenCode ACP runtime reported this connected tool through session metadata.',
      metadata: {
        confirmedBy: 'provider-runtime',
        providerSurface,
        ...(metadata ?? {}),
      },
    });
  }

  async requestPermission(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const toolName = params.toolCall.title || 'unknown';
    const toolUseId = params.toolCall.toolCallId ?? null;
    const input =
      params.toolCall.rawInput && typeof params.toolCall.rawInput === 'object'
        ? (params.toolCall.rawInput as Record<string, unknown>)
        : {};
    const metadata: Record<string, unknown> = {
      permissionOptions: params.options.map((option) => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind,
      })),
    };

    await this.emitToolRegisteredIfNeeded({
      toolUseId,
      toolName,
      input,
      providerSurface: 'opencode.acp.request_permission',
      metadata: {
        permissionOptionCount: params.options.length,
      },
    });

    await this.emitToolRequestedIfNeeded(toolUseId, toolName, input);

    const decision = await this.context.requestApproval({
      toolName,
      toolUseId,
      input,
      metadata,
    });

    if (decision.behavior === 'deny') {
      const tool = this.resolveTool(toolUseId, toolName, input);
      this.tools.set(tool.key, {
        toolName: tool.toolName,
        input: tool.input,
        status: 'failed',
      });
      await this.publish('tool.denied', {
        toolUseId,
        toolName: tool.toolName,
        input: tool.input,
        detail: decision.message ?? 'Tool execution denied in Qwemini.',
      });
    } else {
      await this.emitToolStartedIfNeeded(toolUseId, toolName);
    }

    const option = selectPermissionOption(params.options, decision);
    if (!option) {
      return {
        outcome: {
          outcome: 'cancelled',
        },
      };
    }

    return {
      outcome: {
        outcome: 'selected',
        optionId: option.optionId,
      },
    };
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    this.lastNotificationAt = Date.now();

    if (!this.captureUpdates) {
      return;
    }

    const update = params.update;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const text =
          update.content.type === 'text' ? update.content.text ?? '' : '';
        if (text) {
          this.assistantBuffer += text;
          await this.publish('run.output.delta', {
            stream: 'assistant',
            text,
          });
        }
        return;
      }

      case 'agent_thought_chunk': {
        const text =
          update.content.type === 'text' ? update.content.text ?? '' : '';
        if (text) {
          await this.publish('run.output.delta', {
            stream: 'assistant',
            text,
          });
        }
        return;
      }

      case 'tool_call': {
        const toolUseId = update.toolCallId ?? null;
        const tool = this.resolveTool(
          toolUseId,
          update.title || null,
          update.rawInput && typeof update.rawInput === 'object'
            ? (update.rawInput as Record<string, unknown>)
            : null,
        );
        const input =
          update.rawInput && typeof update.rawInput === 'object'
            ? (update.rawInput as Record<string, unknown>)
            : tool.input;
        await this.emitToolRegisteredIfNeeded({
          toolUseId,
          toolName: tool.toolName,
          input,
          providerSurface: 'opencode.acp.session_update.tool_call',
          metadata: {
            sessionUpdate: 'tool_call',
            status: update.status ?? 'pending',
          },
        });
        await this.emitToolRequestedIfNeeded(toolUseId, tool.toolName, input);

        const status = update.status ?? 'pending';
        if (status === 'in_progress') {
          await this.emitToolStartedIfNeeded(toolUseId, tool.toolName);
          return;
        }

        if (status === 'completed' || status === 'failed') {
          await this.emitToolStartedIfNeeded(toolUseId, tool.toolName);
          const output =
            update.rawOutput ??
            extractTextContent(update.content ?? null) ??
            null;
          const isError = status === 'failed';
          await this.publish('tool.completed', {
            toolUseId,
            toolName: tool.toolName,
            isError,
            output,
            detail:
              isError && typeof output === 'string'
                ? output
                : isError
                  ? 'OpenCode ACP tool call failed.'
                  : null,
          });
          this.tools.set(tool.key, {
            toolName: tool.toolName,
            input: tool.input,
            status: isError ? 'failed' : 'completed',
          });
        }
        return;
      }

      case 'tool_call_update': {
        const toolUseId = update.toolCallId ?? null;
        const status = update.status ?? null;
        const tool = this.resolveTool(
          toolUseId,
          update.title || null,
          update.rawInput && typeof update.rawInput === 'object'
            ? (update.rawInput as Record<string, unknown>)
            : null,
        );
        const previous = tool.status;
        const output =
          update.rawOutput ??
          extractTextContent(update.content ?? null) ??
          null;

        await this.emitToolRegisteredIfNeeded({
          toolUseId,
          toolName: tool.toolName,
          input: tool.input,
          providerSurface: 'opencode.acp.session_update.tool_call_update',
          metadata: {
            sessionUpdate: 'tool_call_update',
            status: update.status ?? null,
          },
        });

        await this.emitToolRequestedIfNeeded(toolUseId, tool.toolName, tool.input);

        if (status === 'in_progress' && previous !== 'started') {
          await this.publish('tool.started', {
            toolUseId,
            toolName: tool.toolName,
          });
          this.tools.set(tool.key, {
            toolName: tool.toolName,
            input: tool.input,
            status: 'started',
          });
          return;
        }

        if (status === 'completed') {
          await this.emitToolStartedIfNeeded(toolUseId, tool.toolName);
          await this.publish('tool.completed', {
            toolUseId,
            toolName: tool.toolName,
            isError: false,
            output,
            detail: null,
          });
          this.tools.set(tool.key, {
            toolName: tool.toolName,
            input: tool.input,
            status: 'completed',
          });
          return;
        }

        if (status === 'failed') {
          await this.emitToolStartedIfNeeded(toolUseId, tool.toolName);
          await this.publish('tool.completed', {
            toolUseId,
            toolName: tool.toolName,
            isError: true,
            output,
            detail:
              typeof output === 'string' && output
                ? output
                : 'OpenCode ACP tool call failed.',
          });
          this.tools.set(tool.key, {
            toolName: tool.toolName,
            input: tool.input,
            status: 'failed',
          });
        }
        return;
      }

      default:
        return;
    }
  }
}

export type OpenCodeAcpRunHandle = {
  cancel: () => Promise<void>;
};

export async function startOpenCodeAcpRun({
  child,
  context,
  publish,
}: OpenCodeAcpBridgeOptions): Promise<OpenCodeAcpRunHandle> {
  if (!child.stdin || !child.stdout) {
    throw new Error('OpenCode ACP process does not expose stdio.');
  }

  const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
  const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(input, output);
  const client = new OpenCodeAcpClient(context, publish);
  const connection = new ClientSideConnection(() => client, stream);

  const initializeResult = await connection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
  });
  const supportsResume = Boolean(
    initializeResult.agentCapabilities?.sessionCapabilities?.resume,
  );

  const sessionResult = context.session.providerSessionId
    ? supportsResume
      ? await connection.unstable_resumeSession({
          sessionId: context.session.providerSessionId,
          cwd: context.session.workspacePath,
          mcpServers: [],
        })
      : await (async () => {
          client.beginRestore();
          const loaded = await connection.loadSession({
            sessionId: context.session.providerSessionId,
            cwd: context.session.workspacePath,
            mcpServers: [],
          });
          await client.waitForQuietPeriod();
          return loaded;
        })()
    : await connection.newSession({
        cwd: context.session.workspacePath,
        mcpServers: [],
      });

  await context.updateSession({
    providerSessionId:
      'sessionId' in sessionResult && typeof sessionResult.sessionId === 'string'
        ? sessionResult.sessionId
        : context.session.providerSessionId,
  });

  let cancelled = false;
  const sessionId =
    ('sessionId' in sessionResult && typeof sessionResult.sessionId === 'string'
      ? sessionResult.sessionId
      : context.session.providerSessionId) ?? context.session.id;

  client.startPromptTurn();
  const promptPromise = connection.prompt({
    sessionId,
    prompt: [
      {
        type: 'text',
        text: context.run.prompt,
      },
    ],
  });

  void promptPromise
    .then(async (result: PromptResponse) => {
      client.finishPromptTurn();
      const usage = extractUsage(result);
      if (result.stopReason === 'cancelled') {
        cancelled = true;
        await publish('run.cancelled', {
          reason: 'Cancelled by user.',
          usage,
        });
        return;
      }

      if (result.stopReason !== 'end_turn') {
        await publish('run.failed', {
          message: `OpenCode ACP run stopped with ${result.stopReason}.`,
          usage,
        });
        return;
      }

      const message = client.getAssistantMessage();
      if (message) {
        await publish('message.created', {
          role: 'assistant',
          content: message,
        });
      }

      await publish('run.completed', {
        result: message,
        usage,
        capabilities: initializeResult.agentCapabilities ?? {},
      });
    })
    .catch(async (error) => {
      client.finishPromptTurn();
      if (cancelled) {
        return;
      }

      await publish('run.failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });

  return {
    cancel: async () => {
      cancelled = true;
      try {
        await connection.cancel({ sessionId });
      } catch {
        child.kill();
      }
    },
  };
}
