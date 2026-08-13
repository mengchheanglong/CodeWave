import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { CodeWaveDaemonClient } from './daemon-client.js';
import {
  boundedJson,
  projectArchive,
  projectRun,
  projectSession,
  projectTranscript,
} from './projections.js';

const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Use a CodeWave session or run identifier.');
const transcriptInput = z.object({
  sessionId: idSchema,
  before: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: boundedJson(value) }] };
}

function toolError(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: error instanceof Error ? error.message : 'The CodeWave observer request failed.',
      },
    ],
  };
}

export function buildMcpServer(client = new CodeWaveDaemonClient()): McpServer {
  const server = new McpServer(
    { name: 'CodeWave observer', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };

  server.registerTool(
    'codewave_list_sessions',
    {
      title: 'List recent CodeWave sessions',
      description: 'Inspect up to 50 bounded CodeWave session summaries without changing the daemon ledger.',
      annotations: readOnly,
    },
    async (context) => {
      try {
        return result(projectArchive(await client.listSessions(context.mcpReq.signal)));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'codewave_get_session',
    {
      title: 'Inspect a CodeWave session',
      description: 'Read bounded session and run lineage. Absolute workspace paths are redacted.',
      inputSchema: z.object({ sessionId: idSchema }),
      annotations: readOnly,
    },
    async ({ sessionId }, context) => {
      try {
        return result(projectSession(await client.getSession(sessionId, context.mcpReq.signal)));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'codewave_get_run',
    {
      title: 'Inspect a CodeWave run',
      description: 'Read projected run state, bounded transcript, and tool/approval/artifact outcomes without raw payloads.',
      inputSchema: z.object({ runId: idSchema }),
      annotations: readOnly,
    },
    async ({ runId }, context) => {
      try {
        return result(projectRun(await client.getRun(runId, context.mcpReq.signal)));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'codewave_read_transcript',
    {
      title: 'Read a CodeWave transcript page',
      description: 'Read at most 50 parent-linked messages with opaque metadata removed and content bounded.',
      inputSchema: transcriptInput,
      annotations: readOnly,
    },
    async ({ sessionId, before, limit }, context) => {
      try {
        return result(
          projectTranscript(
            await client.readTranscript(sessionId, { before, limit }, context.mcpReq.signal),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerResource(
    'recent-sessions',
    'codewave://sessions/recent',
    {
      title: 'Recent CodeWave sessions',
      description: 'Bounded, redacted session summaries from the local CodeWave daemon.',
      mimeType: 'application/json',
      cacheHint: { ttlMs: 0, cacheScope: 'private' },
    },
    async (uri, context) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: boundedJson(projectArchive(await client.listSessions(context.mcpReq.signal))),
        },
      ],
    }),
  );

  server.registerResource(
    'run',
    new ResourceTemplate('codewave://runs/{runId}', { list: undefined }),
    {
      title: 'CodeWave run',
      description: 'A projected local CodeWave run snapshot.',
      mimeType: 'application/json',
      cacheHint: { ttlMs: 0, cacheScope: 'private' },
    },
    async (uri, variables, context) => {
      const runId = idSchema.parse(String(variables.runId));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: boundedJson(projectRun(await client.getRun(runId, context.mcpReq.signal))),
          },
        ],
      };
    },
  );

  return server;
}
