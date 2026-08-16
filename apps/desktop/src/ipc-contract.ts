export const DESKTOP_IPC = {
  getStatus: 'codewave:desktop:get-status',
  chooseWorkspace: 'codewave:desktop:choose-workspace',
  statusChanged: 'codewave:desktop:status-changed',
} as const;

export type DesktopDaemonPhase =
  | 'idle'
  | 'launching'
  | 'ready'
  | 'restarting'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type DesktopStatus = {
  phase: DesktopDaemonPhase;
  workspacePath: string;
  restartAttempt: number;
  detail?: string;
};

export type DesktopBridge = {
  getStatus(): Promise<DesktopStatus>;
  chooseWorkspace(): Promise<string | null>;
  onStatusChanged(listener: (status: DesktopStatus) => void): () => void;
};

export type DaemonReadyMessage = {
  type: 'daemon.ready';
  baseUrl: string;
};

export type DaemonFatalMessage = {
  type: 'daemon.fatal';
  message: string;
};

export type DaemonShutdownMessage = {
  type: 'daemon.shutdown';
};

export type DaemonProcessMessage = DaemonReadyMessage | DaemonFatalMessage;
export type DesktopProcessMessage = DaemonShutdownMessage;
