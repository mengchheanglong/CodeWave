import { spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderConnectedTool,
  ProviderConnectedToolQuery,
  ProviderHealth,
  ProviderRunContext,
  ProviderRunHandle,
  ProviderToolCapability,
  WorkbenchEvent,
} from '@codewave/protocol';
import {
  parseProviderCommand,
  spawnProviderCommand,
} from '@codewave/provider-runtime';
import {
  createRunEventPublisher,
  launchJsonLineTransport,
} from '@codewave/provider-transport';
import { startGeminiAcpRun } from './acp.js';

type CommandResult = {
  code: number | null;
  output: string;
  errorMessage: string | null;
};

const DEFAULT_CONNECTED_TOOL_PROBE_TIMEOUT_MS = 2500;

function getConnectedToolProbeTimeoutMs(): number {
  const configured = Number(process.env.CODEWAVE_CONNECTED_TOOL_PROBE_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_CONNECTED_TOOL_PROBE_TIMEOUT_MS;
  }

  return Math.max(250, Math.trunc(configured));
}

type GeminiMode = 'stream-json' | 'acp';

type GeminiStreamMessage =
  | {
      type: 'init';
      timestamp?: string;
      session_id?: string;
      model?: string;
    }
  | {
      type: 'message';
      timestamp?: string;
      role?: string;
      content?: string;
      delta?: boolean;
    }
  | {
      type: 'tool_use';
      timestamp?: string;
      tool_name?: string;
      tool_id?: string;
      parameters?: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      timestamp?: string;
      tool_id?: string;
      status?: string;
      output?: string;
      error?: {
        type?: string;
        message?: string;
      };
    }
  | {
      type: 'result';
      timestamp?: string;
      status?: string;
      stats?: Record<string, unknown>;
      error?: {
        message?: string;
      };
    };
const GEMINI_STREAM_CAPABILITIES: ProviderCapabilities = {
  daemonApprovalMediation: false,
  resumableSessions: true,
  checkpointEvents: false,
  inFlightSteering: 'unsupported',
};
const GEMINI_ACP_CAPABILITIES: ProviderCapabilities = {
  daemonApprovalMediation: true,
  resumableSessions: true,
  checkpointEvents: false,
  inFlightSteering: 'unsupported',
};
const GEMINI_STREAM_TOOL_CATALOG: ProviderToolCapability[] = [
  {
    name: 'workspace-read',
    requirement: 'workspace-read',
    source: 'provider',
    permissionModel: 'auto',
    detail: 'Gemini is healthy for read-heavy workspace inspection.',
  },
  {
    name: 'shell',
    requirement: 'shell',
    source: 'provider',
    permissionModel: 'ask',
    detail: 'Gemini can execute shell-style tools through its runtime path.',
  },
  {
    name: 'network',
    requirement: 'network',
    source: 'provider',
    permissionModel: 'ask',
    detail: 'Gemini is the stronger network- and analysis-oriented provider surface today.',
  },
];
const GEMINI_ACP_TOOL_CATALOG: ProviderToolCapability[] = [
  ...GEMINI_STREAM_TOOL_CATALOG,
  {
    name: 'mcp',
    requirement: 'mcp',
    source: 'mcp',
    permissionModel: 'ask',
    detail: 'Gemini ACP can expose MCP through the shared tool plane when this workspace has enabled MCP servers.',
  },
];

type McpListProbeStatus = 'failed' | 'timeout' | 'empty' | 'configured';

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
      mcpListProbeSurface: 'gemini.mcp.list',
      ...(detail ? { mcpListProbeDetail: detail } : {}),
    },
  }));
}
const GEMINI_WINDOWS_PRELOAD = fileURLToPath(
  new URL('../runtime/win32-node-pty-preload.cjs', import.meta.url),
);

function parseConfiguredMcpServers(output: string): string[] {
  if (!output || /No MCP servers configured/i.test(output)) {
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
      if (/^Configured MCP servers/i.test(line)) {
        return false;
      }
      return true;
    })
    .map((line) =>
      line
        .replace(/^[\-\*\d\.\)\s]+/, '')
        .split(/\s+/)[0] ?? line,
    )
    .filter(Boolean);
}

