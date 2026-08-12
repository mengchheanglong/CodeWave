import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const FIXTURES_DIR = path.join(SCRIPT_DIR, 'fixtures');
const QWEN_FIXTURE = path.join(FIXTURES_DIR, 'fake-qwen-runtime.mjs');
const GEMINI_FIXTURE = path.join(FIXTURES_DIR, 'fake-gemini-acp-agent.mjs');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const DAEMON_ENTRY = path.join(REPO_ROOT, 'apps', 'daemon', 'src', 'index.ts');
const cliOptions = parseCliOptions(process.argv.slice(2));

const EXPECTED_TOOL_REQUIREMENTS = [
  { toolName: 'run_shell_command', requirement: 'shell' },
  { toolName: 'read_file', requirement: 'workspace-read' },
  { toolName: 'mcp__docs__search', requirement: 'mcp' },
];
const EXPECTED_REQUIREMENT_BY_TOOL = Object.fromEntries(
  EXPECTED_TOOL_REQUIREMENTS.map((expected) => [
    expected.toolName,
    expected.requirement,
  ]),
);
const EXPECTED_REQUIRED_TOOL_NAMES = EXPECTED_TOOL_REQUIREMENTS.map(
  (expected) => expected.toolName,
).toSorted();
const UNCLASSIFIED_TOOL_NAMES = ['just_list'];
const ALL_FIXTURE_TOOL_NAMES = [
  ...EXPECTED_TOOL_REQUIREMENTS.map((item) => item.toolName),
  ...UNCLASSIFIED_TOOL_NAMES,
];
const EXPECTED_FALLBACK_PROBE_SURFACES = {
  qwen: 'qwen.mcp.list',
  gemini: 'gemini.mcp.list',
};
const EXPECTED_PROVIDER_RUNTIME_SURFACES = {
  qwen: 'qwen.system.tools',
  gemini: 'gemini.acp.session_update.tool_call',
};
const PROVIDER_IDS = ['qwen', 'gemini'];
const CLIENT_SCOPES = [
  'runtime:read',
  'providers:read',
  'providers:write',
  'sessions:read',
  'sessions:write',
  'runs:read',
  'runs:write',
  'orchestration:read',
  'orchestration:write',
  'tools:read',
  'workspace:read',
  'workspace:write',
  'approvals:write',
];
const connectionIdsByBaseUrl = new Map();
const SCENARIOS = [
  {
    id: 'failure',
    expectedCliFallbackStatusByProvider: {
      qwen: 'failed',
      gemini: 'failed',
    },
    envOverrides: {
      CODEWAVE_FAKE_QWEN_MCP_LIST_FAIL: '1',
      CODEWAVE_FAKE_GEMINI_MCP_LIST_FAIL: '1',
    },
  },
  {
    id: 'timeout',
    expectedCliFallbackStatusByProvider: {
      qwen: 'timeout',
      gemini: 'timeout',
    },
    envOverrides: {
      CODEWAVE_CONNECTED_TOOL_PROBE_TIMEOUT_MS: '250',
      CODEWAVE_FAKE_QWEN_MCP_LIST_TIMEOUT: '1',
      CODEWAVE_FAKE_QWEN_MCP_LIST_TIMEOUT_MS: '2000',
      CODEWAVE_FAKE_GEMINI_MCP_LIST_TIMEOUT: '1',
      CODEWAVE_FAKE_GEMINI_MCP_LIST_TIMEOUT_MS: '2000',
    },
  },
  {
    id: 'mixed-qwen-timeout-gemini-failure',
    expectedCliFallbackStatusByProvider: {
      qwen: 'timeout',
      gemini: 'failed',
    },
    envOverrides: {
      CODEWAVE_CONNECTED_TOOL_PROBE_TIMEOUT_MS: '250',
      CODEWAVE_FAKE_QWEN_MCP_LIST_TIMEOUT: '1',
      CODEWAVE_FAKE_QWEN_MCP_LIST_TIMEOUT_MS: '2000',
      CODEWAVE_FAKE_GEMINI_MCP_LIST_FAIL: '1',
    },
  },
  {
    id: 'mixed-qwen-failure-gemini-timeout',
    expectedCliFallbackStatusByProvider: {
      qwen: 'failed',
      gemini: 'timeout',
    },
    envOverrides: {
      CODEWAVE_CONNECTED_TOOL_PROBE_TIMEOUT_MS: '250',
      CODEWAVE_FAKE_QWEN_MCP_LIST_FAIL: '1',
      CODEWAVE_FAKE_GEMINI_MCP_LIST_TIMEOUT: '1',
      CODEWAVE_FAKE_GEMINI_MCP_LIST_TIMEOUT_MS: '2000',
    },
  },
];

