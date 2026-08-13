import { DEFAULT_DAEMON_PORT } from '@codewave/protocol';
import { CodeWaveDaemon } from './server.js';

const port = Number(process.env.CODEWAVE_PORT ?? DEFAULT_DAEMON_PORT);
const daemon = new CodeWaveDaemon(process.cwd(), port);

await daemon.start();

console.log(`CodeWave daemon listening on ${daemon.getBaseUrl()}`);

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
