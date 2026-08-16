import { appendFileSync } from 'node:fs';
import readline from 'node:readline';

const logArgumentIndex = process.argv.indexOf('--log');
const logPath =
  process.env.CODEWAVE_MINIMAL_ACP_LOG ??
  (logArgumentIndex >= 0 ? process.argv[logArgumentIndex + 1] : undefined);
const holdPrompt = process.env.CODEWAVE_MINIMAL_ACP_HOLD === '1';
const protocolVersion = Number(process.env.CODEWAVE_MINIMAL_ACP_PROTOCOL ?? '1');
const stderrBytes = Number(process.env.CODEWAVE_MINIMAL_ACP_STDERR_BYTES ?? '0');
const pendingPrompts = new Map();

function record(kind, detail = {}) {
  if (!logPath) return;
  appendFileSync(
    logPath,
    `${JSON.stringify({ kind, pid: process.pid, ...detail })}\n`,
    'utf8',
  );
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function update(sessionId, messageId, text) {
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId,
        content: { type: 'text', text },
      },
    },
  });
}

const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.exitCode = 2;
    lines.close();
    return;
  }
  const id = message.id;
  const params = message.params ?? {};
  record('request', { method: message.method });
  switch (message.method) {
    case 'initialize':
      if (stderrBytes > 0) process.stderr.write(`${'e'.repeat(stderrBytes)}\n`);
      respond(id, {
        protocolVersion,
        agentInfo: {
          name: 'minimal-wave-agent',
          title: 'Minimal Wave Agent',
          version: '1.0.0-test',
        },
        authMethods: [],
        agentCapabilities: {
          loadSession: false,
          sessionCapabilities: { resume: {}, close: {} },
        },
      });
      return;
    case 'session/new':
      respond(id, { sessionId: 'minimal-wave-session' });
      return;
    case 'session/resume':
      respond(id, { sessionId: params.sessionId });
      return;
    case 'session/prompt':
      if (holdPrompt) {
        pendingPrompts.set(params.sessionId, id);
        return;
      }
      update(params.sessionId, 'minimal-message', 'A calm response from the minimal ACP agent.');
      respond(id, { stopReason: 'end_turn' });
      return;
    case 'session/cancel': {
      const promptId = pendingPrompts.get(params.sessionId);
      if (promptId !== undefined) {
        pendingPrompts.delete(params.sessionId);
        respond(promptId, { stopReason: 'cancelled' });
      }
      return;
    }
    default:
      if (id !== undefined) {
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unsupported method: ${message.method}` },
        });
      }
  }
});

lines.on('close', () => process.exit(0));
