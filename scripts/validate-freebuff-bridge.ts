import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FreebuffCliProvider } from '@codewave/provider-freebuff';
import type { ProviderRunContext, WorkbenchEvent } from '@codewave/protocol';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(repoRoot, 'scripts', 'fixtures', 'fake-freebuff-bridge.mjs');
const fixtureCommand = `"${process.execPath}" "${fixture}"`;

const compatible = await new FreebuffCliProvider({
  command: fixtureCommand,
  rootPath: repoRoot,
}).healthCheck();
assert.equal(compatible.available, true);
assert.match(compatible.detail, /automation bridge ready/i);

const versionOnly = await new FreebuffCliProvider({
  command: `"${process.execPath}"`,
  rootPath: repoRoot,
}).healthCheck();
assert.equal(versionOnly.available, false);
assert.match(versionOnly.detail, /did not prove.*protocol v1/i);

const rawCli = await new FreebuffCliProvider({
  rootPath: repoRoot,
}).healthCheck();
if (rawCli.available) {
  throw new Error('The raw interactive Freebuff CLI must never be marked automation-ready.');
}

function contextFor(events: WorkbenchEvent[]): ProviderRunContext {
  return {
    launchAttemptId: '00000000-0000-4000-8000-000000000002',
    session: {
      id: 'freebuff-validation-session',
      workspacePath: repoRoot,
      providerId: 'freebuff',
      providerConfigurationRevision: 'sha256:validation',
      createdAt: new Date().toISOString(),
      providerSessionId: null,
      approvalPolicy: 'manual',
      recovery: null,
      orchestration: null,
    },
    run: {
      id: 'freebuff-validation-run',
      sessionId: 'freebuff-validation-session',
      providerId: 'freebuff',
      providerConfigurationRevision: 'sha256:validation',
      prompt: 'must fail before raw CLI spawn',
      status: 'running',
      mode: 'execute',
      preRunCommit: null,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: null,
      errorMessage: null,
    },
    emitEvent: async (event) => void events.push(event),
    updateSession: async () => {},
    requestApproval: async () => ({ behavior: 'deny' }),
  };
}

const rawStartEvents: WorkbenchEvent[] = [];
await new FreebuffCliProvider({ rootPath: repoRoot }).startRun(
  contextFor(rawStartEvents),
);
assert.deepEqual(rawStartEvents.map((event) => event.type), ['run.failed']);
assert.match(String(rawStartEvents[0]?.payload.detail), /raw interactive CLI will not be spawned/i);

const impostorStartEvents: WorkbenchEvent[] = [];
await new FreebuffCliProvider({ command: `"${process.execPath}"`, rootPath: repoRoot }).startRun(
  contextFor(impostorStartEvents),
);
assert.deepEqual(impostorStartEvents.map((event) => event.type), ['run.failed']);
assert.match(String(impostorStartEvents[0]?.payload.message), /qualification failed/i);

process.stdout.write(
  'Freebuff bridge validation passed: compatible bridges prove protocol v1, version-only impostors and direct starts fail closed, and the raw CLI is never spawned for daemon automation.\n',
);
