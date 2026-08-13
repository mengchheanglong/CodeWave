import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_PROVIDER_ID,
  PROVIDER_IDS,
  type BuiltinProviderId,
  type CreateAcpProviderRequest,
  type CustomAcpProviderId,
  type ProviderConfiguration,
  type ProviderConfigurationSource,
  type ProviderId,
  type ProviderRegistrySnapshot,
  type UpdateProviderConfigurationRequest,
  isBuiltinProviderId,
  isCustomAcpProviderId,
} from '@codewave/protocol';

type BuiltinProviderFileEntry = Partial<
  Pick<ProviderConfiguration, 'enabled' | 'priority' | 'command'>
>;

type CustomAcpProfileFileEntry = {
  displayName: string;
  enabled: boolean;
  priority: number;
  command: string;
  args: string[];
};

type ProviderPolicyFile = {
  version: 2;
  defaultProviderId?: ProviderId;
  providers?: Partial<Record<BuiltinProviderId, BuiltinProviderFileEntry>>;
  profiles?: Record<string, CustomAcpProfileFileEntry>;
};

type LegacyProviderPolicyFile = {
  version: 1;
  defaultProviderId?: BuiltinProviderId;
  providers?: Partial<Record<BuiltinProviderId, BuiltinProviderFileEntry>>;
};

const PROVIDER_DEFAULTS: Record<BuiltinProviderId, Omit<ProviderConfiguration, 'configurationSource'>> = {
  freebuff: {
    providerId: 'freebuff',
    displayName: 'Freebuff',
    profileKind: 'builtin',
    adapterKind: 'native',
    enabled: true,
    priority: 10,
    accessMode: 'free-cloud',
    dataBoundary: 'cloud-ad-supported',
    requiresExplicitEnable: false,
    command: null,
    args: [],
    setupHint:
      'Install Freebuff globally. Its upstream CLI is interactive-only today, so daemon runs require a compatible automation bridge command.',
    documentationUrl: 'https://github.com/CodebuffAI/freebuff',
  },
  opencode: {
    providerId: 'opencode',
    displayName: 'OpenCode',
    profileKind: 'builtin',
    adapterKind: 'acp-v1',
    enabled: true,
    priority: 20,
    accessMode: 'local-or-byok',
    dataBoundary: 'local-or-user-configured',
    requiresExplicitEnable: false,
    command: null,
    args: ['acp'],
    setupHint:
      'Install OpenCode and connect a local model such as Ollama or a provider you already use.',
    documentationUrl: 'https://dev.opencode.ai/docs/providers',
  },
  qwen: {
    providerId: 'qwen',
    displayName: 'Qwen Code',
    profileKind: 'builtin',
    adapterKind: 'native',
    enabled: false,
    priority: 30,
    accessMode: 'paid-or-byok',
    dataBoundary: 'provider-managed',
    requiresExplicitEnable: true,
    command: null,
    args: [],
    setupHint:
      'Enable after configuring an Alibaba Coding Plan, API key, or a compatible local/custom endpoint in Qwen Code.',
    documentationUrl:
      'https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/auth.md',
  },
  gemini: {
    providerId: 'gemini',
    displayName: 'Gemini CLI',
    profileKind: 'builtin',
    adapterKind: 'native',
    enabled: false,
    priority: 40,
    accessMode: 'paid-or-byok',
    dataBoundary: 'provider-managed',
    requiresExplicitEnable: true,
    command: null,
    args: [],
    setupHint:
      'Enable after configuring enterprise Code Assist or API-key authentication for Gemini CLI.',
    documentationUrl:
      'https://github.com/google-gemini/gemini-cli/discussions/28017',
  },
};

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

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('ACP profile displayName must be a string.');
  }
  const displayName = value.trim();
  if (!displayName || displayName.length > 64 || /[\r\n\0]/.test(displayName)) {
    throw new Error('ACP profile displayName must be one line and 1-64 characters.');
  }
  return displayName;
}

function normalizeArgs(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error('ACP profile args must contain at most 64 arguments.');
  }
  return value.map((entry) => {
    if (
      typeof entry !== 'string' ||
      entry.length > 1024 ||
      /[\r\n\0]/.test(entry)
    ) {
      throw new Error(
        'Each ACP profile argument must be a string without control line breaks and at most 1024 characters.',
      );
    }
    return entry;
  });
}