for (const requiredPath of [
  QWEN_FIXTURE,
  GEMINI_FIXTURE,
  TSX_CLI,
  DAEMON_ENTRY,
]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Missing required file: ${requiredPath}`);
  }
}

const scenarioResults = [];

for (const scenario of SCENARIOS) {
  const result = await runScenario(scenario);
  scenarioResults.push(result);
}

const scenarioMatrix = assertScenarioSummaryStability(scenarioResults);
const summary = buildSummary(scenarioResults, scenarioMatrix);
emitSummaryArtifacts(summary);

process.stdout.write('\nDeterministic registration validation passed.\n');
for (const result of scenarioResults) {
  process.stdout.write(
    `[${result.scenarioId}] qwen: run=${result.qwen.runId}, requirements=${result.qwen.requirements.join(',')}, unclassifiedExcluded=${result.qwen.unclassifiedExcluded}, cliFallback=${result.qwen.cliFallbackStatus}\n`,
  );
  process.stdout.write(
    `[${result.scenarioId}] gemini: run=${result.gemini.runId}, requirements=${result.gemini.requirements.join(',')}, unclassifiedExcluded=${result.gemini.unclassifiedExcluded}, cliFallback=${result.gemini.cliFallbackStatus}\n`,
  );
}

async function runScenario(scenario) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'codewave-registration-'));
  const daemonRoot = path.join(tempRoot, 'daemon-root');
  const workspacePath = path.join(tempRoot, 'workspace');
  mkdirSync(daemonRoot, { recursive: true });
  mkdirSync(workspacePath, { recursive: true });

  const port = 4300 + Math.floor(Math.random() * 500);
  const baseUrl = `http://127.0.0.1:${port}`;
  const daemonLogs = [];
  const daemon = spawn(process.execPath, [TSX_CLI, DAEMON_ENTRY], {
    cwd: daemonRoot,
    env: {
      ...process.env,
      CODEWAVE_PORT: String(port),
      CODEWAVE_QWEN_COMMAND: QWEN_FIXTURE,
      CODEWAVE_GEMINI_COMMAND: GEMINI_FIXTURE,
      CODEWAVE_GEMINI_MODE: 'acp',
      CODEWAVE_CONNECTED_TOOL_PROBE_TIMEOUT_MS: '500',
      CODEWAVE_FAKE_QWEN_RUNTIME_TOOLS: ALL_FIXTURE_TOOL_NAMES.join(','),
      CODEWAVE_FAKE_GEMINI_TOOL_TITLES: ALL_FIXTURE_TOOL_NAMES.join(','),
      ...scenario.envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  daemon.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    daemonLogs.push(`[stdout] ${text.trimEnd()}`);
  });

  daemon.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    daemonLogs.push(`[stderr] ${text.trimEnd()}`);
  });

  try {
    await waitForHealth(baseUrl, 15000);
    await ensureConnection(baseUrl);

    const runtime = await requestJson(baseUrl, 'GET', '/api/runtime');
    const qwenHealth = runtime.providers.find(
      (provider) => provider.providerId === 'qwen',
    );
    const geminiHealth = runtime.providers.find(
      (provider) => provider.providerId === 'gemini',
    );
    assert.equal(
      qwenHealth?.available,
      true,
      `[${scenario.id}] Qwen should be available for deterministic probe.`,
    );
    assert.equal(
      geminiHealth?.available,
      true,
      `[${scenario.id}] Gemini should be available for deterministic probe.`,
    );

    const qwen = await runAndValidateProvider({
      scenarioId: scenario.id,
      expectedCliFallbackStatus:
        scenario.expectedCliFallbackStatusByProvider.qwen,
      baseUrl,
      workspacePath,
      providerId: 'qwen',
      providerRevision: runtime.providerRegistry.revision,
    });

    const gemini = await runAndValidateProvider({
      scenarioId: scenario.id,
      expectedCliFallbackStatus:
        scenario.expectedCliFallbackStatusByProvider.gemini,
      baseUrl,
      workspacePath,
      providerId: 'gemini',
      providerRevision: runtime.providerRegistry.revision,
    });

    return {
      scenarioId: scenario.id,
      qwen,
      gemini,
    };
  } catch (error) {
    const logTail = daemonLogs.slice(-60).join('\n');
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[${scenario.id}] ${message}\n\nDaemon log tail:\n${logTail}`,
    );
  } finally {
    daemon.kill();
    await Promise.race([
      once(daemon, 'close'),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);

    await cleanupTempRoot(tempRoot);
    connectionIdsByBaseUrl.delete(baseUrl);
  }
}

async function cleanupTempRoot(tempRoot) {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined;

      if (code === 'ENOENT') {
        return;
      }

      const retryable = code === 'EPERM' || code === 'EBUSY';
      if (!retryable || attempt === maxAttempts) {
        process.stderr.write(
          `warning: unable to clean temp path ${tempRoot}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        return;
      }

      await sleep(100 * attempt);
    }
  }
}

