import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type {
  DaemonProcessMessage,
  DesktopProcessMessage,
  DesktopStatus,
} from './ipc-contract.js';

const READY_TIMEOUT_MS = 20_000;
const GRACEFUL_STOP_TIMEOUT_MS = 7_000;
const FORCED_STOP_TIMEOUT_MS = 2_000;
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_RESTARTS_PER_WINDOW = 3;
const RESTART_WINDOW_MS = 60_000;
const RESTART_DELAYS_MS = [500, 1_500, 5_000] as const;

export type DaemonSupervisorOptions = {
  bootstrapSecret: string;
  daemonEntryPath: string;
  dataDirectory: string;
  logDirectory: string;
  workspacePath: string;
};

type StatusListener = (status: DesktopStatus) => void;

function isDaemonProcessMessage(value: unknown): value is DaemonProcessMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DaemonProcessMessage>;
  return (
    (candidate.type === 'daemon.ready' && typeof candidate.baseUrl === 'string') ||
    (candidate.type === 'daemon.fatal' && typeof candidate.message === 'string')
  );
}

async function prepareLogStream(logDirectory: string): Promise<WriteStream> {
  await mkdir(logDirectory, { recursive: true });
  const logPath = path.join(logDirectory, 'daemon.log');
  try {
    if ((await stat(logPath)).size >= MAX_LOG_BYTES) {
      await rename(logPath, path.join(logDirectory, 'daemon.previous.log'));
    }
  } catch {
    // A missing or unstatable prior log must not prevent the daemon from starting.
  }
  return createWriteStream(logPath, { flags: 'a' });
}

function waitForExit(child: UtilityProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    timeout.unref();
    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

export class DaemonSupervisor {
  readonly #options: DaemonSupervisorOptions;
  readonly #listeners = new Set<StatusListener>();
  #child: UtilityProcess | null = null;
  #baseUrl: string | null = null;
  #logStream: WriteStream | null = null;
  #restartTimer: NodeJS.Timeout | null = null;
  #restartHistory: number[] = [];
  #stopping = false;
  #status: DesktopStatus;

  constructor(options: DaemonSupervisorOptions) {
    this.#options = options;
    this.#status = {
      phase: 'idle',
      workspacePath: options.workspacePath,
      restartAttempt: 0,
    };
  }

  getStatus(): DesktopStatus {
    return { ...this.#status };
  }

  getBaseUrl(): string {
    if (!this.#baseUrl || this.#status.phase !== 'ready') {
      throw new Error('The CodeWave daemon is not ready.');
    }
    return this.#baseUrl;
  }

  onStatus(listener: StatusListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.#child) throw new Error('The CodeWave daemon is already running.');
    this.#stopping = false;
    this.#setStatus(
      this.#status.phase === 'restarting' ? 'restarting' : 'launching',
      undefined,
    );
    this.#logStream ??= await prepareLogStream(this.#options.logDirectory);

    const child = utilityProcess.fork(this.#options.daemonEntryPath, [], {
      env: {
        ...process.env,
        CODEWAVE_DATA_DIRECTORY: this.#options.dataDirectory,
        CODEWAVE_DESKTOP_BOOTSTRAP_SECRET: this.#options.bootstrapSecret,
        CODEWAVE_PORT: '0',
        CODEWAVE_WORKSPACE_ROOT: this.#options.workspacePath,
      },
      serviceName: 'CodeWave local daemon',
      stdio: 'pipe',
    });
    this.#child = child;
    child.stdout?.pipe(this.#logStream, { end: false });
    child.stderr?.pipe(this.#logStream, { end: false });

    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('The local daemon did not become ready within 20 seconds.'));
      }, READY_TIMEOUT_MS);
      timeout.unref();

      const onMessage = (message: unknown): void => {
        if (!isDaemonProcessMessage(message)) return;
        if (message.type === 'daemon.fatal') {
          clearTimeout(timeout);
          reject(new Error(message.message));
          return;
        }
        let parsed: URL;
        try {
          parsed = new URL(message.baseUrl);
        } catch {
          clearTimeout(timeout);
          reject(new Error('The local daemon reported an invalid address.'));
          return;
        }
        if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
          clearTimeout(timeout);
          reject(new Error('The local daemon must bind to the IPv4 loopback interface.'));
          return;
        }
        clearTimeout(timeout);
        this.#baseUrl = parsed.toString();
        this.#setStatus('ready', undefined, 0);
        resolve();
      };
      child.on('message', onMessage);
      child.once('exit', (code) => {
        clearTimeout(timeout);
        if (!this.#baseUrl) reject(new Error(`The local daemon exited during launch (${code}).`));
      });
    });

    child.on('exit', (code) => this.#handleExit(child, code));
    child.on('error', (type, location) => {
      this.#setStatus('failed', `Daemon process error: ${type} at ${location}.`);
    });

    try {
      await ready;
    } catch (error) {
      if (this.#child === child) {
        child.kill();
        this.#child = null;
      }
      const detail = error instanceof Error ? error.message : String(error);
      this.#setStatus('failed', detail);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
    const child = this.#child;
    if (!child) {
      this.#setStatus('stopped', undefined, 0);
      await this.#closeLog();
      return;
    }
    this.#setStatus('stopping', undefined);
    const exitPromise = waitForExit(child, GRACEFUL_STOP_TIMEOUT_MS);
    const message: DesktopProcessMessage = { type: 'daemon.shutdown' };
    child.postMessage(message);
    if (!(await exitPromise)) {
      const forcedExit = waitForExit(child, FORCED_STOP_TIMEOUT_MS);
      child.kill();
      await forcedExit;
    }
    if (this.#child === child) this.#child = null;
    this.#baseUrl = null;
    this.#setStatus('stopped', undefined, 0);
    await this.#closeLog();
  }

  #handleExit(child: UtilityProcess, code: number): void {
    if (this.#child !== child) return;
    this.#child = null;
    this.#baseUrl = null;
    if (this.#stopping) return;

    const now = Date.now();
    this.#restartHistory = this.#restartHistory.filter(
      (startedAt) => now - startedAt < RESTART_WINDOW_MS,
    );
    if (this.#restartHistory.length >= MAX_RESTARTS_PER_WINDOW) {
      this.#setStatus(
        'failed',
        `The local daemon exited ${MAX_RESTARTS_PER_WINDOW + 1} times in one minute (last exit ${code}).`,
        this.#restartHistory.length,
      );
      return;
    }
    this.#restartHistory.push(now);
    const attempt = this.#restartHistory.length;
    this.#setStatus('restarting', `Daemon exited with code ${code}.`, attempt);
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      void this.start().catch(() => {
        // start() records the actionable failure and exit handling owns the budget.
      });
    }, RESTART_DELAYS_MS[attempt - 1] ?? RESTART_DELAYS_MS.at(-1));
  }

  #setStatus(
    phase: DesktopStatus['phase'],
    detail?: string,
    restartAttempt = this.#status.restartAttempt,
  ): void {
    this.#status = {
      phase,
      workspacePath: this.#options.workspacePath,
      restartAttempt,
      ...(detail ? { detail } : {}),
    };
    for (const listener of this.#listeners) listener(this.getStatus());
  }

  async #closeLog(): Promise<void> {
    const logStream = this.#logStream;
    this.#logStream = null;
    if (!logStream) return;
    await new Promise<void>((resolve) => logStream.end(resolve));
  }
}
