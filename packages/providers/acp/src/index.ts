import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import {
  inferRoutingToolRequirement,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderConnectedTool,
  type ProviderConnectedToolQuery,
  type ProviderHealth,
  type ProviderId,
  type ProviderRunContext,
  type ProviderRunHandle,
  type ProviderToolCapability,
  type RoutingToolRequirement,
  type WorkbenchEvent,
} from '@codewave/protocol';
import { spawnProviderCommand } from '@codewave/provider-runtime';
import {
  createRunEventPublisher,
  probeAcpV1Process,
  startAcpRun,
  type AcpProbeResult,
  type AcpTransportTrace,
} from '@codewave/provider-transport';

export type AcpV1LaunchProfile = Readonly<{
  providerId: ProviderId;
  displayName: string;
  command: string;
  args: readonly string[];
  probeCwd: string;
  surface: string;
  toolCatalog?: readonly ProviderToolCapability[];
  inferToolRequirement?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => RoutingToolRequirement | null;
}>;

export type AcpV1ProviderAdapterOptions = {
  profile: AcpV1LaunchProfile;
  env?: NodeJS.ProcessEnv;
  trace?: (entry: AcpTransportTrace) => void;
  probeTimeoutMs?: number;
  probeCacheTtlMs?: number;
};

type CachedProbe = {
  expiresAt: number;
  promise: Promise<AcpProbeResult>;
};

const STDERR_LINE_LIMIT = 64 * 1024;
const STDERR_TOTAL_LIMIT = 256 * 1024;

function sanitizeDiagnostic(value: string, limit = 512): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, limit);
}

function describeProbe(result: AcpProbeResult): string {
  const identity = [result.agentName, result.agentVersion].filter(Boolean).join(' ');
  const auth =
    result.authenticationMethodCount > 0
      ? `${result.authenticationMethodCount} authentication method(s) advertised`
      : 'no authentication method advertised';
  return `${identity || 'ACP agent'} is protocol-v1 compatible; continuity=${result.continuity}; ${auth}. Credential state is unverified.`;
}

function attachBoundedStderr(
  child: ChildProcess,
  publish: (
    type: WorkbenchEvent['type'],
    payload: Record<string, unknown>,
  ) => Promise<void>,
): { diagnostic: () => string } {
  let aggregate = '';
  let pending = '';
  let emittedBytes = 0;
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    if (emittedBytes >= STDERR_TOTAL_LIMIT) return;
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const rawLine of lines) {
      if (emittedBytes >= STDERR_TOTAL_LIMIT) break;
      const line = rawLine.slice(0, STDERR_LINE_LIMIT);
      const remaining = STDERR_TOTAL_LIMIT - emittedBytes;
      const bounded = line.slice(0, remaining);
      emittedBytes += Buffer.byteLength(bounded, 'utf8');
      aggregate = `${aggregate}\n${bounded}`.trim().slice(-4096);
      if (bounded) {
        void publish('run.output.delta', { stream: 'stderr', text: bounded });
      }
    }
    if (pending.length > STDERR_LINE_LIMIT) {
      pending = pending.slice(0, STDERR_LINE_LIMIT);
    }
  });
  return { diagnostic: () => sanitizeDiagnostic(aggregate, 4096) };
}