function assertScenarioSummaryStability(results) {
  assert.equal(
    results.length,
    SCENARIOS.length,
    `Expected ${SCENARIOS.length} scenario summaries but received ${results.length}.`,
  );

  const matrix = buildScenarioMatrix(results);
  assert.equal(
    matrix.driftDetected,
    false,
    `Observed registration evidence drifted from expected scenario outputs:\n- ${matrix.mismatches.join('\n- ')}`,
  );

  return matrix;
}

function parseCliOptions(argv) {
  let summaryJsonPath = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--summary-json') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Expected a file path after --summary-json.');
      }

      summaryJsonPath = value;
      index += 1;
      continue;
    }

    if (argument.startsWith('--summary-json=')) {
      const value = argument.slice('--summary-json='.length);
      if (!value) {
        throw new Error('Expected a non-empty file path for --summary-json.');
      }

      summaryJsonPath = value;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    summaryJsonPath,
  };
}

function buildScenarioMatrix(results) {
  const expectedByScenario = {};
  for (const scenario of SCENARIOS) {
    expectedByScenario[scenario.id] = {
      qwen: buildExpectedProviderEvidence(
        'qwen',
        scenario.expectedCliFallbackStatusByProvider.qwen,
      ),
      gemini: buildExpectedProviderEvidence(
        'gemini',
        scenario.expectedCliFallbackStatusByProvider.gemini,
      ),
    };
  }

  const observedByScenario = {};
  for (const result of results) {
    observedByScenario[result.scenarioId] = {
      qwen: normalizeProviderEvidence(result.qwen),
      gemini: normalizeProviderEvidence(result.gemini),
    };
  }

  const mismatches = [];

  for (const scenario of SCENARIOS) {
    const expectedScenario = expectedByScenario[scenario.id];
    const observedScenario = observedByScenario[scenario.id];
    if (!observedScenario) {
      mismatches.push(
        `${scenario.id}: missing observed scenario summary in JSON matrix.`,
      );
      continue;
    }

    for (const providerId of PROVIDER_IDS) {
      const expectedProvider = expectedScenario[providerId];
      const observedProvider = observedScenario[providerId];
      if (!observedProvider) {
        mismatches.push(
          `${scenario.id}.${providerId}: missing observed provider summary in JSON matrix.`,
        );
        continue;
      }

      if (
        observedProvider.providerRuntime.confirmedBy !==
        expectedProvider.providerRuntime.confirmedBy
      ) {
        mismatches.push(
          `${scenario.id}.${providerId}.providerRuntime.confirmedBy: expected ${expectedProvider.providerRuntime.confirmedBy} but observed ${observedProvider.providerRuntime.confirmedBy}.`,
        );
      }
      if (
        observedProvider.providerRuntime.registrationCount <
        expectedProvider.providerRuntime.minimumRegistrationCount
      ) {
        mismatches.push(
          `${scenario.id}.${providerId}.providerRuntime.registrationCount: expected at least ${expectedProvider.providerRuntime.minimumRegistrationCount} but observed ${observedProvider.providerRuntime.registrationCount}.`,
        );
      }
      if (
        !areStringArraysEqual(
          observedProvider.providerRuntime.toolNames,
          expectedProvider.providerRuntime.requiredToolNames,
        )
      ) {
        mismatches.push(
          `${scenario.id}.${providerId}.providerRuntime.toolNames: expected ${JSON.stringify(expectedProvider.providerRuntime.requiredToolNames)} but observed ${JSON.stringify(observedProvider.providerRuntime.toolNames)}.`,
        );
      }
      if (
        !areObjectEntriesEqual(
          observedProvider.providerRuntime.requirementByTool,
          expectedProvider.providerRuntime.requirementByTool,
        )
      ) {
        mismatches.push(
          `${scenario.id}.${providerId}.providerRuntime.requirementByTool: expected ${JSON.stringify(expectedProvider.providerRuntime.requirementByTool)} but observed ${JSON.stringify(observedProvider.providerRuntime.requirementByTool)}.`,
        );
      }
      if (
        observedProvider.providerRuntime.registrationKind !==
        expectedProvider.providerRuntime.registrationKind
      ) {
        mismatches.push(
          `${scenario.id}.${providerId}.providerRuntime.registrationKind: expected ${expectedProvider.providerRuntime.registrationKind} but observed ${observedProvider.providerRuntime.registrationKind}.`,
        );
      }
      if (
        observedProvider.providerRuntime.providerSurface !==
        expectedProvider.providerRuntime.providerSurface
      ) {
        mismatches.push(
          `${scenario.id}.${providerId}.providerRuntime.providerSurface: expected ${expectedProvider.providerRuntime.providerSurface} but observed ${observedProvider.providerRuntime.providerSurface}.`,
        );
      }

      if (
        observedProvider.providerCliFallback.confirmedBy !==
        expectedProvider.providerCliFallback.confirmedBy
      ) {
        mismatches.push(
          `${scenario.id}.${providerId}.providerCliFallback.confirmedBy: expected ${expectedProvider.providerCliFallback.confirmedBy} but observed ${observedProvider.providerCliFallback.confirmedBy}.`,
        );
      }
      if (
        observedProvider.providerCliFallback.registrationCount <
        expectedProvider.providerCliFallback.minimumRegistrationCount
      ) {
        mismatches.push(
          `${scenario.id}.${providerId}.providerCliFallback.registrationCount: expected at least ${expectedProvider.providerCliFallback.minimumRegistrationCount} but observed ${observedProvider.providerCliFallback.registrationCount}.`,
        );
      }
      if (
        observedProvider.providerCliFallback.fallbackStatus !==
        expectedProvider.providerCliFallback.fallbackStatus
      ) {
        mismatches.push(
          `${scenario.id}.${providerId}.providerCliFallback.fallbackStatus: expected ${expectedProvider.providerCliFallback.fallbackStatus} but observed ${observedProvider.providerCliFallback.fallbackStatus}.`,
        );
      }
      if (
        observedProvider.providerCliFallback.probeSurface !==
        expectedProvider.providerCliFallback.probeSurface
      ) {
        mismatches.push(
          `${scenario.id}.${providerId}.providerCliFallback.probeSurface: expected ${expectedProvider.providerCliFallback.probeSurface} but observed ${observedProvider.providerCliFallback.probeSurface}.`,
        );
      }

      if (
        observedProvider.eventObserved.confirmedBy !==
        expectedProvider.eventObserved.confirmedBy
      ) {
        mismatches.push(
          `${scenario.id}.${providerId}.eventObserved.confirmedBy: expected ${expectedProvider.eventObserved.confirmedBy} but observed ${observedProvider.eventObserved.confirmedBy}.`,
        );
      }
      if (
        observedProvider.eventObserved.registrationCount <
        expectedProvider.eventObserved.minimumRegistrationCount
      ) {
        mismatches.push(
          `${scenario.id}.${providerId}.eventObserved.registrationCount: expected at least ${expectedProvider.eventObserved.minimumRegistrationCount} but observed ${observedProvider.eventObserved.registrationCount}.`,
        );
      }

      for (const disallowedToolName of expectedProvider.eventObserved.disallowedToolNames) {
        if (observedProvider.eventObserved.toolNames.includes(disallowedToolName)) {
          mismatches.push(
            `${scenario.id}.${providerId}.eventObserved.toolNames: observed disallowed tool ${disallowedToolName}.`,
          );
        }
      }
    }
  }

  for (const observedScenarioId of Object.keys(observedByScenario)) {
    if (!expectedByScenario[observedScenarioId]) {
      mismatches.push(
        `${observedScenarioId}: unexpected observed scenario summary present in JSON matrix.`,
      );
    }
  }

  return {
    providers: [...PROVIDER_IDS],
    expectedByScenario,
    observedByScenario,
    driftDetected: mismatches.length > 0,
    mismatches,
  };
}