function readPolicyFile(configPath: string): ProviderPolicyFile {
  if (!existsSync(configPath)) {
    return { version: 2 };
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as
      | ProviderPolicyFile
      | LegacyProviderPolicyFile;
    if (parsed.version === 1) {
      return {
        version: 2,
        defaultProviderId: parsed.defaultProviderId,
        providers: parsed.providers,
        profiles: {},
      };
    }
    if (parsed.version !== 2) {
      throw new Error('Unsupported provider policy version.');
    }
    const profiles = Object.fromEntries(
      Object.entries(parsed.profiles ?? {}).map(([providerId, profile]) => {
        if (!isCustomAcpProviderId(providerId)) {
          throw new Error(`Invalid custom ACP provider ID '${providerId}'.`);
        }
        return [
          providerId,
          {
            displayName: normalizeDisplayName(profile.displayName),
            enabled: profile.enabled === true,
            priority: normalizePriority(profile.priority, 100),
            command: normalizeCommand(profile.command) ?? '',
            args: normalizeArgs(profile.args),
          },
        ];
      }),
    );
    if (Object.values(profiles).some((profile) => !profile.command)) {
      throw new Error('Every custom ACP profile requires an executable command.');
    }
    return { ...parsed, profiles };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load ${configPath}: ${message}`);
  }
}

function environmentKey(providerId: BuiltinProviderId, suffix: 'ENABLED' | 'COMMAND'): string {
  return `CODEWAVE_${providerId.toUpperCase()}_${suffix}`;
}

function createProviderRevision(
  defaultProviderId: ProviderId,
  providers: ProviderConfiguration[],
): string {
  const effectivePolicy = {
    version: 2,
    defaultProviderId,
    providers: [...providers]
      .sort((left, right) => left.providerId.localeCompare(right.providerId))
      .map((provider) => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        profileKind: provider.profileKind,
        adapterKind: provider.adapterKind,
        enabled: provider.enabled,
        priority: provider.priority,
        accessMode: provider.accessMode,
        dataBoundary: provider.dataBoundary,
        command: provider.command,
        args: provider.args,
      })),
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
    const builtinProviders = PROVIDER_IDS.map((providerId) => {
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
    });

    const customProviders = Object.entries(this.filePolicy.profiles ?? {}).map(
      ([providerId, profile]) => ({
        providerId: providerId as CustomAcpProviderId,
        displayName: profile.displayName,
        profileKind: 'custom' as const,
        adapterKind: 'acp-v1' as const,
        enabled: profile.enabled,
        priority: profile.priority,
        accessMode: 'local-or-byok' as const,
        dataBoundary: 'local-or-user-configured' as const,
        requiresExplicitEnable: true,
        command: profile.command,
        args: [...profile.args],
        setupHint:
          'This local ACP process must support stable protocol v1. Credentials remain managed by the agent.',
        documentationUrl: 'https://agentclientprotocol.com/',
        configurationSource: 'file' as const,
      } satisfies ProviderConfiguration),
    );
    const providers = [...builtinProviders, ...customProviders].sort(
      (left, right) =>
        left.priority - right.priority || left.providerId.localeCompare(right.providerId),
    );
    const configuredIds = new Set(providers.map((provider) => provider.providerId));
    const environmentDefault = process.env.CODEWAVE_DEFAULT_PROVIDER;
    const defaultProviderId =
      typeof environmentDefault === 'string' && configuredIds.has(environmentDefault as ProviderId)
        ? (environmentDefault as ProviderId)
        : this.filePolicy.defaultProviderId &&
            configuredIds.has(this.filePolicy.defaultProviderId)
          ? this.filePolicy.defaultProviderId
          : DEFAULT_PROVIDER_ID;

    return {
      version: 2,
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
    if (!currentProvider) {
      throw new Error(`Provider ${providerId} is not configured.`);
    }
    if (
      patch.enabled === false &&
      currentProvider?.enabled &&
      !currentSnapshot.providers.some(
        (provider) => provider.providerId !== providerId && provider.enabled,
      )
    ) {
      throw new Error('At least one provider must remain enabled.');
    }

    if (currentProvider.profileKind === 'custom') {
      const current = this.filePolicy.profiles?.[providerId];
      if (!current) throw new Error(`Custom ACP provider ${providerId} is not configured.`);
      const next: CustomAcpProfileFileEntry = { ...current, args: [...current.args] };
      if (patch.enabled !== undefined) {
        if (typeof patch.enabled !== 'boolean') {
          throw new Error('enabled must be a boolean.');
        }
        next.enabled = patch.enabled;
      }
      if (patch.priority !== undefined) {
        next.priority = normalizePriority(patch.priority, current.priority);
      }
      if (patch.command !== undefined) {
        next.command = normalizeCommand(patch.command) ?? '';
        if (!next.command) throw new Error('Custom ACP profiles require a command.');
      }
      if (patch.args !== undefined) next.args = normalizeArgs(patch.args);
      if (patch.displayName !== undefined) {
        next.displayName = normalizeDisplayName(patch.displayName);
      }
      this.filePolicy = {
        ...this.filePolicy,
        version: 2,
        defaultProviderId:
          patch.enabled === false && currentSnapshot.defaultProviderId === providerId
            ? currentSnapshot.providers.find(
                (provider) => provider.providerId !== providerId && provider.enabled,
              )?.providerId
            : this.filePolicy.defaultProviderId,
        profiles: { ...(this.filePolicy.profiles ?? {}), [providerId]: next },
      };
      await this.persist();
      return this.snapshot();
    }

    if (!isBuiltinProviderId(providerId)) {
      throw new Error(`Provider ${providerId} is not a built-in provider.`);
    }
    if (patch.args !== undefined || patch.displayName !== undefined) {
      throw new Error('Built-in provider display names and arguments are not editable.');
    }
    const current = this.filePolicy.providers?.[providerId] ?? {};
    const next: BuiltinProviderFileEntry = { ...current };

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
      version: 2,
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

  async createAcpProvider(
    input: CreateAcpProviderRequest,
  ): Promise<ProviderRegistrySnapshot> {
    const currentSnapshot = this.snapshot();
    if (input.expectedProviderRevision !== currentSnapshot.revision) {
      throw new ProviderRevisionConflictError(currentSnapshot.revision);
    }
    if (!isCustomAcpProviderId(input.providerId)) {
      throw new Error(
        'Custom ACP provider IDs must use lowercase acp.* names up to 64 characters.',
      );
    }
    if (currentSnapshot.providers.some((provider) => provider.providerId === input.providerId)) {
      throw new Error(`Provider ${input.providerId} already exists.`);
    }
    const command = normalizeCommand(input.command);
    if (!command) throw new Error('Custom ACP profiles require a command.');
    const profile: CustomAcpProfileFileEntry = {
      displayName: normalizeDisplayName(input.displayName),
      enabled: false,
      priority: normalizePriority(input.priority, 100),
      command,
      args: normalizeArgs(input.args),
    };
    this.filePolicy = {
      ...this.filePolicy,
      version: 2,
      profiles: { ...(this.filePolicy.profiles ?? {}), [input.providerId]: profile },
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
    if (
      currentSnapshot.providers.some(
        (entry) => entry.providerId === process.env.CODEWAVE_DEFAULT_PROVIDER,
      )
    ) {
      throw new Error('The default provider is managed by CODEWAVE_DEFAULT_PROVIDER.');
    }
    const provider = currentSnapshot.providers.find(
      (configuration) => configuration.providerId === providerId,
    );
    if (!provider?.enabled) {
      throw new Error(`${provider?.displayName ?? providerId} must be enabled before it can become the default provider.`);
    }
    this.filePolicy = {
      ...this.filePolicy,
      version: 2,
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
  return isBuiltinProviderId(value) || isCustomAcpProviderId(value);
}

export function isConfiguredProviderId(
  snapshot: ProviderRegistrySnapshot,
  value: unknown,
): value is ProviderId {
  return (
    isKnownProviderId(value) &&
    snapshot.providers.some((provider) => provider.providerId === value)
  );
}
