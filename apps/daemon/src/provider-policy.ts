import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_PROVIDER_ID,
  PROVIDER_IDS,
  type ProviderConfiguration,
  type ProviderConfigurationSource,
  type ProviderId,
  type ProviderRegistrySnapshot,
  type UpdateProviderConfigurationRequest,
} from '@codewave/protocol';

type ProviderFileEntry = Partial<
  Pick<ProviderConfiguration, 'enabled' | 'priority' | 'command'>
>;

type ProviderPolicyFile = {
  version: 1;
  defaultProviderId?: ProviderId;
  providers?: Partial<Record<ProviderId, ProviderFileEntry>>;
};

const PROVIDER_DEFAULTS: Record<ProviderId, Omit<ProviderConfiguration, 'configurationSource'>> = {
  freebuff: {
    providerId: 'freebuff',
    displayName: 'Freebuff',
    enabled: true,
    priority: 10,
    accessMode: 'free-cloud',
    dataBoundary: 'cloud-ad-supported',
    requiresExplicitEnable: false,
    command: null,
    setupHint:
      'Install Freebuff globally. Its upstream CLI is interactive-only today, so daemon runs require a compatible automation bridge command.',
    documentationUrl: 'https://github.com/CodebuffAI/freebuff',
  },
  opencode: {
    providerId: 'opencode',
    displayName: 'OpenCode',
    enabled: true,
    priority: 20,
    accessMode: 'local-or-byok',
    dataBoundary: 'local-or-user-configured',
    requiresExplicitEnable: false,
    command: null,
    setupHint:
      'Install OpenCode and connect a local model such as Ollama or a provider you already use.',
    documentationUrl: 'https://dev.opencode.ai/docs/providers',
  },
  qwen: {
    providerId: 'qwen',
    displayName: 'Qwen Code',
    enabled: false,
    priority: 30,
    accessMode: 'paid-or-byok',
    dataBoundary: 'provider-managed',
    requiresExplicitEnable: true,
    command: null,
    setupHint:
      'Enable after configuring an Alibaba Coding Plan, API key, or a compatible local/custom endpoint in Qwen Code.',
    documentationUrl:
      'https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/auth.md',
  },
  gemini: {
    providerId: 'gemini',
    displayName: 'Gemini CLI',
    enabled: false,
    priority: 40,
    accessMode: 'paid-or-byok',
    dataBoundary: 'provider-managed',
    requiresExplicitEnable: true,
    command: null,
    setupHint:
      'Enable after configuring enterprise Code Assist or API-key authentication for Gemini CLI.',
    documentationUrl:
      'https://github.com/google-gemini/gemini-cli/discussions/28017',
  },
};

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_IDS.includes(value as ProviderId);
}

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }
  return null;
}

function normalizePriority(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(999, Math.trunc(value)));
}

function normalizeCommand(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('Provider command must be a string or null.');
  }
  const command = value.trim();
  if (!command) return null;
  if (command.length > 1024 || /[\r\n\0]/.test(command)) {
    throw new Error('Provider command must be one line and at most 1024 characters.');
  }
  return command;
}

