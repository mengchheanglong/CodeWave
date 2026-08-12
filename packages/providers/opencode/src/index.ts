import { randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderConnectedTool,
  ProviderConnectedToolQuery,
  ProviderHealth,
  ProviderRunContext,
  ProviderRunHandle,
  ProviderToolCapability,
  RoutingToolRequirement,
  ToolDescriptorSource,
  WorkbenchEvent,
} from '@qwemini/protocol';
import { inferRoutingToolRequirement } from '@qwemini/protocol';
import { startOpenCodeAcpRun, type OpenCodeAcpRunHandle } from './acp.js';

type CommandResult = {
  code: number | null;
  output: string;
  errorMessage: string | null;
};

type OpenCodeMode = 'acp' | 'run';

type OpenCodeLaunchSpec = {
  command: string;
  shell: boolean;
  description: string;
  source: 'override' | 'external';
};

type OpenCodeCliProviderOptions = {
  command?: string;
  rootPath?: string;
};

const DEFAULT_CONNECTED_TOOL_PROBE_TIMEOUT_MS = 2500;

const OPENCODE_ACP_CAPABILITIES: ProviderCapabilities = {
  daemonApprovalMediation: true,
  resumableSessions: true,
  checkpointEvents: false,
};

const OPENCODE_RUN_CAPABILITIES: ProviderCapabilities = {
  daemonApprovalMediation: false,
  resumableSessions: true,
  checkpointEvents: false,
};

const OPENCODE_TOOL_CATALOG: ProviderToolCapability[] = [
  {
    name: 'bash',
    requirement: 'shell',
    source: 'provider',
    permissionModel: 'ask',
    detail: 'OpenCode executes shell commands through its bash tool in non-interactive runs.',
  },
  {
    name: 'read',
    requirement: 'workspace-read',
    source: 'provider',
    permissionModel: 'auto',
    detail: 'OpenCode reads file contents through its read tool.',
  },
  {
    name: 'glob',
    requirement: 'workspace-read',
    source: 'provider',
    permissionModel: 'auto',
    detail: 'OpenCode matches file patterns through its glob tool.',
  },
  {
    name: 'grep',
    requirement: 'workspace-read',
    source: 'provider',
    permissionModel: 'auto',
    detail: 'OpenCode searches file contents through its grep tool.',
  },
  {
    name: 'write',
    requirement: 'workspace-write',
    source: 'provider',
    permissionModel: 'ask',
    detail: 'OpenCode writes file contents through its write tool.',
  },
  {
    name: 'edit',
    requirement: 'workspace-write',
    source: 'provider',
    permissionModel: 'ask',
    detail: 'OpenCode edits file contents through its edit tool.',
  },
  {
    name: 'webfetch',
    requirement: 'network',
    source: 'provider',
    permissionModel: 'ask',
    detail: 'OpenCode fetches web content through its webfetch tool.',
  },
  {
    name: 'websearch',
    requirement: 'network',
    source: 'provider',
    permissionModel: 'ask',
    detail: 'OpenCode searches the web through its websearch tool.',
  },
];

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

type McpListProbeStatus = 'failed' | 'timeout' | 'empty' | 'configured';

type OpenCodeToolState = {
  status?: string;
  input?: unknown;
  output?: unknown;
  title?: string;
  metadata?: Record<string, unknown>;
  time?: { start?: number; end?: number };
};

type OpenCodePart = {
  id: string;
  sessionID?: string;
  messageID?: string;
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: OpenCodeToolState;
  reason?: string;
  snapshot?: string;
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  time?: { start?: number; end?: number };
};

type OpenCodeJsonEvent = {
  type: string;
  timestamp?: number;
  sessionID?: string;
  part?: OpenCodePart;
  error?: {
    name?: string;
    data?: { message?: string; [key: string]: unknown };
  };
};

function getConnectedToolProbeTimeoutMs(): number {
  const configured = Number(process.env.QWEMINI_CONNECTED_TOOL_PROBE_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_CONNECTED_TOOL_PROBE_TIMEOUT_MS;
  }

  return Math.max(250, Math.trunc(configured));
}

function resolveMode(): OpenCodeMode {
  const configured = String(process.env.QWEMINI_OPENCODE_MODE ?? '').trim();
  return configured === 'run' ? 'run' : 'acp';
}

