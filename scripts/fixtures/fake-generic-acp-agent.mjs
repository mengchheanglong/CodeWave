import * as acp from '@agentclientprotocol/sdk';
import { appendFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';

const scenario = process.env.CODEWAVE_FAKE_ACP_SCENARIO ?? 'normal';
const logPath = process.env.CODEWAVE_FAKE_ACP_LOG;
const pendingPrompts = new Map();

function record(kind, detail = {}) {
  if (!logPath) return;
  appendFileSync(logPath, `${JSON.stringify({ kind, ...detail })}\n`, 'utf8');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const app = acp.agent({ name: 'fake-generic-acp-agent' });

app.onRequest(acp.methods.agent.initialize, async ({ params }) => {
  record('initialize', {
    protocolVersion: params.protocolVersion,
    clientCapabilities: params.clientCapabilities ?? null,
    clientInfo: params.clientInfo ?? null,
  });
  if (scenario === 'slow-initialize') await delay(10_000);
  return {
    protocolVersion: scenario === 'protocol-mismatch' ? 2 : 1,
    agentInfo: {
      name: 'fake-generic-acp-agent',
      title: 'Generic ACP fixture',
      version: '1.0.0-test',
    },
    authMethods: [{ id: 'fixture-login', name: 'Fixture login' }],
    agentCapabilities: {
      loadSession: scenario === 'load',
      sessionCapabilities: {
        ...(scenario === 'resume' ? { resume: {} } : {}),
        close: {},
      },
    },
  };
});

app.onRequest(acp.methods.agent.session.new, async ({ params }) => {
  record('session.new', { cwd: params.cwd, mcpServerCount: params.mcpServers.length });
  return { sessionId: 'generic-new-session' };
});

app.onRequest(acp.methods.agent.session.resume, async ({ params }) => {
  record('session.resume', { sessionId: params.sessionId, cwd: params.cwd });
  return { sessionId: params.sessionId };
});

app.onRequest(acp.methods.agent.session.load, async ({ params, client }) => {
  record('session.load.start', { sessionId: params.sessionId, cwd: params.cwd });
  await client.notify(acp.methods.client.session.update, {
    sessionId: params.sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'historical-message',
      content: { type: 'text', text: 'historical replay must stay hidden' },
    },
  });
  await delay(25);
  record('session.load.complete', { sessionId: params.sessionId });
  return {};
});

app.onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
  record('session.prompt', { sessionId: params.sessionId, blockCount: params.prompt.length });
  if (scenario === 'early-eof') {
    process.exit(0);
  }
  if (scenario === 'oversized-line') {
    process.stdout.write(`${'x'.repeat(1024 * 1024 + 64)}\n`);
    return new Promise(() => {});
  }
  if (scenario === 'malformed-json') {
    process.stdout.write('{not-json}\n');
    return new Promise(() => {});
  }
  if (scenario === 'pending-permission' || scenario === 'allow-only-permission') {
    const options =
      scenario === 'allow-only-permission'
        ? [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }]
        : [
            { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-always', name: 'Reject always', kind: 'reject_always' },
            { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
          ];
    const permission = await client.request(
      acp.methods.client.session.requestPermission,
      {
        sessionId: params.sessionId,
        toolCall: {
          toolCallId: 'pending-tool',
          title: 'write_file',
          kind: 'edit',
          status: 'pending',
          rawInput: { path: 'fixture.txt' },
        },
        options,
      },
    );
    record('permission.result', { outcome: permission.outcome });
    if (permission.outcome.outcome === 'cancelled') return { stopReason: 'cancelled' };
  }
  if (scenario === 'wait-for-cancel') {
    return new Promise((resolve) => pendingPrompts.set(params.sessionId, resolve));
  }
  if (scenario === 'max-tokens') return { stopReason: 'max_tokens' };

  if (scenario === 'wrong-session') {
    await client.notify(acp.methods.client.session.update, {
      sessionId: 'different-session',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'wrong-session-message',
        content: { type: 'text', text: 'must never be emitted' },
      },
    });
  }

  const chunks =
    scenario === 'interleaved-messages'
      ? [
          ['message-a', 'alpha '],
          ['message-b', 'beta'],
          ['message-a', 'omega'],
        ]
      : [['message-a', 'generic ACP response']];
  for (const [messageId, text] of chunks) {
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId,
        content: { type: 'text', text },
      },
    });
  }
  return { stopReason: 'end_turn' };
});

app.onNotification(acp.methods.agent.session.cancel, ({ params }) => {
  record('session.cancel', { sessionId: params.sessionId });
  pendingPrompts.get(params.sessionId)?.({ stopReason: 'cancelled' });
  pendingPrompts.delete(params.sessionId);
});

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
);
const connection = app.connect(stream);
connection.closed.finally(() => process.exit(0));
