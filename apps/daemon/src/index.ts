import { DEFAULT_DAEMON_PORT } from '@codewave/protocol';
import { CodeWaveDaemon } from './server.js';

function readPort(value: string | undefined): number {
  const port = Number(value ?? DEFAULT_DAEMON_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('CODEWAVE_PORT must be an integer from 0 through 65535.');
  }
  return port;
}

const workspaceRoot = process.env.CODEWAVE_WORKSPACE_ROOT?.trim() || process.cwd();
const dataDirectory = process.env.CODEWAVE_DATA_DIRECTORY?.trim() || undefined;
const desktopBootstrapSecret =
  process.env.CODEWAVE_DESKTOP_BOOTSTRAP_SECRET ?? undefined;
const daemon = new CodeWaveDaemon({
  workspaceRoot,
  dataDirectory,
  port: readPort(process.env.CODEWAVE_PORT),
  desktopBootstrapSecret,
});

const started = await daemon.start();

console.log(`CodeWave daemon listening on ${started.baseUrl}`);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await daemon.stop();
    process.exitCode = 0;
  } catch (error) {
    console.error(
      `CodeWave daemon failed to shut down after ${signal}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
