import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  parseProviderCommand,
  spawnProviderCommand,
} from '@codewave/provider-runtime';
import {
  createRunEventPublisher,
  launchJsonLineTransport,
} from '@codewave/provider-transport';
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderConnectedTool,
  ProviderConnectedToolQuery,
  ProviderHealth,
  ProviderRunContext,
  ProviderRunHandle,
  ProviderToolCapability,
} from '@codewave/protocol';

type FreebuffLaunchSpec = {
  command: string;
  baseArgs: string[];
  description: string;
  source: 'bridge' | 'external';
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

type FreebuffBridgeRecord = Record<string, unknown> & {
  type?: unknown;
};

type PendingSteering = {
  resolve: (result: {
    disposition: 'accepted' | 'rejected' | 'unavailable';
    detail?: string;
  }) => void;
  timeout: NodeJS.Timeout;
};

const FREEBUFF_BRIDGE_PROTOCOL_VERSION = 1;
const FREEBUFF_STEERING_NEGOTIATION_MS = 300;
const FREEBUFF_STEERING_ACK_MS = 2500;

const FREEBUFF_CAPABILITIES: ProviderCapabilities = {
  daemonApprovalMediation: false,
  resumableSessions: false,
  checkpointEvents: false,
  inFlightSteering: 'runtime-negotiated',
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

async function runCommand(
  spec: FreebuffLaunchSpec,
  args: string[],
  timeoutMs = 5000,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawnProviderCommand(spec, args, {
      env: process.env,
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
  readonly displayName = 'Freebuff CLI';

  private readonly commandOverride: string | null;
  private readonly rootPath: string;

  constructor(options: FreebuffCliProviderOptions = {}) {
    const commandOverride = options.command ?? process.env.CODEWAVE_FREEBUFF_COMMAND;
    this.commandOverride = commandOverride?.trim() || null;
    this.rootPath = path.resolve(options.rootPath ?? process.cwd());
  }

  private resolveLaunchSpec(): FreebuffLaunchSpec {
    if (this.commandOverride) {
      const parsed = parseProviderCommand(
        this.commandOverride,
        'Freebuff bridge command',
      );
      return {
        command: parsed.command,
        baseArgs: parsed.baseArgs,
        description: `Configured Freebuff automation bridge '${this.commandOverride}'`,
        source: 'bridge',
      };
    }

    return {
      command: 'freebuff',
      baseArgs: [],
      description: 'System Freebuff CLI',
      source: 'external',
    };
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return FREEBUFF_CAPABILITIES;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const spec = this.resolveLaunchSpec();
    const version = await runCommand(spec, ['--version']);
    if (version.code !== 0) {
      return {
        providerId: 'freebuff',
        available: false,
        detail: `Freebuff is not installed or could not be started (${spec.description}). Run 'npm install -g freebuff'.`,
        capabilities: FREEBUFF_CAPABILITIES,
      };
    }

    if (spec.source !== 'bridge') {
      return {
        providerId: 'freebuff',
        available: false,
        detail:
          'Freebuff is installed, but its public CLI currently exposes an interactive TUI rather than a daemon-safe non-interactive protocol. Configure a Freebuff automation bridge command to use it inside CodeWave; raw interactive launches stay outside the run ledger.',
        capabilities: FREEBUFF_CAPABILITIES,
      };
    }

    return {
      providerId: 'freebuff',
      available: true,
      detail: `Freebuff automation bridge ready (${spec.description}). Freebuff is cloud-backed and ad-supported.`,
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
    const publisher = createRunEventPublisher(context, 'freebuff');
    const publish = publisher.publish;

    const workspacePath = context.session.workspacePath.trim();
    if (!workspacePath || !existsSync(workspacePath)) {
      await publish('run.failed', {
        message: 'Workspace path does not exist',
        detail: workspacePath || 'Session workspace path is empty.',
      });
      return { cancel: async () => {} };
    }

    const args = [
      '--cwd',
      workspacePath,
      '--prompt',
      context.run.prompt,
      '--output-format',
      'jsonl',
    ];
    if (context.session.providerSessionId) {
      args.push('--resume', context.session.providerSessionId);
    }

    let outputText = '';
    let messageEmitted = false;
    let inFlightSteeringNegotiated = false;
    let resolveSteeringNegotiation: ((supported: boolean) => void) | null = null;
    const steeringNegotiation = new Promise<boolean>((resolve) => {
      resolveSteeringNegotiation = resolve;
    });
    const pendingSteering = new Map<string, PendingSteering>();

    const resolvePendingSteering = (
      steeringId: string,
      result: Parameters<PendingSteering['resolve']>[0],
    ): void => {
      const pending = pendingSteering.get(steeringId);
      if (!pending) return;
      pendingSteering.delete(steeringId);
      clearTimeout(pending.timeout);
      pending.resolve(result);
    };

    const closePendingSteering = (detail: string): void => {
      for (const steeringId of [...pendingSteering.keys()]) {
        resolvePendingSteering(steeringId, {
          disposition: 'unavailable',
          detail,
        });
      }
      resolveSteeringNegotiation?.(false);
      resolveSteeringNegotiation = null;
    };

    const handleBridgeRecord = async (
      record: FreebuffBridgeRecord,
      rawLine: string,
    ): Promise<void> => {
      const type = typeof record.type === 'string' ? record.type : '';
      if (type === 'capabilities') {
        const supported =
          record.protocolVersion === FREEBUFF_BRIDGE_PROTOCOL_VERSION &&
          record.inFlightSteering === true;
        if (supported) {
          inFlightSteeringNegotiated = true;
        }
        resolveSteeringNegotiation?.(supported);
        resolveSteeringNegotiation = null;
        return;
      }
      if (type === 'steering' && typeof record.steeringId === 'string') {
        const status = typeof record.status === 'string' ? record.status : '';
        resolvePendingSteering(record.steeringId, {
          disposition: status === 'accepted' ? 'accepted' : 'rejected',
          detail:
            typeof record.detail === 'string'
              ? record.detail
              : status === 'accepted'
                ? 'Freebuff bridge accepted the update.'
                : 'Freebuff bridge rejected the update.',
        });
        return;
      }
      if (type === 'session' && typeof record.sessionId === 'string') {
        await context.updateSession({ providerSessionId: record.sessionId });
        return;
      }
      if (type === 'output' && typeof record.text === 'string') {
        outputText += `${record.text}\n`;
        await publish('run.output.delta', {
          stream: typeof record.stream === 'string' ? record.stream : 'assistant',
          text: record.text,
        });
        return;
      }
      if (type === 'message' && typeof record.content === 'string') {
        messageEmitted = true;
        outputText += `${record.content}\n`;
        await publish('message.created', {
          role: typeof record.role === 'string' ? record.role : 'assistant',
          content: record.content,
        });
        return;
      }
      if (type === 'tool' && typeof record.name === 'string') {
        const status = typeof record.status === 'string' ? record.status : 'requested';
        const eventType =
          status === 'started'
            ? 'tool.started'
            : status === 'completed' || status === 'failed'
              ? 'tool.completed'
              : status === 'denied'
                ? 'tool.denied'
                : 'tool.requested';
        await publish(eventType, {
          toolUseId: typeof record.toolUseId === 'string' ? record.toolUseId : null,
          toolName: record.name,
          input: asRecord(record.input),
          output: record.output,
          detail: typeof record.detail === 'string' ? record.detail : null,
          isError: status === 'failed' || record.isError === true,
          metadata: asRecord(record.metadata),
        });
        return;
      }
      if (type === 'checkpoint') {
        await publish('checkpoint.saved', {
          detail:
            typeof record.title === 'string' ? record.title : 'freebuff-checkpoint',
          metadata: asRecord(record.metadata),
        });
        return;
      }
      if (type === 'result') {
        const status = typeof record.status === 'string' ? record.status : 'completed';
        if (status === 'failed') {
          await publish('run.failed', {
            message:
              typeof record.message === 'string'
                ? record.message
                : 'Freebuff bridge reported a failed run.',
            detail: record.detail,
          });
        } else if (status === 'cancelled') {
          await publish('run.cancelled', {
            reason:
              typeof record.message === 'string'
                ? record.message
                : 'Freebuff bridge cancelled the run.',
          });
        } else {
          await publish('run.completed', {
            result: record.result ?? outputText.trim(),
            usage: asRecord(record.usage),
          });
        }
        return;
      }

      outputText += `${rawLine}\n`;
      await publish('run.output.delta', {
        stream: 'stdout',
        text: rawLine,
      });
    };

    let transport;
    try {
      transport = launchJsonLineTransport<FreebuffBridgeRecord>({
        spawn: () =>
          spawnProviderCommand(spec, args, {
            cwd: workspacePath,
            env: process.env,
          }),
        parseRecord: (line) => {
          const value = JSON.parse(line) as unknown;
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Freebuff records must be JSON objects.');
          }
          return value as FreebuffBridgeRecord;
        },
        onRecord: handleBridgeRecord,
        onStdoutText: (line) => handleBridgeRecord({}, line),
        onStderrLine: async (line) => {
          await publish('run.output.delta', {
            stream: 'stderr',
            text: line,
          });
        },
        onLineTooLong: async () => {
          await publish('run.output.delta', {
            stream: 'stderr',
            text: 'Freebuff bridge line exceeded the 1 MiB safety limit and was ignored.',
          });
        },
        onHandlerError: async (error) => {
          await publish('run.output.delta', {
            stream: 'stderr',
            text: `Freebuff bridge event error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        },
        onProcessError: async (error) => {
          closePendingSteering(`Freebuff bridge process error: ${error.message}`);
          await publish('run.failed', {
            message: 'Failed to launch Freebuff CLI runtime',
            detail: `${spec.description}: ${error.message}`,
          });
        },
        onClose: async (code) => {
          closePendingSteering('Freebuff bridge closed before acknowledging the update.');
          if (publisher.terminalEventType || publisher.sealed) return;
          if (code === 0) {
            const finalContent =
              outputText.trim() || 'Freebuff run completed successfully.';
            if (!messageEmitted) {
              await publish('message.created', {
                role: 'assistant',
                content: finalContent,
              });
            }
            await publish('run.completed', { result: finalContent });
            return;
          }
          await publish('run.failed', {
            message: `Freebuff CLI exited with code ${code ?? 'unknown'}`,
            detail: spec.description,
            exitCode: code,
          });
        },
      });
    } catch (error) {
      await publish('run.failed', {
        message: 'Failed to launch Freebuff CLI runtime',
        detail: `${spec.description}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return { cancel: async () => {} };
    }

    transport.child.stdin?.on('error', (error) => {
      closePendingSteering(`Freebuff bridge input failed: ${error.message}`);
    });

    return {
      steer: async (input) => {
        if (!inFlightSteeringNegotiated) {
          const negotiated = await Promise.race([
            steeringNegotiation,
            new Promise<false>((resolve) => {
              const timeout = setTimeout(
                () => resolve(false),
                FREEBUFF_STEERING_NEGOTIATION_MS,
              );
              timeout.unref?.();
            }),
          ]);
          if (!negotiated) {
            return {
              disposition: 'unavailable',
              detail:
                'The configured Freebuff bridge did not negotiate CodeWave in-flight steering protocol v1.',
            };
          }
        }

        const stdin = transport.child.stdin;
        if (!stdin || stdin.destroyed || !stdin.writable) {
          return {
            disposition: 'unavailable',
            detail: 'The Freebuff bridge input channel is not writable.',
          };
        }

        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            resolvePendingSteering(input.steeringId, {
              disposition: 'unavailable',
              detail: `Freebuff bridge did not acknowledge the update within ${FREEBUFF_STEERING_ACK_MS}ms.`,
            });
          }, FREEBUFF_STEERING_ACK_MS);
          timeout.unref?.();
          pendingSteering.set(input.steeringId, { resolve, timeout });

          const command = `${JSON.stringify({
            type: 'steer',
            protocolVersion: FREEBUFF_BRIDGE_PROTOCOL_VERSION,
            steeringId: input.steeringId,
            prompt: input.prompt,
            createdAt: input.createdAt,
          })}\n`;
          try {
            stdin.write(command, (error) => {
              if (!error) return;
              resolvePendingSteering(input.steeringId, {
                disposition: 'unavailable',
                detail: `Freebuff bridge input failed: ${error.message}`,
              });
            });
          } catch (error) {
            resolvePendingSteering(input.steeringId, {
              disposition: 'unavailable',
              detail: `Freebuff bridge input failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        });
      },
      cancel: async () => {
        closePendingSteering('Freebuff run was cancelled.');
        publisher.seal();
        await transport.cancel();
      },
    };
  }
}

export function createFreebuffAdapter(
  options: FreebuffCliProviderOptions = {},
): ProviderAdapter {
  return new FreebuffCliProvider(options);
}
