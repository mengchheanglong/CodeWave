export type DesktopDaemonPhase =
  | 'idle'
  | 'launching'
  | 'ready'
  | 'restarting'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type DesktopRuntimeStatus = {
  phase: DesktopDaemonPhase;
  workspacePath: string;
  restartAttempt: number;
  detail?: string;
};

type DesktopBridge = {
  getStatus(): Promise<DesktopRuntimeStatus>;
  chooseWorkspace(): Promise<string | null>;
  onStatusChanged(listener: (status: DesktopRuntimeStatus) => void): () => void;
};

declare global {
  interface Window {
    codewaveDesktop?: DesktopBridge;
  }
}

export async function chooseDesktopWorkspace(): Promise<string | null | undefined> {
  const bridge = typeof window === 'undefined' ? undefined : window.codewaveDesktop;
  if (!bridge) return undefined;

  try {
    return await bridge.chooseWorkspace();
  } catch {
    return undefined;
  }
}

export function observeDesktopRuntime(
  listener: (status: DesktopRuntimeStatus) => void,
): () => void {
  const bridge = typeof window === 'undefined' ? undefined : window.codewaveDesktop;
  if (!bridge) return () => {};

  let active = true;
  void bridge.getStatus().then(
    (status) => {
      if (active) listener(status);
    },
    () => {},
  );
  const unsubscribe = bridge.onStatusChanged((status) => {
    if (active) listener(status);
  });
  return () => {
    active = false;
    unsubscribe();
  };
}
