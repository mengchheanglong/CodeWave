import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseDesktopWorkspace,
  observeDesktopRuntime,
  type DesktopRuntimeStatus,
} from './desktop-bridge.js';

const readyStatus: DesktopRuntimeStatus = {
  phase: 'ready',
  workspacePath: 'C:/workspace',
  restartAttempt: 0,
};

afterEach(() => {
  delete window.codewaveDesktop;
  vi.restoreAllMocks();
});

describe('desktop bridge', () => {
  it('distinguishes the web fallback from a cancelled native picker', async () => {
    await expect(chooseDesktopWorkspace()).resolves.toBeUndefined();

    window.codewaveDesktop = {
      getStatus: vi.fn().mockResolvedValue(readyStatus),
      chooseWorkspace: vi.fn().mockResolvedValue(null),
      onStatusChanged: vi.fn().mockReturnValue(() => {}),
    };
    await expect(chooseDesktopWorkspace()).resolves.toBeNull();
  });

  it('returns the canonical path selected by the desktop shell', async () => {
    window.codewaveDesktop = {
      getStatus: vi.fn().mockResolvedValue(readyStatus),
      chooseWorkspace: vi.fn().mockResolvedValue('C:/selected'),
      onStatusChanged: vi.fn().mockReturnValue(() => {}),
    };
    await expect(chooseDesktopWorkspace()).resolves.toBe('C:/selected');
  });

  it('falls back safely when native selection fails', async () => {
    window.codewaveDesktop = {
      getStatus: vi.fn().mockResolvedValue(readyStatus),
      chooseWorkspace: vi.fn().mockRejectedValue(new Error('dialog unavailable')),
      onStatusChanged: vi.fn().mockReturnValue(() => {}),
    };
    await expect(chooseDesktopWorkspace()).resolves.toBeUndefined();
  });

  it('hydrates, streams, and tears down runtime status', async () => {
    let emit: ((status: DesktopRuntimeStatus) => void) | undefined;
    const unsubscribe = vi.fn();
    window.codewaveDesktop = {
      getStatus: vi.fn().mockResolvedValue(readyStatus),
      chooseWorkspace: vi.fn().mockResolvedValue(null),
      onStatusChanged: vi.fn((listener) => {
        emit = listener;
        return unsubscribe;
      }),
    };
    const listener = vi.fn();
    const stop = observeDesktopRuntime(listener);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith(readyStatus);

    const restarting: DesktopRuntimeStatus = {
      ...readyStatus,
      phase: 'restarting',
      restartAttempt: 1,
    };
    emit?.(restarting);
    expect(listener).toHaveBeenLastCalledWith(restarting);

    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