function readPolicyFile(configPath: string): ProviderPolicyFile {
  if (!existsSync(configPath)) {
    return { version: 1 };
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as ProviderPolicyFile;
    if (parsed.version !== 1) {
      throw new Error(`Unsupported provider policy version '${String(parsed.version)}'.`);
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load ${configPath}: ${message}`);
  }
}

function environmentKey(providerId: ProviderId, suffix: 'ENABLED' | 'COMMAND'): string {
  return `CODEWAVE_${providerId.toUpperCase()}_${suffix}`;
}

function createProviderRevision(
  defaultProviderId: ProviderId,
  providers: ProviderConfiguration[],
): string {
  const effectivePolicy = {
    version: 1,
    defaultProviderId,
    providers: PROVIDER_IDS.map((providerId) => {
      const provider = providers.find((entry) => entry.providerId === providerId)!;
      return {
        providerId,
        enabled: provider.enabled,
        priority: provider.priority,
        command: provider.command,
      };
    }),
  };
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(effectivePolicy))
    .digest('hex')}`;
}

export class ProviderRevisionConflictError extends Error {
  readonly code = 'provider_revision_conflict';

  constructor(readonly currentRevision: string) {
    super(
      'Provider configuration changed after this view loaded. Refresh the runtime and review the current provider policy before retrying.',
    );
    this.name = 'ProviderRevisionConflictError';
  }
}

export class ProviderPolicyStore {
  readonly configPath: string;
  private filePolicy: ProviderPolicyFile;

  constructor(rootPath: string) {
    this.configPath = path.join(path.resolve(rootPath), '.codewave', 'providers.json');
    this.filePolicy = readPolicyFile(this.configPath);
  }

  snapshot(): ProviderRegistrySnapshot {
    const configuredDefault = this.filePolicy.defaultProviderId;
    const environmentDefault = process.env.CODEWAVE_DEFAULT_PROVIDER;
    const defaultProviderId = isProviderId(environmentDefault)
      ? environmentDefault
      : isProviderId(configuredDefault)
        ? configuredDefault
        : DEFAULT_PROVIDER_ID;

    const providers = PROVIDER_IDS.map((providerId) => {
      const defaults = PROVIDER_DEFAULTS[providerId];
      const fileEntry = this.filePolicy.providers?.[providerId];
      const enabledEnvironmentKey = environmentKey(providerId, 'ENABLED');
      const commandEnvironmentKey = environmentKey(providerId, 'COMMAND');
      const environmentEnabled = parseBoolean(process.env[enabledEnvironmentKey]);
      const environmentCommand = process.env[commandEnvironmentKey]?.trim() || null;
      const hasFileConfiguration = Boolean(fileEntry);
      const hasEnvironmentConfiguration =
        environmentEnabled !== null || environmentCommand !== null;
      const configurationSource: ProviderConfigurationSource =
        hasEnvironmentConfiguration
          ? 'environment'
          : hasFileConfiguration
            ? 'file'
            : 'default';
      const command = environmentCommand ?? normalizeCommand(fileEntry?.command) ?? defaults.command;
      const enabled =
        environmentEnabled ??
        (environmentCommand ? true : undefined) ??
        (typeof fileEntry?.enabled === 'boolean' ? fileEntry.enabled : defaults.enabled);

      return {
        ...defaults,
        enabled,
        priority: normalizePriority(fileEntry?.priority, defaults.priority),
        command,
        configurationSource,
      } satisfies ProviderConfiguration;
    }).sort((left, right) => left.priority - right.priority);

    return {
      version: 1,
      revision: createProviderRevision(defaultProviderId, providers),
      defaultProviderId,
      configPath: this.configPath,
      providers,
    };
  }

  async updateProvider(
    providerId: ProviderId,
    patch: UpdateProviderConfigurationRequest,
  ): Promise<ProviderRegistrySnapshot> {
    const currentSnapshot = this.snapshot();
    if (patch.expectedProviderRevision !== currentSnapshot.revision) {
      throw new ProviderRevisionConflictError(currentSnapshot.revision);
    }
    const currentProvider = currentSnapshot.providers.find(
      (provider) => provider.providerId === providerId,
    );
    if (
      patch.enabled === false &&
      currentProvider?.enabled &&
      !currentSnapshot.providers.some(
        (provider) => provider.providerId !== providerId && provider.enabled,
      )
    ) {
      throw new Error('At least one provider must remain enabled.');
    }

    const current = this.filePolicy.providers?.[providerId] ?? {};
    const next: ProviderFileEntry = { ...current };

    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== 'boolean') {
        throw new Error('enabled must be a boolean.');
      }
      next.enabled = patch.enabled;
    }
    if (patch.priority !== undefined) {
      next.priority = normalizePriority(patch.priority, PROVIDER_DEFAULTS[providerId].priority);
    }
    if (patch.command !== undefined) {
      next.command = normalizeCommand(patch.command);
    }

    this.filePolicy = {
      version: 1,
      defaultProviderId:
        patch.enabled === false && currentSnapshot.defaultProviderId === providerId
          ? currentSnapshot.providers.find(
              (provider) => provider.providerId !== providerId && provider.enabled,
            )?.providerId
          : this.filePolicy.defaultProviderId,
      providers: {
        ...(this.filePolicy.providers ?? {}),
        [providerId]: next,
      },
    };
    await this.persist();
    return this.snapshot();
  }

  async setDefaultProvider(
    providerId: ProviderId,
    expectedProviderRevision: string,
  ): Promise<ProviderRegistrySnapshot> {
    const currentSnapshot = this.snapshot();
    if (expectedProviderRevision !== currentSnapshot.revision) {
      throw new ProviderRevisionConflictError(currentSnapshot.revision);
    }
    if (isProviderId(process.env.CODEWAVE_DEFAULT_PROVIDER)) {
      throw new Error('The default provider is managed by CODEWAVE_DEFAULT_PROVIDER.');
    }
    const provider = currentSnapshot.providers.find(
      (configuration) => configuration.providerId === providerId,
    );
    if (!provider?.enabled) {
      throw new Error(`${PROVIDER_DEFAULTS[providerId].displayName} must be enabled before it can become the default provider.`);
    }
    this.filePolicy = {
      ...this.filePolicy,
      version: 1,
      defaultProviderId: providerId,
    };
    await this.persist();
    return this.snapshot();
  }

  private async persist(): Promise<void> {
    const directory = path.dirname(this.configPath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${this.configPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.filePolicy, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, this.configPath);
  }
}

export function isKnownProviderId(value: unknown): value is ProviderId {
  return isProviderId(value);
}