function buildExpectedProviderEvidence(providerId, expectedFallbackStatus) {
  return {
    providerRuntime: {
      confirmedBy: 'provider-runtime',
      minimumRegistrationCount: EXPECTED_TOOL_REQUIREMENTS.length,
      requiredToolNames: [...EXPECTED_REQUIRED_TOOL_NAMES],
      requirementByTool: { ...EXPECTED_REQUIREMENT_BY_TOOL },
      registrationKind: 'provider-enumeration',
      providerSurface: EXPECTED_PROVIDER_RUNTIME_SURFACES[providerId],
    },
    providerCliFallback: {
      confirmedBy: 'provider-cli',
      minimumRegistrationCount: 1,
      fallbackStatus: expectedFallbackStatus,
      probeSurface: EXPECTED_FALLBACK_PROBE_SURFACES[providerId],
    },
    eventObserved: {
      confirmedBy: 'event-observed',
      minimumRegistrationCount: 0,
      disallowedToolNames: [...UNCLASSIFIED_TOOL_NAMES],
    },
  };
}

function normalizeProviderEvidence(providerSummary) {
  return {
    providerRuntime: {
      ...providerSummary.evidence.providerRuntime,
      toolNames: [...providerSummary.evidence.providerRuntime.toolNames].toSorted(),
      requirementByTool: stableObjectEntries(
        providerSummary.evidence.providerRuntime.requirementByTool,
      ),
    },
    providerCliFallback: {
      ...providerSummary.evidence.providerCliFallback,
      toolNames: [...providerSummary.evidence.providerCliFallback.toolNames].toSorted(),
    },
    eventObserved: {
      ...providerSummary.evidence.eventObserved,
      toolNames: [...providerSummary.evidence.eventObserved.toolNames].toSorted(),
    },
  };
}