function resolveCommand(command: string): string {
  if (process.platform === 'win32' && command === 'gemini') {
    return 'gemini.cmd';
  }

  return command;
}

function shouldUseShell(command: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

function resolveShellExecutable(command: string): string {
  if (!shouldUseShell(command) || /^[a-zA-Z]:\\|^\\\\/.test(command)) {
    return command;
  }

  const lookup = spawnSync('where.exe', [command], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  const firstMatch = lookup.stdout
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstMatch || command;
}

function resolveGeminiNodeInvocation(
  command: string,
  mode: GeminiMode,
): { command: string; argsPrefix: string[] } | null {
  if (process.platform !== 'win32') {
    return null;
  }

  const executable = resolveCommand(command);
  const basename = path.basename(executable).toLowerCase();
  if (basename !== 'gemini' && basename !== 'gemini.cmd') {
    return null;
  }

  const shimPath = resolveShellExecutable(executable);
  const packageRoot = path.join(
    path.dirname(shimPath),
    'node_modules',
    '@google',
    'gemini-cli',
  );
  const scriptPathCandidates = [
    path.join(packageRoot, 'bundle', 'gemini.js'),
    path.join(packageRoot, 'dist', 'index.js'),
  ];
  const scriptPath = scriptPathCandidates.find((candidate) => existsSync(candidate));
  if (!scriptPath) {
    return null;
  }

  return {
    command: 'node',
    argsPrefix: [
      '--no-warnings=DEP0040',
      ...(mode === 'acp' ? ['--require', GEMINI_WINDOWS_PRELOAD] : []),
      scriptPath,
    ],
  };
}

function spawnCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    mode?: GeminiMode;
  },
): ChildProcess {
  const parsed = parseProviderCommand(command, 'Gemini command');
  const { mode = 'stream-json', ...spawnOptions } = options;

  const nodeInvocation = resolveGeminiNodeInvocation(
    parsed.command,
    mode,
  );
  if (nodeInvocation) {
    return spawnProviderCommand(
      {
        command: nodeInvocation.command,
        baseArgs: [...nodeInvocation.argsPrefix, ...parsed.baseArgs],
      },
      args,
      spawnOptions,
    );
  }

  return spawnProviderCommand(
    { command: resolveCommand(parsed.command), baseArgs: parsed.baseArgs },
    args,
    spawnOptions,
  );
}

function isFatalGeminiAcpStderr(text: string): boolean {
  return /Error:\s+AttachConsole failed/i.test(text);
}

function hasCodeWaveWindowsPatch(command: string, mode: GeminiMode): boolean {
  const parsed = parseProviderCommand(command, 'Gemini command');
  return (
    process.platform === 'win32' &&
    mode === 'acp' &&
    resolveGeminiNodeInvocation(parsed.command, mode) !== null
  );
}