function getAutoApproveEnabled(): boolean {
  const configured = String(process.env.QWEMINI_OPENCODE_AUTO ?? '').trim();
  return configured === '1' || configured.toLowerCase() === 'true';
}

function getModelOverride(): string | null {
  const configured = String(process.env.QWEMINI_OPENCODE_MODEL ?? '').trim();
  return configured || null;
}

function isTimeoutCommandResult(result: CommandResult): boolean {
  return (
    result.code === null &&
    typeof result.errorMessage === 'string' &&
    /timed out/i.test(result.errorMessage)
  );
}

function applyMcpListProbeMetadata(
  tools: ProviderConnectedTool[],
  status: McpListProbeStatus,
  detail: string | null,
): ProviderConnectedTool[] {
  return tools.map((tool) => ({
    ...tool,
    metadata: {
      ...(tool.metadata ?? {}),
      mcpListProbeStatus: status,
      mcpListProbeSurface: 'opencode.mcp.list',
      ...(detail ? { mcpListProbeDetail: detail } : {}),
    },
  }));
}

function parseConfiguredMcpServers(output: string): string[] {
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) {
        return false;
      }
      if (/^Loaded cached credentials\.?$/i.test(line)) {
        return false;
      }
      if (/^(Configured MCP servers|MCP servers|Name|Server|ID)/i.test(line)) {
        return false;
      }
      return true;
    })
    .map((line) =>
      line
        .replace(/^[\-\*\d\.\)\s]+/, '')
        .split(/\s+/)[0] ?? line,
    )
    .filter((name) => /^[a-zA-Z0-9_-]+$/.test(name))
    .filter(Boolean);
}

function inferRequirementFromToolName(
  toolName: string,
): RoutingToolRequirement | null {
  return TOOL_REQUIREMENT_MAP[toolName] ?? inferRoutingToolRequirement({ toolName });
}

function inferSourceFromRequirement(
  requirement: RoutingToolRequirement,
): ToolDescriptorSource {
  return requirement === 'mcp' ? 'mcp' : 'provider';
}

function createEvent(
  context: ProviderRunContext,
  type: WorkbenchEvent['type'],
  payload: Record<string, unknown>,
): WorkbenchEvent {
  return {
    id: randomUUID(),
    sessionId: context.session.id,
    runId: context.run.id,
    timestamp: new Date().toISOString(),
    source: 'opencode',
    type,
    payload,
  };
}

async function syncProviderSessionId(
  context: ProviderRunContext,
  state: { providerSessionId: string | null },
  providerSessionId: string | null | undefined,
): Promise<void> {
  const nextProviderSessionId =
    typeof providerSessionId === 'string' && providerSessionId.length > 0
      ? providerSessionId
      : null;
  if (!nextProviderSessionId || nextProviderSessionId === state.providerSessionId) {
    return;
  }

  state.providerSessionId = nextProviderSessionId;
  await context.updateSession({
    providerSessionId: nextProviderSessionId,
  });
}

function normalizeWindowsPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function resolveWindowsExeInvocation(
  spec: OpenCodeLaunchSpec,
): { command: string; shell: boolean } | null {
  if (process.platform !== 'win32') {
    return null;
  }

  const executable = spec.command.trim();
  const basename = path.basename(executable).toLowerCase();
  if (
    basename !== 'opencode' &&
    basename !== 'opencode.cmd' &&
    basename !== 'opencode.exe' &&
    basename !== 'opencode.sh'
  ) {
    return null;
  }

  if (/\.exe$/i.test(executable)) {
    const normalizedExe = normalizeWindowsPath(executable);
    if (existsSync(normalizedExe)) {
      return { command: normalizedExe, shell: false };
    }
  }

  let shimPath = executable;
  if (!/^[a-zA-Z]:[\\/]|^\\\\/.test(shimPath)) {
    const lookup = spawnSync('where.exe', [executable], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    const candidates = (lookup.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const candidate of candidates) {
      const normalizedCandidate = normalizeWindowsPath(candidate);
      if (/\.exe$/i.test(normalizedCandidate) && existsSync(normalizedCandidate)) {
        return { command: normalizedCandidate, shell: false };
      }
    }
    shimPath = candidates[0] ?? executable;
  }

  if (!/\.(exe|cmd|bat)$/i.test(shimPath)) {
    const exeCandidate = normalizeWindowsPath(
      path.join(
        path.dirname(shimPath),
        'node_modules',
        'opencode-ai',
        'bin',
        'opencode.exe',
      ),
    );
    if (existsSync(exeCandidate)) {
      return { command: exeCandidate, shell: false };
    }
  }

  return null;
}

function buildSpawnSpec(spec: OpenCodeLaunchSpec): {
  command: string;
  shell: boolean;
  description: string;
} {
  const resolved = resolveWindowsExeInvocation(spec);
  if (resolved) {
    return {
      command: resolved.command,
      shell: false,
      description: `${spec.description} via direct executable`,
    };
  }

  return {
    command: spec.command,
    shell: spec.shell,
    description: spec.description,
  };
}

async function runCommand(
  spec: OpenCodeLaunchSpec,
  args: string[],
  timeoutMs = 0,
): Promise<CommandResult> {
  const spawnSpec = buildSpawnSpec(spec);
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(spawnSpec.command, args, {
      env: process.env,
      shell: spawnSpec.shell,
      windowsHide: true,
    });

    let output = '';
    const resolveOnce = (result: CommandResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    const timeout =
      timeoutMs > 0
        ? setTimeout(() => {
            if (child.exitCode === null && !child.killed) {
              child.kill();
            }

            resolveOnce({
              code: null,
              output: output.trim(),
              errorMessage: `Command timed out after ${timeoutMs}ms.`,
            });
          }, timeoutMs)
        : null;

    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('error', (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      resolveOnce({
        code: null,
        output: output.trim(),
        errorMessage: error.message,
      });
    });

    child.on('close', (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      resolveOnce({
        code,
        output: output.trim(),
        errorMessage: null,
      });
    });
  });
}

function describeRuntime(spec: OpenCodeLaunchSpec, versionLabel: string): string {
  return `OpenCode CLI ${versionLabel} ready (${spec.description}).`;
}

async function probeCommandForMode(
  spec: OpenCodeLaunchSpec,
  mode: OpenCodeMode,
): Promise<ProviderHealth> {
  const capabilities =
    mode === 'acp' ? OPENCODE_ACP_CAPABILITIES : OPENCODE_RUN_CAPABILITIES;
  const version = await runCommand(spec, ['--version']);
  if (version.code !== 0) {
    return {
      providerId: 'opencode',
      available: false,
      detail:
        version.errorMessage ??
        version.output ??
        `OpenCode CLI is not available (${spec.description}).`,
      capabilities,
    };
  }

  const versionLabel = version.output.split(/\r?\n/, 1)[0]?.trim() || 'unknown';
  const modeLabel = mode === 'acp' ? 'ACP mode' : 'run JSON mode';

  return {
    providerId: 'opencode',
    available: true,
    detail: `${describeRuntime(spec, versionLabel)} (${modeLabel}). Model providers must be configured through 'opencode auth login' or provider API keys.`,
    capabilities,
  };
}

export class OpenCodeCliProvider implements ProviderAdapter {
  readonly id = 'opencode';
  readonly displayName = 'OpenCode CLI';

  private readonly commandOverride: string | null;
  private readonly rootPath: string;
  private readonly mode: OpenCodeMode;

  constructor(options: OpenCodeCliProviderOptions = {}) {
    const commandOverride = options.command ?? process.env.QWEMINI_OPENCODE_COMMAND;
    this.commandOverride = commandOverride?.trim() || null;
    this.rootPath = path.resolve(options.rootPath ?? process.cwd());
    this.mode = resolveMode();
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return this.mode === 'acp'
      ? OPENCODE_ACP_CAPABILITIES
      : OPENCODE_RUN_CAPABILITIES;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return probeCommandForMode(this.resolveLaunchSpec(), this.mode);
  }

  async toolCatalog(): Promise<ProviderToolCapability[]> {
    return OPENCODE_TOOL_CATALOG;
  }