export class AcpV1ProviderAdapter implements ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;

  private readonly profile: AcpV1LaunchProfile;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly trace?: (entry: AcpTransportTrace) => void;
  private readonly probeTimeoutMs: number;
  private readonly probeCacheTtlMs: number;
  private cachedProbe: CachedProbe | null = null;

  constructor(options: AcpV1ProviderAdapterOptions) {
    this.profile = options.profile;
    this.id = options.profile.providerId;
    this.displayName = options.profile.displayName;
    this.environment = options.env ?? process.env;
    this.trace = options.trace;
    this.probeTimeoutMs = Math.max(100, options.probeTimeoutMs ?? 5_000);
    this.probeCacheTtlMs = Math.max(0, options.probeCacheTtlMs ?? 15_000);
  }

  async capabilities(): Promise<ProviderCapabilities> {
    try {
      const probe = await this.probe();
      return {
        daemonApprovalMediation: true,
        resumableSessions: probe.continuity !== 'none',
        checkpointEvents: false,
        inFlightSteering: 'unsupported',
      };
    } catch {
      return {
        daemonApprovalMediation: true,
        resumableSessions: false,
        checkpointEvents: false,
        inFlightSteering: 'unsupported',
      };
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const probe = await this.probe();
      return {
        providerId: this.id,
        available: true,
        detail: describeProbe(probe),
        capabilities: await this.capabilities(),
      };
    } catch (error) {
      return {
        providerId: this.id,
        available: false,
        detail: sanitizeDiagnostic(
          error instanceof Error ? error.message : String(error),
        ),
        capabilities: {
          daemonApprovalMediation: true,
          resumableSessions: false,
          checkpointEvents: false,
          inFlightSteering: 'unsupported',
        },
      };
    }
  }

  async toolCatalog(): Promise<ProviderToolCapability[]> {
    return [...(this.profile.toolCatalog ?? [])];
  }

  async enumerateConnectedTools(
    _query: ProviderConnectedToolQuery,
  ): Promise<ProviderConnectedTool[]> {
    return [];
  }

  async startRun(context: ProviderRunContext): Promise<ProviderRunHandle> {
    const publisher = createRunEventPublisher(context, this.id);
    const workspacePath = context.session.workspacePath.trim();
    if (!path.isAbsolute(workspacePath)) {
      await publisher.publish('run.failed', {
        message: `${this.displayName} requires an absolute workspace path.`,
      });
      return { cancel: async () => undefined };
    }

    const child = this.spawn(workspacePath);
    const publish = async (
      type: WorkbenchEvent['type'],
      payload: Record<string, unknown>,
    ): Promise<void> => {
      const accepted = await publisher.publish(type, payload);
      if (
        accepted &&
        ['run.completed', 'run.failed', 'run.cancelled'].includes(type) &&
        child.exitCode === null &&
        !child.killed
      ) {
        child.kill();
      }
    };
    const stderr = attachBoundedStderr(child, publish);

    child.once('error', (error) => {
      if (!publisher.terminalEventType && !publisher.cancellationRequested) {
        void publish('run.failed', {
          message: `Failed to launch ${this.displayName} ACP runtime.`,
          detail: sanitizeDiagnostic(error.message),
        });
      }
    });

    try {
      const handle = await startAcpRun({
        child,
        context,
        publish,
        profile: {
          providerId: this.id,
          displayName: this.displayName,
          surface: this.profile.surface,
          inferToolRequirement:
            this.profile.inferToolRequirement ??
            ((toolName, input) =>
              inferRoutingToolRequirement({ toolName, input })),
        },
        trace: this.trace,
      });
      return {
        cancel: async () => {
          publisher.requestCancellation();
          await handle.cancel();
        },
      };
    } catch (error) {
      if (!publisher.terminalEventType) {
        await publish('run.failed', {
          message: `Failed to bootstrap ${this.displayName} ACP session.`,
          detail:
            sanitizeDiagnostic(
              error instanceof Error ? error.message : String(error),
              2048,
            ) || stderr.diagnostic(),
        });
      }
      return { cancel: async () => undefined };
    }
  }

  private spawn(cwd: string): ChildProcess {
    return spawnProviderCommand(
      { command: this.profile.command },
      [...this.profile.args],
      { cwd, env: this.environment, stdio: ['pipe', 'pipe', 'pipe'] },
    );
  }

  private probe(): Promise<AcpProbeResult> {
    const now = Date.now();
    if (this.cachedProbe && this.cachedProbe.expiresAt > now) {
      return this.cachedProbe.promise;
    }
    const promise = this.runProbe();
    this.cachedProbe = { expiresAt: now + this.probeCacheTtlMs, promise };
    void promise.catch(() => {
      if (this.cachedProbe?.promise === promise) this.cachedProbe = null;
    });
    return promise;
  }

  private async runProbe(): Promise<AcpProbeResult> {
    if (!path.isAbsolute(this.profile.probeCwd)) {
      throw new Error(`${this.displayName} ACP probe cwd must be absolute.`);
    }
    const child = this.spawn(this.profile.probeCwd);
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4096);
    });
    try {
      return await probeAcpV1Process({
        child,
        displayName: this.displayName,
        timeoutMs: this.probeTimeoutMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const diagnostic = sanitizeDiagnostic(stderr, 1024);
      throw new Error(diagnostic ? `${message} ${diagnostic}` : message);
    }
  }
}
