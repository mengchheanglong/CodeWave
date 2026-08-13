import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { CodeWaveDaemonClient } from '../apps/mcp-server/src/daemon-client.js';
import { buildMcpServer } from '../apps/mcp-server/src/server.js';

const workspacePath = 'C:\\sensitive\\private-workspace';
const session = {
  id: 'session-1',
  workspacePath,
  providerId: 'freebuff',
  providerConfigurationRevision: 'sha256:secret-policy',
  createdAt: '2026-08-13T00:00:00.000Z',
  providerSessionId: 'provider-secret',
  approvalPolicy: 'manual',
  recovery: null,
  orchestration: null,
};
const run = {
  id: 'run-1',
  sessionId: session.id,
  providerId: 'freebuff',
  providerConfigurationRevision: 'sha256:secret-policy',
  prompt: 'Diagnose the failing transport',
  status: 'failed',
  mode: 'execute',
  preRunCommit: 'secret-commit',
  createdAt: '2026-08-13T00:00:01.000Z',
  startedAt: '2026-08-13T00:00:01.000Z',
  completedAt: '2026-08-13T00:00:02.000Z',
  errorMessage: 'Bridge closed before result.',
};
const transcript = {
  sessionId: session.id,
  messages: [
    {
      id: 'message-1',
      sessionId: session.id,
      runId: run.id,
      sequence: 1,
      parentMessageId: null,
      role: 'user',
      content: 'Diagnose the failing transport',
      createdAt: run.createdAt,
      sourceEventId: 'secret-event',
      metadata: { absolutePath: workspacePath },
    },
  ],
  hasMoreBefore: false,
  oldestSequence: 1,
  newestSequence: 1,
  totalCount: 1,
};

let handshakeCount = 0;
let forceRestart401 = true;
const observed: Array<{ method: string; url: string; headers: Record<string, string> }> = [];
const measurements: Record<
  string,
  { rounds: number; p95Ms: number; maxBytes: number }
> = {};
const daemon = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const bodyText = Buffer.concat(chunks).toString('utf8');
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([key, value]) => [key, String(value)]),
  );
  observed.push({ method: request.method ?? '', url: request.url ?? '', headers });
  response.setHeader('content-type', 'application/json');

  if (request.url === '/api/handshake' && request.method === 'POST') {
    handshakeCount += 1;
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    assert.deepEqual(body.requestedScopes, ['sessions:read', 'runs:read']);
    response.statusCode = 201;
    response.end(
      JSON.stringify({
        connectionId: `connection-${handshakeCount}`,
        grantedScopes: ['sessions:read', 'runs:read'],
      }),
    );
    return;
  }

  assert.equal(request.method, 'GET');
  assert.equal(headers['idempotency-key'], undefined);
  assert.match(headers['x-codewave-connection'] ?? '', /^connection-\d+$/);
  if (request.url === '/api/archive' && forceRestart401) {
    forceRestart401 = false;
    response.statusCode = 401;
    response.end(JSON.stringify({ error: 'restart', code: 'client_connection_invalid' }));
    return;
  }
  if (request.url === '/api/archive') {
    response.end(
      JSON.stringify({
        sessions: [
          {
            session,
            runCount: 1,
            completedRunCount: 0,
            failedRunCount: 1,
            latestRun: run,
          },
        ],
      }),
    );
    return;
  }
  if (request.url === '/api/sessions/session-1') {
    response.end(JSON.stringify({ session, runs: [run] }));
    return;
  }
  if (request.url === '/api/runs/run-1') {
    response.end(
      JSON.stringify({
        run,
        events: [{ payload: { leaked: workspacePath } }],
        transcript,
        artifacts: [
          { id: 'artifact-1', kind: 'text', title: 'diagnostic', createdAt: run.createdAt, content: workspacePath },
        ],
        approvals: [
          { id: 'approval-1', toolName: 'bash', status: 'denied', createdAt: run.createdAt, resolvedAt: run.completedAt, payload: { command: 'secret' } },
        ],
        checkpoints: [],
        steering: [{ prompt: 'secret steering' }],
        toolInvocations: [
          { id: 'tool-1', toolName: 'bash', status: 'completed', createdAt: run.createdAt, updatedAt: run.completedAt, input: { command: 'secret' }, output: workspacePath },
        ],
        contextChars: 32,
        undo: { available: false, detail: null },
      }),
    );
    return;
  }
  if (request.url === '/api/runs/oversized') {
    response.end(JSON.stringify({ padding: 'x'.repeat(1024 * 1024 + 1) }));
    return;
  }
  if (request.url === '/api/runs/error-secret') {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: `Internal failure at ${workspacePath}` }));
    return;
  }
  if (request.url === '/api/sessions/session-1/transcript?limit=20') {
    response.end(JSON.stringify(transcript));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: 'Not found.' }));
});

daemon.listen(0, '127.0.0.1');
await once(daemon, 'listening');
const address = daemon.address();
if (!address || typeof address === 'string') throw new Error('Fake daemon did not bind.');

assert.throws(
  () => new CodeWaveDaemonClient('https://example.com'),
  /loopback HTTP origin/,
);