  async enumerateConnectedTools(
    _query: ProviderConnectedToolQuery,
  ): Promise<ProviderConnectedTool[]> {
    const launchSpec = this.resolveLaunchSpec();
    const connected: ProviderConnectedTool[] = OPENCODE_TOOL_CATALOG.map((tool) => ({
      name: tool.name,
      requirement: tool.requirement,
      source: tool.source,
      detail: tool.detail,
      metadata: {
        confirmedBy: 'provider-cli',
        providerSurface: 'opencode.toolCatalog',
      },
    }));

    const mcp = await runCommand(
      launchSpec,
      ['mcp', 'list'],
      getConnectedToolProbeTimeoutMs(),
    );
    if (mcp.code !== 0) {
      const probeStatus: McpListProbeStatus = isTimeoutCommandResult(mcp)
        ? 'timeout'
        : 'failed';
      return applyMcpListProbeMetadata(
        connected,
        probeStatus,
        mcp.errorMessage ??
          mcp.output ??
          `opencode mcp list exited with code ${mcp.code ?? 'unknown'}.`,
      );
    }

    const servers = parseConfiguredMcpServers(mcp.output);
    if (servers.length === 0) {
      return applyMcpListProbeMetadata(
        connected,
        'empty',
        'OpenCode CLI reported no configured MCP servers.',
      );
    }

    const withMcpProbe = applyMcpListProbeMetadata(
      connected,
      'configured',
      'OpenCode CLI reported configured MCP servers.',
    );

    withMcpProbe.push({
      name: 'mcp',
      requirement: 'mcp',
      source: 'mcp',
      detail:
        'OpenCode CLI reports configured MCP servers through `opencode mcp list` for this runtime.',
      metadata: {
        confirmedBy: 'provider-cli',
        providerSurface: 'opencode.mcp.list',
        servers,
        mcpListProbeStatus: 'configured',
        mcpListProbeSurface: 'opencode.mcp.list',
        mcpListProbeDetail: 'OpenCode CLI reported configured MCP servers.',
      },
    });

    return withMcpProbe;
  }

  async startRun(context: ProviderRunContext): Promise<ProviderRunHandle> {
    if (this.mode === 'acp') {
      return this.startAcpRun(context);
    }

    return this.startRunModeRun(context);
  }

  private async startAcpRun(
    context: ProviderRunContext,
  ): Promise<ProviderRunHandle> {
    const launchSpec = this.resolveLaunchSpec();
    const spawnSpec = buildSpawnSpec(launchSpec);

    let terminalEmitted = false;
    const publish = async (
      type: WorkbenchEvent['type'],
      payload: Record<string, unknown>,
    ): Promise<void> => {
      if (
        type === 'run.completed' ||
        type === 'run.failed' ||
        type === 'run.cancelled'
      ) {
        terminalEmitted = true;
      }

      await context.emitEvent(createEvent(context, type, payload));
    };

    const workspacePath = context.session.workspacePath.trim();
    if (!workspacePath || !existsSync(workspacePath)) {
      await publish('run.failed', {
        message: 'Workspace path does not exist',
        detail:
          workspacePath || 'The session workspace path is empty, so OpenCode cannot start.',
      });
      return { cancel: async () => {} };
    }

    const child = spawn(spawnSpec.command, ['acp'], {
      cwd: workspacePath,
      env: process.env,
      shell: spawnSpec.shell,
      windowsHide: true,
    });

    child.on('error', async (error) => {
      if (terminalEmitted) {
        return;
      }

      await publish('run.failed', {
        message: 'Failed to launch OpenCode ACP runtime',
        detail: `${spawnSpec.description}: ${error.message}`,
      });
    });

    child.on('close', async (code) => {
      if (terminalEmitted) {
        return;
      }

      await publish('run.failed', {
        message: 'OpenCode ACP runtime exited unexpectedly',
        detail: spawnSpec.description,
        exitCode: code,
      });
    });

    if (child.stderr) {
      readline
        .createInterface({ input: child.stderr })
        .on('line', (line) => {
          void publish('run.output.delta', {
            stream: 'stderr',
            text: line,
          });
        });
    }

    let acpHandle: OpenCodeAcpRunHandle | null = null;
    try {
      acpHandle = await startOpenCodeAcpRun({ child, context, publish });
    } catch (error) {
      if (terminalEmitted) {
        return { cancel: async () => {} };
      }

      child.kill();
      await publish('run.failed', {
        message: 'Failed to bootstrap OpenCode ACP session',
        detail: error instanceof Error ? error.message : String(error),
      });
      return { cancel: async () => {} };
    }

    return {
      cancel: async () => {
        if (acpHandle) {
          await acpHandle.cancel();
        } else if (child.exitCode === null && !child.killed) {
          child.kill();
        }
      },
    };
  }