function stableObjectEntries(value) {
  return Object.fromEntries(
    Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

function areStringArraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function areObjectEntriesEqual(left, right) {
  return (
    JSON.stringify(stableObjectEntries(left)) ===
    JSON.stringify(stableObjectEntries(right))
  );
}

function uniqueToolNames(registrations) {
  return [
    ...new Set(
      registrations
        .map((registration) => registration.toolName)
        .filter((toolName) => typeof toolName === 'string' && toolName.length > 0),
    ),
  ].toSorted();
}

function assertSingleStringValue(values, errorMessage) {
  assert.equal(values.length, 1, errorMessage);
  return values[0];
}

function valueSet(registrations, selector) {
  return [
    ...new Set(
      registrations
        .map(selector)
        .filter((value) => typeof value === 'string' && value.length > 0),
    ),
  ];
}

function toolRequirementMap(registrations) {
  const map = {};
  for (const registration of registrations) {
    if (typeof registration.toolName !== 'string' || registration.toolName.length === 0) {
      continue;
    }

    map[registration.toolName] = registration.requirement;
  }

  return stableObjectEntries(map);
}

function requirementSummary() {
  return EXPECTED_TOOL_REQUIREMENTS.map(
    (expected) => `${expected.toolName}:${expected.requirement}`,
  );
}

function unclassifiedSummary() {
  return UNCLASSIFIED_TOOL_NAMES.join(',');
}

function buildSummary(results, matrix) {
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: 3,
    scenarioMatrix: matrix,
    scenarios: results.map((result) => ({
      id: result.scenarioId,
      providers: {
        qwen: result.qwen,
        gemini: result.gemini,
      },
    })),
  };
}

function emitSummaryArtifacts(summary) {
  if (!cliOptions.summaryJsonPath) {
    return;
  }

  const outputPath = path.resolve(REPO_ROOT, cliOptions.summaryJsonPath);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote registration summary JSON: ${outputPath}\n`);
}

async function runAndValidateProvider({
  scenarioId,
  expectedCliFallbackStatus,
  baseUrl,
  workspacePath,
  providerId,
  providerRevision,
}) {
  const expectedSurface = EXPECTED_PROVIDER_RUNTIME_SURFACES[providerId];
  if (!expectedSurface) {
    throw new Error(
      `[${scenarioId}] ${providerId} has no expected runtime provider surface.`,
    );
  }

  const sessionResponse = await requestJson(baseUrl, 'POST', '/api/sessions', {
    workspacePath,
    providerId,
    expectedProviderRevision: providerRevision,
    approvalPolicy: 'manual',
  });

  const runResponse = await requestJson(
    baseUrl,
    'POST',
    `/api/sessions/${sessionResponse.id}/runs`,
    {
      prompt: `deterministic registration probe (${providerId})`,
      expectedProviderRevision: providerRevision,
    },
  );

  const runSnapshot = await waitForRun(baseUrl, runResponse.run.id, 15000);
  assert.equal(
    runSnapshot.run.status,
    'completed',
    `${providerId} run should complete during deterministic registration probe.`,
  );

  for (const expected of EXPECTED_TOOL_REQUIREMENTS) {
    const registeredEvent = runSnapshot.events.find(
      (event) =>
        event.type === 'tool.registered' &&
        event.payload?.toolName === expected.toolName,
    );
    assert.ok(
      registeredEvent,
      `[${scenarioId}] ${providerId} should emit tool.registered for ${expected.toolName}.`,
    );
    assert.equal(
      registeredEvent.payload?.requirement,
      expected.requirement,
      `[${scenarioId}] ${providerId} event requirement for ${expected.toolName} should map to ${expected.requirement}.`,
    );
  }

  for (const toolName of UNCLASSIFIED_TOOL_NAMES) {
    const registeredEvent = runSnapshot.events.find(
      (event) =>
        event.type === 'tool.registered' &&
        event.payload?.toolName === toolName,
    );
    assert.equal(
      registeredEvent,
      undefined,
      `[${scenarioId}] ${providerId} should not emit tool.registered for unclassified ${toolName}.`,
    );
  }

  const toolPlanePath =
    `/api/tool-plane?${new URLSearchParams({
      workspacePath,
      sessionId: sessionResponse.id,
    }).toString()}`;
  const toolPlaneResponse = await requestJson(baseUrl, 'GET', toolPlanePath);

  const providerRegistrations = toolPlaneResponse.snapshot.registeredSessionTools.filter(
    (entry) => entry.providerId === providerId,
  );
  const providerRuntimeRegistrations = providerRegistrations.filter(
    (entry) => entry.metadata?.confirmedBy === 'provider-runtime',
  );
  const providerCliRegistrations = providerRegistrations.filter(
    (entry) => entry.metadata?.confirmedBy === 'provider-cli',
  );
  const eventObservedRegistrations = providerRegistrations.filter(
    (entry) => entry.metadata?.confirmedBy === 'event-observed',
  );

  for (const expected of EXPECTED_TOOL_REQUIREMENTS) {
    const registration = providerRuntimeRegistrations.find(
      (entry) => entry.toolName === expected.toolName,
    );

    assert.ok(
      registration,
      `[${scenarioId}] ${providerId} should persist ${expected.toolName} session registration.`,
    );
    assert.equal(
      registration.requirement,
      expected.requirement,
      `[${scenarioId}] ${providerId} ${expected.toolName} registration should map to ${expected.requirement}.`,
    );
    assert.equal(
      registration.metadata?.registrationKind,
      'provider-enumeration',
      `[${scenarioId}] ${providerId} ${expected.toolName} registration kind should remain provider-enumeration.`,
    );
    assert.equal(
      registration.metadata?.confirmedBy,
      'provider-runtime',
      `[${scenarioId}] ${providerId} ${expected.toolName} registration should be runtime-confirmed.`,
    );
    assert.equal(
      registration.metadata?.providerSurface,
      expectedSurface,
      `[${scenarioId}] ${providerId} ${expected.toolName} registration should preserve expected provider surface metadata.`,
    );
  }

  for (const toolName of UNCLASSIFIED_TOOL_NAMES) {
    const registration = providerRegistrations.find(
      (entry) => entry.toolName === toolName,
    );
    assert.equal(
      registration,
      undefined,
      `[${scenarioId}] ${providerId} should not persist an unclassified registration for ${toolName}.`,
    );
  }

  assert.ok(
    providerCliRegistrations.length > 0,
    `[${scenarioId}] ${providerId} should retain provider-cli registrations even when mcp list fallback is active.`,
  );

  const observedCliFallbackStatuses = valueSet(
    providerCliRegistrations,
    (registration) => registration.metadata?.mcpListProbeStatus,
  );
  const observedCliFallbackStatus = assertSingleStringValue(
    observedCliFallbackStatuses,
    `[${scenarioId}] ${providerId} provider-cli registrations should agree on one mcp list probe status.`,
  );
  assert.equal(
    observedCliFallbackStatus,
    expectedCliFallbackStatus,
    `[${scenarioId}] ${providerId} observed provider-cli fallback status should match expectation.`,
  );

  const observedCliProbeSurfaces = valueSet(
    providerCliRegistrations,
    (registration) => registration.metadata?.mcpListProbeSurface,
  );
  const observedCliProbeSurface = assertSingleStringValue(
    observedCliProbeSurfaces,
    `[${scenarioId}] ${providerId} provider-cli registrations should agree on one mcp list probe surface.`,
  );
  assert.equal(
    observedCliProbeSurface,
    EXPECTED_FALLBACK_PROBE_SURFACES[providerId],
    `[${scenarioId}] ${providerId} observed provider-cli fallback probe surface should match expected surface.`,
  );

  const providerRuntimeRegistrationKinds = valueSet(
    providerRuntimeRegistrations,
    (registration) => registration.metadata?.registrationKind,
  );
  const providerRuntimeRegistrationKind = assertSingleStringValue(
    providerRuntimeRegistrationKinds,
    `[${scenarioId}] ${providerId} provider-runtime registrations should agree on one registration kind.`,
  );
  assert.equal(
    providerRuntimeRegistrationKind,
    'provider-enumeration',
    `[${scenarioId}] ${providerId} provider-runtime registration kind should stay provider-enumeration.`,
  );

  const providerRuntimeSurfaces = valueSet(
    providerRuntimeRegistrations,
    (registration) => registration.metadata?.providerSurface,
  );
  const providerRuntimeSurface = assertSingleStringValue(
    providerRuntimeSurfaces,
    `[${scenarioId}] ${providerId} provider-runtime registrations should agree on one provider surface.`,
  );
  assert.equal(
    providerRuntimeSurface,
    expectedSurface,
    `[${scenarioId}] ${providerId} provider-runtime provider surface should match expected surface.`,
  );

  for (const registration of providerCliRegistrations) {
    assert.equal(
      registration.metadata?.mcpListProbeStatus,
      expectedCliFallbackStatus,
      `[${scenarioId}] ${providerId} provider-cli registration ${registration.toolName} should include ${expectedCliFallbackStatus} mcp list probe status.`,
    );
    assert.equal(
      registration.metadata?.mcpListProbeSurface,
      EXPECTED_FALLBACK_PROBE_SURFACES[providerId],
      `[${scenarioId}] ${providerId} provider-cli registration ${registration.toolName} should record the probe surface.`,
    );
    assert.equal(
      typeof registration.metadata?.mcpListProbeDetail,
      'string',
      `[${scenarioId}] ${providerId} provider-cli registration ${registration.toolName} should record probe detail.`,
    );

    if (expectedCliFallbackStatus === 'timeout') {
      assert.match(
        String(registration.metadata?.mcpListProbeDetail ?? ''),
        /timed out/i,
        `[${scenarioId}] ${providerId} provider-cli registration ${registration.toolName} should include timeout wording in probe detail.`,
      );
    }
  }

  const mcpListSurfaceRegistration = providerRegistrations.find(
    (entry) =>
      entry.metadata?.providerSurface === EXPECTED_FALLBACK_PROBE_SURFACES[providerId],
  );
  assert.equal(
    mcpListSurfaceRegistration,
    undefined,
    `[${scenarioId}] ${providerId} should not claim provider-surface mcp.list registrations when mcp list probe fallback is active.`,
  );

  return {
    runId: runSnapshot.run.id,
    requirements: requirementSummary(),
    unclassifiedExcluded: unclassifiedSummary(),
    cliFallbackStatus: observedCliFallbackStatus,
    evidence: {
      providerRuntime: {
        confirmedBy: 'provider-runtime',
        registrationCount: providerRuntimeRegistrations.length,
        toolNames: uniqueToolNames(providerRuntimeRegistrations),
        requirementByTool: toolRequirementMap(providerRuntimeRegistrations),
        registrationKind: providerRuntimeRegistrationKind,
        providerSurface: providerRuntimeSurface,
      },
      providerCliFallback: {
        confirmedBy: 'provider-cli',
        registrationCount: providerCliRegistrations.length,
        toolNames: uniqueToolNames(providerCliRegistrations),
        fallbackStatus: observedCliFallbackStatus,
        probeSurface: observedCliProbeSurface,
      },
      eventObserved: {
        confirmedBy: 'event-observed',
        registrationCount: eventObservedRegistrations.length,
        toolNames: uniqueToolNames(eventObservedRegistrations),
      },
    },
  };
}

async function waitForHealth(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await requestJson(baseUrl, 'GET', '/api/health');
      if (health.ok === true) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }

    await sleep(100);
  }

  throw new Error(`Daemon health check did not succeed within ${timeoutMs}ms.`);
}

async function waitForRun(baseUrl, runId, timeoutMs) {
  const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await requestJson(baseUrl, 'GET', `/api/runs/${runId}`);
    if (terminalStatuses.has(snapshot.run.status)) {
      return snapshot;
    }

    await sleep(120);
  }

  throw new Error(`Run ${runId} did not reach a terminal status within ${timeoutMs}ms.`);
}

async function requestJson(baseUrl, method, pathname, body) {
  const connectionId =
    pathname === '/api/health' || pathname === '/api/handshake'
      ? null
      : await ensureConnection(baseUrl);
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (connectionId) headers.set('X-CodeWave-Connection', connectionId);
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const reason =
      payload && typeof payload === 'object' && typeof payload.error === 'string'
        ? payload.error
        : `${method} ${pathname} failed with status ${response.status}`;
    throw new Error(reason);
  }

  return payload;
}

async function ensureConnection(baseUrl) {
  const current = connectionIdsByBaseUrl.get(baseUrl);
  if (current) return current;
  const response = await fetch(`${baseUrl}/api/handshake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientName: 'registration-harness',
      clientVersion: '1.0.0-test',
      protocolVersion: 1,
      requestedScopes: CLIENT_SCOPES,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.connectionId) {
    throw new Error(payload?.error || 'Daemon handshake failed.');
  }
  connectionIdsByBaseUrl.set(baseUrl, payload.connectionId);
  return payload.connectionId;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
