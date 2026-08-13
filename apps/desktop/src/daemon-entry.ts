import { CodeWaveDaemon } from '../../daemon/src/server.js';
import type {
  DaemonProcessMessage,
  DesktopProcessMessage,
} from './ipc-contract.js';

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the desktop daemon.`);
  return value;
}

function post(message: DaemonProcessMessage): void {
  process.parentPort.postMessage(message);
}

let daemon: CodeWaveDaemon | null = null;
let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (daemon) await daemon.stop();
  process.exitCode = 0;
  setImmediate(() => process.exit(0));
}

process.parentPort.on('message', (event) => {
  const message = event.data as Partial<DesktopProcessMessage>;
  if (message?.type === 'daemon.shutdown') {
    void stop().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  }
});
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());

try {
  daemon = new CodeWaveDaemon({
    workspaceRoot: requireEnvironment('CODEWAVE_WORKSPACE_ROOT'),
    dataDirectory: requireEnvironment('CODEWAVE_DATA_DIRECTORY'),
    desktopBootstrapSecret: requireEnvironment('CODEWAVE_DESKTOP_BOOTSTRAP_SECRET'),
    port: 0,
  });
  const started = await daemon.start();
  post({ type: 'daemon.ready', baseUrl: started.baseUrl });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  post({ type: 'daemon.fatal', message });
  console.error(message);
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
}
