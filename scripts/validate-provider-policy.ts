import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  ProviderHealth,
  ProviderId,
  ToolPlaneSnapshot,
} from '@codewave/protocol';
import { recommendProviderRoute } from '@codewave/orchestrator';
import { ProviderPolicyStore } from '../apps/daemon/src/provider-policy.js';

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'codewave-provider-policy-'));
const previousQwenEnabled = process.env.CODEWAVE_QWEN_ENABLED;

function health(
  providerId: ProviderId,
  priority: number,
  available = true,
): ProviderHealth {
  return {
    providerId,
    priority,
    available,
    detail: available ? 'ready' : 'disabled',
    capabilities: {
      daemonApprovalMediation: true,
      resumableSessions: true,
      checkpointEvents: providerId === 'qwen',
      inFlightSteering: 'unsupported',
    },
  };
}

function toolPlane(): ToolPlaneSnapshot {
  return {
    generatedAt: new Date(0).toISOString(),
    scope: 'workspace',
    sessionId: null,
    workspacePath: temporaryRoot,
    registryPath: null,
    registryEntries: [],
    mcpServers: [],
    registeredSessionTools: [],
    tools: [],
    providers: [
      {
        providerId: 'freebuff',
        available: true,
        readyTools: ['workspace-read', 'workspace-write', 'shell'],
        missingTools: ['network', 'mcp'],
        recentInvocationCount: 0,
        recentSuccessCount: 0,
        sessionRegisteredTools: [],
        sessionRegisteredCount: 0,
        summary: 'Freebuff tools ready.',
      },
      {
        providerId: 'opencode',
        available: true,
        readyTools: ['workspace-read', 'workspace-write', 'shell'],
        missingTools: ['network', 'mcp'],
        recentInvocationCount: 0,
        recentSuccessCount: 0,
        sessionRegisteredTools: [],
        sessionRegisteredCount: 0,
        summary: 'OpenCode tools ready.',
      },
    ],
  };
}

try {
  delete process.env.CODEWAVE_QWEN_ENABLED;
  const policy = new ProviderPolicyStore(temporaryRoot);
  const defaults = policy.snapshot();
  assert.match(defaults.revision, /^sha256:[a-f0-9]{64}$/);
  assert.equal(policy.snapshot().revision, defaults.revision);
  assert.equal(defaults.defaultProviderId, 'freebuff');
  assert.deepEqual(
    defaults.providers.map((provider) => [provider.providerId, provider.enabled]),
    [
      ['freebuff', true],
      ['opencode', true],
      ['qwen', false],
      ['gemini', false],
    ],
  );
  await assert.rejects(
    policy.setDefaultProvider('gemini', defaults.revision),
    /must be enabled before it can become the default provider/,
  );

  const qwenEnabled = await policy.updateProvider('qwen', {
    expectedProviderRevision: defaults.revision,
    enabled: true,
    priority: 25,
    command: 'qwen-paid-bridge',
  });
  assert.notEqual(qwenEnabled.revision, defaults.revision);
  await assert.rejects(
    policy.updateProvider('qwen', {
      expectedProviderRevision: defaults.revision,
      priority: 26,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'provider_revision_conflict',
  );
  await policy.setDefaultProvider('qwen', qwenEnabled.revision);
  const persisted = new ProviderPolicyStore(temporaryRoot).snapshot();
  assert.equal(persisted.defaultProviderId, 'qwen');
  assert.equal(persisted.revision, policy.snapshot().revision);
  assert.deepEqual(
    persisted.providers.find((provider) => provider.providerId === 'qwen'),
    {
      ...persisted.providers.find((provider) => provider.providerId === 'qwen'),
      enabled: true,
      priority: 25,
      command: 'qwen-paid-bridge',
      configurationSource: 'file',
    },
  );

  const serialized = JSON.parse(
    await readFile(path.join(temporaryRoot, '.codewave', 'providers.json'), 'utf8'),
  ) as { providers: { qwen: { command: string } } };
  assert.equal(serialized.providers.qwen.command, 'qwen-paid-bridge');

  process.env.CODEWAVE_QWEN_ENABLED = 'false';
  const environmentOverride = policy.snapshot().providers.find(
    (provider) => provider.providerId === 'qwen',
  );
  assert.equal(environmentOverride?.enabled, false);
  assert.equal(environmentOverride?.configurationSource, 'environment');

  delete process.env.CODEWAVE_QWEN_ENABLED;
  await policy.updateProvider('qwen', {
    expectedProviderRevision: policy.snapshot().revision,
    enabled: false,
  });
  assert.equal(policy.snapshot().defaultProviderId, 'freebuff');
  await policy.updateProvider('freebuff', {
    expectedProviderRevision: policy.snapshot().revision,
    enabled: false,
  });
  assert.equal(policy.snapshot().defaultProviderId, 'opencode');
  await assert.rejects(
    policy.updateProvider('opencode', {
      expectedProviderRevision: policy.snapshot().revision,
      enabled: false,
    }),
    /At least one provider must remain enabled/,
  );

  const recommendation = recommendProviderRoute({
    prompt: 'Implement and test the change',
    workspacePath: temporaryRoot,
    providers: [health('freebuff', 10), health('opencode', 20)],
    requiredTools: ['workspace-write', 'shell'],
    toolPlane: toolPlane(),
  });
  assert.equal(recommendation.primaryProviderId, 'freebuff');
  assert.equal(recommendation.fallbackProviderId, 'opencode');

  const freebuffUnavailable = recommendProviderRoute({
    prompt: 'Plan the work',
    workspacePath: temporaryRoot,
    providers: [health('freebuff', 10, false), health('opencode', 20)],
    requiredTools: [],
    toolPlane: toolPlane(),
  });
  assert.equal(freebuffUnavailable.primaryProviderId, 'opencode');

  console.log('Provider policy validation passed: free-first defaults, deterministic revision fencing, paid opt-in, environment precedence, persistence, and priority routing.');
} finally {
  if (previousQwenEnabled === undefined) {
    delete process.env.CODEWAVE_QWEN_ENABLED;
  } else {
    process.env.CODEWAVE_QWEN_ENABLED = previousQwenEnabled;
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