async function runCommand(
  command: string,
  args: string[],
  mode: GeminiMode,
  timeoutMs = 0,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawnCommand(command, args, {
      env: process.env,
      mode,
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

async function probeCommand(command: string): Promise<ProviderHealth> {
  return probeCommandForMode(command, 'stream-json');
}

async function probeCommandForMode(
  command: string,
  mode: GeminiMode,
): Promise<ProviderHealth> {
  const version = await runCommand(command, ['--version'], mode);
  if (version.code !== 0) {
    return {
      providerId: 'gemini',
      available: false,
      detail:
        version.errorMessage ??
        version.output ??
        'Gemini CLI is not available on PATH.',
      capabilities:
        mode === 'acp' ? GEMINI_ACP_CAPABILITIES : GEMINI_STREAM_CAPABILITIES,
    };
  }

  const versionLabel = version.output.split(/\r?\n/, 1)[0]?.trim() || 'unknown';
  if (mode === 'acp') {
    const help = await runCommand(command, ['--help'], mode);
    const supportsAcp =
      help.code === 0 &&
      /--acp|--experimental-acp/i.test(help.output);
    if (!supportsAcp) {
      return {
        providerId: 'gemini',
        available: false,
        detail: `Gemini CLI ${versionLabel} does not advertise ACP mode.`,
        capabilities: GEMINI_ACP_CAPABILITIES,
      };
    }

    return {
      providerId: 'gemini',
      available: true,
      detail: hasCodeWaveWindowsPatch(command, mode)
        ? `Gemini CLI ${versionLabel} ready (ACP mode, CodeWave Windows PTY patch).`
        : `Gemini CLI ${versionLabel} ready (ACP mode).`,
      capabilities: GEMINI_ACP_CAPABILITIES,
    };
  }

  return {
    providerId: 'gemini',
    available: true,
    detail: `Gemini CLI ${versionLabel} ready (stream-json mode).`,
    capabilities: GEMINI_STREAM_CAPABILITIES,
  };
}

export class GeminiCliProvider implements ProviderAdapter {
  readonly id = 'gemini';
  readonly displayName = 'Gemini CLI';

  private readonly command: string;
  private readonly mode: GeminiMode;

  constructor(command = process.env.CODEWAVE_GEMINI_COMMAND ?? 'gemini') {
    this.command = command;
    this.mode = this.resolveMode();
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return this.mode === 'acp'
      ? GEMINI_ACP_CAPABILITIES
      : GEMINI_STREAM_CAPABILITIES;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return probeCommandForMode(this.command, this.mode);
  }

  async toolCatalog(): Promise<ProviderToolCapability[]> {
    return this.mode === 'acp'
      ? GEMINI_ACP_TOOL_CATALOG
      : GEMINI_STREAM_TOOL_CATALOG;
  }

  async enumerateConnectedTools(
    _query: ProviderConnectedToolQuery,
  ): Promise<ProviderConnectedTool[]> {
    const catalog =
      this.mode === 'acp' ? GEMINI_ACP_TOOL_CATALOG : GEMINI_STREAM_TOOL_CATALOG;
    const connected: ProviderConnectedTool[] = catalog.map((tool) => ({
      name: tool.name,
      requirement: tool.requirement,
      source: tool.source,
      detail: tool.detail,
      metadata: {
        confirmedBy: 'provider-cli',
        providerSurface: `gemini.toolCatalog.${this.mode}`,
      },
    }));

    const mcp = await runCommand(
      this.command,
      ['mcp', 'list'],
      this.mode,
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
          `gemini mcp list exited with code ${mcp.code ?? 'unknown'}.`,
      );
    }

    const servers = parseConfiguredMcpServers(mcp.output);
    if (servers.length === 0) {
      return applyMcpListProbeMetadata(
        connected,
        'empty',
        'Gemini CLI reported no configured MCP servers.',
      );
    }

    const withMcpProbe = applyMcpListProbeMetadata(
      connected,
      'configured',
      'Gemini CLI reported configured MCP servers.',
    );

    if (!withMcpProbe.some((tool) => tool.requirement === 'mcp')) {
      withMcpProbe.push({
        name: 'mcp',
        requirement: 'mcp',
        source: 'mcp',
        detail:
          'Gemini CLI reports configured MCP servers through `gemini mcp list` for this runtime.',
        metadata: {
          confirmedBy: 'provider-cli',
          providerSurface: 'gemini.mcp.list',
          servers,
          mcpListProbeStatus: 'configured',
          mcpListProbeSurface: 'gemini.mcp.list',
          mcpListProbeDetail: 'Gemini CLI reported configured MCP servers.',
        },
      });
      return withMcpProbe;
    }

    return withMcpProbe.map((tool) =>
      tool.requirement === 'mcp'
        ? {
            ...tool,
            metadata: {
              ...(tool.metadata ?? {}),
              confirmedBy: 'provider-cli',
              providerSurface: 'gemini.mcp.list',
              servers,
              mcpListProbeStatus: 'configured',
              mcpListProbeSurface: 'gemini.mcp.list',
              mcpListProbeDetail: 'Gemini CLI reported configured MCP servers.',
            },
          }
        : tool,
    );
  }

  async startRun(context: ProviderRunContext): Promise<ProviderRunHandle> {
    if (this.mode === 'acp') {
      return this.startAcpRun(context);
    }

    return this.startStreamJsonRun(context);
  }

  private async startAcpRun(
    context: ProviderRunContext,
  ): Promise<ProviderRunHandle> {
    const child = spawnCommand(
      this.command,
      ['--acp'],
      {
        cwd: context.session.workspacePath,
        env: process.env,
        mode: 'acp',
      },
    );
    let stderrChain = Promise.resolve();
    const publisher = createRunEventPublisher(context, 'gemini');
    const publish = async (
      type: WorkbenchEvent['type'],
      payload: Record<string, unknown>,
    ): Promise<void> => {
      const published = await publisher.publish(type, payload);
      if (
        published &&
        (type === 'run.completed' ||
          type === 'run.failed' ||
          type === 'run.cancelled') &&
        child.exitCode === null &&
        !child.killed
      ) {
        child.kill();
      }
    };

    child.on('error', async (error) => {
      await publish('run.failed', {
        message: `Failed to launch ${this.command} ACP mode`,
        detail: error.message,
      });
    });

    readline
      .createInterface({ input: child.stderr! })
      .on('line', (line) => {
        stderrChain = stderrChain
          .catch(() => undefined)
          .then(async () => {
            const text = line.trim();
            if (!text || /^Loaded cached credentials\.?$/i.test(text)) {
              return;
            }

            await publish('run.output.delta', {
              stream: 'stderr',
              text,
            });

            if (
              !publisher.cancellationRequested &&
              !publisher.terminalEventType &&
              isFatalGeminiAcpStderr(text)
            ) {
              await publish('run.failed', {
                message: 'Gemini ACP terminal helper failed.',
                detail: text,
              });
              child.kill();
            }
          });
      });

    child.on('close', async (code) => {
      if (
        code === 0 ||
        publisher.terminalEventType ||
        publisher.cancellationRequested
      ) {
        return;
      }

      await publish('run.failed', {
        message: `${this.command} ACP mode exited unexpectedly`,
        exitCode: code,
      });
    });

    const handle = await startGeminiAcpRun({
      child,
      context,
      publish,
    });

    return {
      cancel: async () => {
        publisher.requestCancellation();
        await handle.cancel();
      },
    };
  }

  private async startStreamJsonRun(
    context: ProviderRunContext,
  ): Promise<ProviderRunHandle> {
    const extraArgs = (process.env.CODEWAVE_GEMINI_ARGS ?? '')
      .split(' ')
      .map((value) => value.trim())
      .filter(Boolean);
    let assistantBuffer = '';
    const toolNames = new Map<string, string>();
    const publisher = createRunEventPublisher(context, 'gemini');
    const publish = async (
      type: WorkbenchEvent['type'],
      payload: Record<string, unknown>,
    ): Promise<void> => {
      await publisher.publish(type, payload);
    };
    const assistantBufferRef = {
      get value() {
        return assistantBuffer;
      },
      set value(value: string) {
        assistantBuffer = value;
      },
    };
    const args = [
      ...(context.session.providerSessionId
        ? ['--resume', context.session.providerSessionId]
        : []),
      '-p',
      context.run.prompt,
      '--output-format',
      'stream-json',
      ...extraArgs,
    ];
    let transport;
    try {
      transport = launchJsonLineTransport<GeminiStreamMessage>({
        spawn: () =>
          spawnCommand(this.command, args, {
            cwd: context.session.workspacePath,
            env: process.env,
            mode: 'stream-json',
          }),
        parseRecord: (line) => {
          const value = JSON.parse(line) as unknown;
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Gemini stream records must be JSON objects.');
          }
          const message = value as GeminiStreamMessage;
          if (typeof message.type !== 'string') {
            throw new Error('Gemini stream records require a type.');
          }
          return message;
        },
        onRecord: async (message) => {
          await this.handleStreamMessage({
            context,
            message,
            toolNames,
            assistantBufferRef,
            publish,
          });
        },
        onStdoutText: async (line) => {
          if (!line.trim()) return;
          await publish('run.output.delta', {
            stream: 'stdout',
            text: line,
          });
        },
        onStderrLine: async (line) => {
          const text = line.trim();
          if (!text || /^Loaded cached credentials\.?$/i.test(text)) return;
          await publish('run.output.delta', { stream: 'stderr', text });
        },
        onLineTooLong: async (channel) => {
          await publish('run.output.delta', {
            stream: 'stderr',
            text: `Gemini ${channel} line exceeded the 1 MiB safety limit and was ignored.`,
          });
        },
        onHandlerError: async (error) => {
          await publish('run.output.delta', {
            stream: 'stderr',
            text: `Gemini adapter error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        },
        onProcessError: async (error) => {
          await publish('run.failed', {
            message: `Failed to launch ${this.command}`,
            detail: error.message,
          });
        },
        onClose: async (code) => {
          if (code === 0 || publisher.terminalEventType || publisher.sealed) return;
          await publish('run.failed', {
            message: `${this.command} exited unexpectedly`,
            exitCode: code,
          });
        },
      });
    } catch (error) {
      await publish('run.failed', {
        message: `Failed to launch ${this.command}`,
        detail: error instanceof Error ? error.message : String(error),
      });
      return { cancel: async () => {} };
    }

    return {
      cancel: async () => {
        publisher.seal();
        await transport.cancel();
      },
    };
  }

  private resolveMode(): GeminiMode {
    const requested = (process.env.CODEWAVE_GEMINI_MODE ?? 'acp')
      .trim()
      .toLowerCase();
    return requested === 'stream-json' ? 'stream-json' : 'acp';
  }

  private async handleStreamMessage({
    context,
    message,
    toolNames,
    assistantBufferRef,
    publish,
  }: {
    context: ProviderRunContext;
    message: GeminiStreamMessage;
    toolNames: Map<string, string>;
    assistantBufferRef: {
      value: string;
    };
    publish: (
      type: WorkbenchEvent['type'],
      payload: Record<string, unknown>,
    ) => Promise<void>;
  }): Promise<void> {
    if (message.type === 'init') {
      if (typeof message.session_id === 'string' && message.session_id.length > 0) {
        await context.updateSession({
          providerSessionId: message.session_id,
        });
      }
      return;
    }

    if (message.type === 'message') {
      if (message.role === 'assistant' && typeof message.content === 'string') {
        assistantBufferRef.value += message.content;
        await publish('run.output.delta', {
          stream: 'assistant',
          text: message.content,
        });
      }
      return;
    }

    if (message.type === 'tool_use') {
      if (message.tool_id && message.tool_name) {
        toolNames.set(message.tool_id, message.tool_name);
      }

      await publish('tool.requested', {
        toolUseId: message.tool_id ?? null,
        toolName: message.tool_name ?? 'unknown',
        input: message.parameters ?? {},
      });

      await publish('tool.started', {
        toolUseId: message.tool_id ?? null,
        toolName: message.tool_name ?? 'unknown',
      });
      return;
    }

    if (message.type === 'tool_result') {
      const toolName =
        (message.tool_id && toolNames.get(message.tool_id)) ?? 'unknown';

      if (message.status === 'error') {
        await publish('tool.denied', {
          toolUseId: message.tool_id ?? null,
          toolName,
          input: {},
          detail: message.error?.message ?? message.output ?? null,
        });
      }

      await publish('tool.completed', {
        toolUseId: message.tool_id ?? null,
        toolName,
        isError: message.status === 'error',
        output: message.output ?? '',
        detail: message.error?.message ?? null,
      });
      return;
    }

    if (message.type === 'result') {
      if (assistantBufferRef.value.trim()) {
        await publish('message.created', {
          role: 'assistant',
          content: assistantBufferRef.value.trim(),
        });
      }

      if (message.status !== 'success') {
        await publish('run.failed', {
          message: message.error?.message ?? 'Gemini run failed',
          usage: message.stats ?? {},
        });
        return;
      }

      await publish('run.completed', {
        result: assistantBufferRef.value.trim(),
        usage: message.stats ?? {},
      });
    }
  }
}
