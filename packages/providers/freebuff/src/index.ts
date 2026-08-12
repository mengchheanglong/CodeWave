import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
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
  WorkbenchEvent,
} from '@qwemini/protocol';

type FreebuffLaunchSpec = {
  command: string;
  shell: boolean;
  description: string;
};

type FreebuffCliProviderOptions = {
  command?: string;
  rootPath?: string;
};

type CommandResult = {
  code: number | null;
  output: string;
  errorMessage: string | null;
};

const FREEBUFF_CAPABILITIES: ProviderCapabilities = {
  daemonApprovalMediation: true,
  resumableSessions: true,
  checkpointEvents: false,
};

const FREEBUFF_TOOL_CATALOG: ProviderToolCapability[] = [
  {
    name: 'bash',
    requirement: 'shell',
    source: 'provider',
    permissionModel: 'ask',
    detail: 'Freebuff executes shell commands through its agent runner.',
  },
  {
    name: 'read',
    requirement: 'workspace-read',
    source: 'provider',
    permissionModel: 'auto',
    detail: 'Freebuff inspects file contents across the workspace.',
  },
  {
    name: 'write',
    requirement: 'workspace-write',
    source: 'provider',
    permissionModel: 'ask',
    detail: 'Freebuff writes and modifies files in the workspace.',
  },
  {
    name: 'grep',
    requirement: 'workspace-read',
    source: 'provider',
    permissionModel: 'auto',
    detail: 'Freebuff searches workspace file contents.',
  },
];

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
    source: 'freebuff',
    type,
    payload,
  };
}

async function runCommand(
  spec: FreebuffLaunchSpec,
  args: string[],
  timeoutMs = 5000,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(spec.command, args, {
      env: process.env,
      shell: spec.shell,
      windowsHide: true,
    });

    let output = '';
    const resolveOnce = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timeout = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill();
      }
      resolveOnce({
        code: null,
        output: output.trim(),
        errorMessage: `Command timed out after ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolveOnce({
        code: null,
        output: output.trim(),
        errorMessage: error.message,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolveOnce({
        code,
        output: output.trim(),
        errorMessage: null,
      });
    });
  });
}

export class FreebuffCliProvider implements ProviderAdapter {
  readonly id = 'freebuff';
  readonly displayName = 'Freebuff / Codebuff CLI';

  private readonly commandOverride: string | null;
  private readonly rootPath: string;

  constructor(options: FreebuffCliProviderOptions = {}) {
    const commandOverride = options.command ?? process.env.QWEMINI_FREEBUFF_COMMAND;
    this.commandOverride = commandOverride?.trim() || null;
    this.rootPath = path.resolve(options.rootPath ?? process.cwd());
  }

  private resolveLaunchSpec(): FreebuffLaunchSpec {
    if (this.commandOverride) {
      return {
        command: this.commandOverride,
        shell: process.platform === 'win32',
        description: `Custom freebuff command '${this.commandOverride}'`,
      };
    }

    if (process.platform === 'win32') {
      const candidates = ['freebuff.cmd', 'codebuff.cmd', 'freebuff', 'codebuff'];
      for (const candidate of candidates) {
        const lookup = spawnSync('where.exe', [candidate], {
          encoding: 'utf8',
          shell: false,
          windowsHide: true,
        });
        if (lookup.status === 0 && lookup.stdout) {
          const match = lookup.stdout.split(/\r?\n/)[0]?.trim();
          if (match && existsSync(match)) {
            return {
              command: match,
              shell: true,
              description: `Resolved freebuff executable at '${match}'`,
            };
          }
        }
      }
    }

    return {
      command: 'freebuff',
      shell: process.platform === 'win32',
      description: 'System freebuff / codebuff CLI',
    };
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return FREEBUFF_CAPABILITIES;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const spec = this.resolveLaunchSpec();
    const version = await runCommand(spec, ['--version']);
    if (version.code !== 0 && !version.output.includes('freebuff')) {
      // Also try codebuff fallback
      const codebuffVersion = await runCommand({ ...spec, command: 'codebuff' }, ['--version']);
      if (codebuffVersion.code !== 0) {
        return {
          providerId: 'freebuff',
          available: false,
          detail: `Freebuff / Codebuff CLI is not installed or available in PATH (${spec.description}). Run 'npm install -g freebuff' or 'npm install -g codebuff' to install.`,
          capabilities: FREEBUFF_CAPABILITIES,
        };
      }
    }

    return {
      providerId: 'freebuff',
      available: true,
      detail: `Freebuff CLI ready (${spec.description}). Multi-agent free AI coding engine loaded.`,
      capabilities: FREEBUFF_CAPABILITIES,
    };
  }

  async toolCatalog(): Promise<ProviderToolCapability[]> {
    return FREEBUFF_TOOL_CATALOG;
  }

  async enumerateConnectedTools(
    _query: ProviderConnectedToolQuery,
  ): Promise<ProviderConnectedTool[]> {
    return FREEBUFF_TOOL_CATALOG.map((tool) => ({
      name: tool.name,
      requirement: tool.requirement,
      source: tool.source,
      detail: tool.detail,
      metadata: {
        confirmedBy: 'provider-cli',
        providerSurface: 'freebuff.toolCatalog',
      },
    }));
  }

  async startRun(context: ProviderRunContext): Promise<ProviderRunHandle> {
    const spec = this.resolveLaunchSpec();
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
        detail: workspacePath || 'Session workspace path is empty.',
      });
      return { cancel: async () => {} };
    }

    const args = [
      '--non-interactive',
      context.run.prompt,
    ];

    const child = spawn(spec.command, args, {
      cwd: workspacePath,
      env: process.env,
      shell: spec.shell,
      windowsHide: true,
    });

    let outputText = '';

    child.on('error', async (error) => {
      if (terminalEmitted) return;
      await publish('run.failed', {
        message: 'Failed to launch Freebuff CLI runtime',
        detail: `${spec.description}: ${error.message}`,
      });
    });

    if (child.stdout) {
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        outputText += `${line}\n`;
        void publish('run.output.delta', {
          stream: 'stdout',
          text: line,
        });
      });
    }

    if (child.stderr) {
      readline.createInterface({ input: child.stderr }).on('line', (line) => {
        void publish('run.output.delta', {
          stream: 'stderr',
          text: line,
        });
      });
    }

    child.on('close', async (code) => {
      if (terminalEmitted) return;
      if (code === 0) {
        const finalContent = outputText.trim() || 'Freebuff run completed successfully.';
        await publish('message.created', {
          role: 'assistant',
          content: finalContent,
        });
        await publish('run.completed', {
          result: finalContent,
        });
      } else {
        await publish('run.failed', {
          message: `Freebuff CLI exited with code ${code ?? 'unknown'}`,
          detail: spec.description,
          exitCode: code,
        });
      }
    });

    return {
      cancel: async () => {
        if (child.exitCode === null && !child.killed) {
          child.kill();
        }
      },
    };
  }
}

export function createFreebuffAdapter(
  options: FreebuffCliProviderOptions = {},
): ProviderAdapter {
  return new FreebuffCliProvider(options);
}
