import * as acp from '@agentclientprotocol/sdk';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';

const args = process.argv.slice(2);
const toolTitles = (process.env.CODEWAVE_FAKE_GEMINI_TOOL_TITLES ?? 'run_shell_command')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const shouldRequestPermission =
  process.env.CODEWAVE_FAKE_ACP_PERMISSION === '1' ||
  process.env.CODEWAVE_FAKE_ACP_PERMISSION === 'true';
const shouldFailMcpList =
  process.env.CODEWAVE_FAKE_GEMINI_MCP_LIST_FAIL === '1' ||
  process.env.CODEWAVE_FAKE_GEMINI_MCP_LIST_FAIL === 'true';
const shouldTimeoutMcpList =
  process.env.CODEWAVE_FAKE_GEMINI_MCP_LIST_TIMEOUT === '1' ||
  process.env.CODEWAVE_FAKE_GEMINI_MCP_LIST_TIMEOUT === 'true';
const mcpListTimeoutMs = Math.max(
  1000,
  Number(process.env.CODEWAVE_FAKE_GEMINI_MCP_LIST_TIMEOUT_MS ?? 5000) || 5000,
);

function buildRawInput(toolName) {
  if (toolName === 'run_shell_command') {
    return { command: 'echo deterministic' };
  }

  if (toolName === 'read_file') {
    return { path: 'README.md' };
  }

  if (toolName.startsWith('mcp__')) {
    return { query: 'deterministic probe' };
  }

  return {};
}

function handleCommandMode() {
  if (args.includes('--version')) {
    process.stdout.write('0.0.0-fake-gemini\n');
    process.exit(0);
    return true;
  }

  if (args.includes('--help')) {
    process.stdout.write('Usage: fake-gemini-acp-agent --acp\n');
    process.stdout.write('Options:\n  --acp   Start ACP mode\n');
    process.exit(0);
    return true;
  }

  if (args[0] === 'mcp' && args[1] === 'list') {
    if (shouldFailMcpList) {
      process.stderr.write('deterministic fake gemini mcp list failure\n');
      process.exit(1);
      return true;
    }

    if (shouldTimeoutMcpList) {
      setTimeout(() => {
        process.stdout.write('deterministic fake gemini mcp list timeout release\n');
        process.exit(0);
      }, mcpListTimeoutMs);
      return true;
    }

    process.stdout.write('No MCP servers configured\n');
    process.exit(0);
    return true;
  }

  return false;
}

class FakeGeminiAgent {
  constructor() {
    this.sessions = new Map();
  }

  async initialize() {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        sessionCapabilities: {
          resume: false,
        },
      },
    };
  }

  async newSession() {
    const sessionId = `fake-gemini-${randomUUID()}`;
    this.sessions.set(sessionId, {
      cancelled: false,
    });
    return { sessionId };
  }

  async prompt(params, connection) {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Unknown session ${params.sessionId}`);
    }

    if (session.cancelled) {
      session.cancelled = false;
      return { stopReason: 'cancelled' };
    }

    let index = 0;
    for (const title of toolTitles) {
      const toolCallId = `fake-tool-call-${index}`;
      const rawInput = buildRawInput(title);

      await connection.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId,
          title,
          kind: 'execute',
          status: 'pending',
          rawInput,
        },
      });

      if (shouldRequestPermission && index === 0) {
        const permission = await connection.request(
          acp.methods.client.session.requestPermission,
          {
          sessionId: params.sessionId,
          toolCall: {
            toolCallId,
            title,
            kind: 'execute',
            status: 'pending',
            rawInput,
          },
          options: [
            {
              kind: 'allow_once',
              name: 'Allow once',
              optionId: 'allow-once',
            },
            {
              kind: 'reject_once',
              name: 'Reject once',
              optionId: 'reject-once',
            },
          ],
          },
        );
        if (
          permission.outcome.outcome === 'cancelled' ||
          permission.outcome.optionId !== 'allow-once'
        ) {
          for (let duplicate = 0; duplicate < 2; duplicate += 1) {
            await connection.notify(acp.methods.client.session.update, {
              sessionId: params.sessionId,
              update: {
                sessionUpdate: 'tool_call_update',
                toolCallId,
                status: 'failed',
                rawOutput: 'Denied by deterministic CodeWave approval.',
              },
            });
          }
          index += 1;
          continue;
        }
      }

      for (let duplicate = 0; duplicate < 2; duplicate += 1) {
        await connection.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId,
            status: 'completed',
            rawOutput: {
              stdout: `deterministic-${title}`,
            },
          },
        });
      }

      index += 1;
    }

    await connection.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: {
          type: 'text',
          text: 'Deterministic private reasoning trace.',
        },
      },
    });

    await connection.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: 'Deterministic fake Gemini ACP response.',
        },
      },
    });

    return {
      stopReason: 'end_turn',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
      },
    };
  }

  async cancel(params) {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      session.cancelled = true;
    }
  }
}

if (handleCommandMode()) {
  // Command mode exits in place.
} else if (args.includes('--acp') || args.includes('acp')) {
  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin);
  const stream = acp.ndJsonStream(input, output);
  const implementation = new FakeGeminiAgent();
  acp
    .agent({ name: 'fake-gemini-acp-agent' })
    .onRequest(acp.methods.agent.initialize, ({ params }) =>
      implementation.initialize(params),
    )
    .onRequest(acp.methods.agent.session.new, ({ params }) =>
      implementation.newSession(params),
    )
    .onRequest(acp.methods.agent.session.prompt, ({ params, client }) =>
      implementation.prompt(params, client),
    )
    .onNotification(acp.methods.agent.session.cancel, ({ params }) =>
      implementation.cancel(params),
    )
    .connect(stream);
} else {
  process.stderr.write(`fake-gemini-acp-agent received unsupported args: ${args.join(' ')}\n`);
  process.exit(1);
}
