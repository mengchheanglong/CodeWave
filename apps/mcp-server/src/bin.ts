#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildMcpServer } from './server.js';

const handle = serveStdio(() => buildMcpServer(), {
  legacy: 'serve',
  onerror: (error) => process.stderr.write(`[CodeWave MCP] ${error.message}\n`),
});

process.once('SIGINT', () => void handle.close());
process.once('SIGTERM', () => void handle.close());