  private async startRunModeRun(
    context: ProviderRunContext,
  ): Promise<ProviderRunHandle> {
    const seenToolRegistrations = new Set<string>();
    const textByMessageId = new Map<string, string>();
    const sessionState = {
      providerSessionId: context.session.providerSessionId,
    };
    let terminalEmitted = false;
    const launchSpec = this.resolveLaunchSpec();
    const spawnSpec = buildSpawnSpec(launchSpec);
    const modelOverride = getModelOverride();

    const workspacePath = context.session.workspacePath.trim();
    if (!workspacePath || !existsSync(workspacePath)) {
      const publish = async (event: WorkbenchEvent) => {
        await context.emitEvent(event);
      };
      await publish(
        createEvent(context, 'run.failed', {
          message: 'Workspace path does not exist',
          detail:
            workspacePath || 'The session workspace path is empty, so OpenCode cannot start.',
        }),
      );
      return { cancel: async () => {} };
    }

    const args = [
      'run',
      '--format',
      'json',
      ...(context.session.providerSessionId
        ? ['--session', context.session.providerSessionId]
        : []),
      ...(getAutoApproveEnabled() ? ['--auto'] : []),
      ...(modelOverride ? ['--model', modelOverride] : []),
      context.run.prompt,
    ];

    const child = spawn(spawnSpec.command, args, {
      cwd: context.session.workspacePath,
      env: process.env,
      shell: spawnSpec.shell,
      windowsHide: true,
    });

    const publish = async (
      type: WorkbenchEvent['type'],
      payload: Record<string, unknown>,
    ): Promise<void> => {
      if (
        type === 'run.completed' ||
        type === 'run.failed' ||
        type === 'run.cancelled'
      ) {
        terminalEmitted = true;
      }

      await context.emitEvent(createEvent(context, type, payload));
    };

    const emitTerminalCompletion = async (): Promise<void> => {
      const accumulatedText = [...textByMessageId.values()]
        .map((text) => text.trim())
        .filter(Boolean)
        .join('\n\n');
      if (accumulatedText) {
        await publish('message.created', {
          role: 'assistant',
          content: accumulatedText,
        });
      }
      textByMessageId.clear();

      await publish('run.completed', {
        result: accumulatedText,
      });
    };

    child.on('error', async (error) => {
      if (terminalEmitted) {
        return;
      }

      await publish('run.failed', {
        message: 'Failed to launch OpenCode runtime',
        detail: `${spawnSpec.description}: ${error.message}`,
      });
    });

    readline
      .createInterface({ input: child.stdout! })
      .on('line', (line) => {
        void this
          .handleStdoutLine({
            context,
            line,
            seenToolRegistrations,
            textByMessageId,
            publish,
            sessionState,
            emitTerminalCompletion,
          })
          .catch(async (error) => {
            await publish('run.output.delta', {
              stream: 'stderr',
              text: `OpenCode event bridge error: ${error instanceof Error ? error.message : String(error)}`,
            });
          });
      });

    readline
      .createInterface({ input: child.stderr! })
      .on('line', (line) => {
        void publish('run.output.delta', {
          stream: 'stderr',
          text: line,
        });
      });

    child.on('close', async (code) => {
      if (terminalEmitted) {
        return;
      }

      if (code === 0) {
        await emitTerminalCompletion();
        return;
      }

      await publish('run.failed', {
        message: 'OpenCode runtime exited unexpectedly',
        detail: spawnSpec.description,
        exitCode: code,
      });
    });

    return {
      cancel: async () => {
        if (terminalEmitted || child.exitCode !== null || child.killed) {
          return;
        }

        await new Promise<void>((resolve) => {
          child.kill();
          const timeout = setTimeout(() => {
            if (child.exitCode === null && !child.killed) {
              child.kill();
            }
            resolve();
          }, 1500);

          child.once('close', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      },
    };
  }

  private async handleStdoutLine({
    context,
    line,
    seenToolRegistrations,
    textByMessageId,
    publish,
    sessionState,
    emitTerminalCompletion,
  }: {
    context: ProviderRunContext;
    line: string;
    seenToolRegistrations: Set<string>;
    textByMessageId: Map<string, string>;
    publish: (
      type: WorkbenchEvent['type'],
      payload: Record<string, unknown>,
    ) => Promise<void>;
    sessionState: { providerSessionId: string | null };
    emitTerminalCompletion: () => Promise<void>;
  }): Promise<void> {
    if (!line.trim()) {
      return;
    }

    let event: OpenCodeJsonEvent;
    try {
      event = JSON.parse(line) as OpenCodeJsonEvent;
    } catch {
      await publish('run.output.delta', {
        stream: 'stdout',
        text: line,
      });
      return;
    }

    if (!event || typeof event.type !== 'string') {
      return;
    }

    await syncProviderSessionId(
      context,
      sessionState,
      event.sessionID || event.part?.sessionID,
    );

    if (event.type === 'step_start') {
      return;
    }

    if (event.type === 'text') {
      const text = event.part?.text;
      if (typeof text === 'string' && text.length > 0) {
        const messageId = event.part?.messageID ?? event.part?.id ?? 'assistant';
        textByMessageId.set(
          messageId,
          `${textByMessageId.get(messageId) ?? ''}${text}`,
        );
        await publish('run.output.delta', {
          stream: 'assistant',
          text,
        });
      }
      return;
    }

    if (event.type === 'tool_use') {
      const part = event.part;
      const toolName = part?.tool?.trim();
      if (!toolName) {
        return;
      }

      if (!seenToolRegistrations.has(toolName)) {
        seenToolRegistrations.add(toolName);
        const requirement = inferRequirementFromToolName(toolName);
        if (requirement) {
          await publish('tool.registered', {
            toolName,
            requirement,
            source: inferSourceFromRequirement(requirement),
            detail:
              'OpenCode reported this tool through non-interactive run JSON events.',
            metadata: {
              confirmedBy: 'provider-runtime',
              providerSurface: 'opencode.run.json',
            },
          });
        }
      }

      const callId = part?.callID?.trim() || null;
      const input =
        part?.state?.input && typeof part.state.input === 'object'
          ? (part.state.input as Record<string, unknown>)
          : {};
      const output = part?.state?.output ?? null;
      const exitCode =
        part?.state?.metadata && typeof part.state.metadata === 'object'
          ? part.state.metadata.exit
          : undefined;

      await publish('tool.completed', {
        ...(callId ? { toolUseId: callId } : {}),
        toolName,
        input,
        output,
        ...(typeof exitCode === 'number' ? { isError: exitCode !== 0 } : {}),
        detail: typeof part?.state?.title === 'string' ? part.state.title : null,
        metadata: {
          opencode: {
            partId: part?.id ?? null,
            status: part?.state?.status ?? null,
            title: part?.state?.title ?? null,
            time: part?.state?.time ?? null,
            metadata: part?.state?.metadata ?? {},
          },
        },
      });
      return;
    }

    if (event.type === 'step_finish') {
      if (event.part?.reason === 'stop') {
        const accumulatedText = [...textByMessageId.values()]
          .map((text) => text.trim())
          .filter(Boolean)
          .join('\n\n');
        textByMessageId.clear();

        if (accumulatedText) {
          await publish('message.created', {
            role: 'assistant',
            content: accumulatedText,
          });
        }

        await publish('run.completed', {
          result: accumulatedText,
          usage: {
            input: event.part?.tokens?.input ?? null,
            output: event.part?.tokens?.output ?? null,
            reasoning: event.part?.tokens?.reasoning ?? null,
            cacheRead: event.part?.tokens?.cache?.read ?? null,
            cacheWrite: event.part?.tokens?.cache?.write ?? null,
            cost: event.part?.cost ?? null,
          },
        });
        return;
      }

      if (event.part?.reason === 'tool-calls') {
        // A tool-calling step finished; the model will continue with a follow-up step.
        return;
      }

      // Some versions omit reason on the final step; drain remaining text instead.
      await emitTerminalCompletion();
      return;
    }

    if (event.type === 'error') {
      const message =
        event.error?.data?.message ?? event.error?.name ?? 'OpenCode run failed';
      await publish('run.failed', {
        message,
        detail: event.error?.name ?? null,
      });
      return;
    }
  }

  private resolveLaunchSpec(): OpenCodeLaunchSpec {
    if (this.commandOverride) {
      return {
        command: this.commandOverride,
        shell: false,
        description: `command override via ${this.commandOverride}`,
        source: 'override',
      };
    }

    return {
      command: 'opencode',
      shell: process.platform === 'win32',
      description: 'external opencode on PATH',
      source: 'external',
    };
  }
}