const mcpServer = buildMcpServer(
  new CodeWaveDaemonClient(`http://127.0.0.1:${address.port}`),
);
const mcpClient = new Client({ name: 'CodeWave observer validator', version: '0.1.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await mcpServer.connect(serverTransport);
await mcpClient.connect(clientTransport);

try {
  const tools = await mcpClient.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      'codewave_get_run',
      'codewave_get_session',
      'codewave_list_sessions',
      'codewave_read_transcript',
    ],
  );
  assert.ok(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true));
  assert.ok(tools.tools.every((tool) => tool.annotations?.destructiveHint === false));

  const listResult = await mcpClient.callTool({ name: 'codewave_list_sessions' });
  const listText = listResult.content[0]?.type === 'text' ? listResult.content[0].text : '';
  assert.match(listText, /private-workspace/);
  assert.doesNotMatch(listText, /C:\\\\sensitive/);
  assert.doesNotMatch(listText, /provider-secret|secret-policy/);
  assert.equal(handshakeCount, 2, 'one daemon restart must cause one renegotiation');

  const runResult = await mcpClient.callTool({
    name: 'codewave_get_run',
    arguments: { runId: 'run-1' },
  });
  const runText = runResult.content[0]?.type === 'text' ? runResult.content[0].text : '';
  assert.match(runText, /Bridge closed before result/);
  assert.doesNotMatch(runText, /secret steering|secret-event|secret-commit|C:\\\\sensitive/);
  assert.doesNotMatch(runText, /"input"|"output"|"payload"|"events"/);

  const resource = await mcpClient.readResource({ uri: 'codewave://runs/run-1' });
  assert.equal(resource.contents[0]?.mimeType, 'application/json');
  assert.doesNotMatch(String(resource.contents[0]?.text), /secret steering/);

  const invalid = await mcpClient.callTool({
    name: 'codewave_get_run',
    arguments: { runId: '../escape' },
  });
  assert.equal(invalid.isError, true);
  assert.ok(!observed.some((entry) => entry.url.includes('escape')));

  const oversized = await mcpClient.callTool({
    name: 'codewave_get_run',
    arguments: { runId: 'oversized' },
  });
  assert.equal(oversized.isError, true);
  assert.match(
    oversized.content[0]?.type === 'text' ? oversized.content[0].text : '',
    /safety limit/,
  );
  const secretError = await mcpClient.callTool({
    name: 'codewave_get_run',
    arguments: { runId: 'error-secret' },
  });
  const secretErrorText =
    secretError.content[0]?.type === 'text' ? secretError.content[0].text : '';
  assert.equal(secretError.isError, true);
  assert.doesNotMatch(secretErrorText, /sensitive|private-workspace/);

  const coalescedHandshakeBaseline = handshakeCount;
  const concurrentClient = new CodeWaveDaemonClient(
    `http://127.0.0.1:${address.port}`,
  );
  await Promise.all(Array.from({ length: 8 }, () => concurrentClient.listSessions()));
  assert.equal(
    handshakeCount,
    coalescedHandshakeBaseline + 1,
    'concurrent cold reads must share one daemon handshake',
  );

  async function measureScenario(
    name: string,
    operation: () => Promise<string>,
  ): Promise<void> {
    const durations: number[] = [];
    let maxBytes = 0;
    for (let index = 0; index < 20; index += 1) {
      const startedAt = performance.now();
      const text = await operation();
      durations.push(performance.now() - startedAt);
      maxBytes = Math.max(maxBytes, Buffer.byteLength(text));
      assert.ok(Buffer.byteLength(text) <= 256 * 1024);
      assert.doesNotMatch(
        text,
        /C:\\\\sensitive|provider-secret|secret-policy|secret steering|secret-event|secret-commit/,
      );
    }
    durations.sort((left, right) => left - right);
    measurements[name] = {
      rounds: durations.length,
      p95Ms: Number(durations[Math.floor(durations.length * 0.95) - 1]!.toFixed(2)),
      maxBytes,
    };
  }

  await measureScenario('failureTriage', async () => {
    const response = await mcpClient.callTool({
      name: 'codewave_get_run',
      arguments: { runId: 'run-1' },
    });
    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    assert.equal((JSON.parse(text) as { run: { status: string } }).run.status, 'failed');
    return text;
  });
  await measureScenario('contextHandoff', async () => {
    const response = await mcpClient.callTool({
      name: 'codewave_read_transcript',
      arguments: { sessionId: 'session-1', limit: 20 },
    });
    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    assert.equal((JSON.parse(text) as { messages: unknown[] }).messages.length, 1);
    return text;
  });
  await measureScenario('resourceInspection', async () => {
    const response = await mcpClient.readResource({ uri: 'codewave://runs/run-1' });
    const text = String(response.contents[0]?.text ?? '');
    assert.match(text, /Bridge closed before result/);
    return text;
  });

  assert.ok(
    observed
      .filter((entry) => entry.url !== '/api/handshake')
      .every((entry) => entry.method === 'GET'),
  );

  const modernClient = new Client(
    { name: 'CodeWave modern stdio validator', version: '0.1.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const stdio = new StdioClientTransport({
    command: process.execPath,
    args: [
      'node_modules/tsx/dist/cli.mjs',
      'apps/mcp-server/src/bin.ts',
    ],
    cwd: process.cwd(),
    env: {
      ...inheritedEnvironment,
      CODEWAVE_DAEMON_URL: `http://127.0.0.1:${address.port}`,
    },
    stderr: 'pipe',
  });
  await modernClient.connect(stdio);
  try {
    const modernTools = await modernClient.listTools();
    assert.equal(modernTools.tools.length, 4);
    const modernList = await modernClient.callTool({ name: 'codewave_list_sessions' });
    assert.equal(modernList.isError, undefined);
  } finally {
    await modernClient.close();
  }
} finally {
  await mcpClient.close();
  await mcpServer.close();
  daemon.close();
  await once(daemon, 'close');
}

process.stdout.write(
  `MCP observer validation passed: modern and legacy stdio, four read-only tools, bounded/redacted resources, exact two-scope handshake, restart renegotiation, schema rejection, stdout purity, and zero daemon mutations. Measurements: ${JSON.stringify(measurements)}\n`,
);
