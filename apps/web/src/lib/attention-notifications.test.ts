import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attentionNotificationsEnabled,
  requestAttentionPermission,
  toggleAttentionNotifications,
} from './attention-notifications.js';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('attention notifications', () => {
  it('enables storage only after permission is granted', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });

    const granted = await requestAttentionPermission();
    toggleAttentionNotifications(granted);

    expect(granted).toBe(true);
    expect(attentionNotificationsEnabled()).toBe(true);
  });

  it('keeps notifications disabled when permission is denied', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });

    const granted = await requestAttentionPermission();
    toggleAttentionNotifications(granted);

    expect(granted).toBe(false);
    expect(attentionNotificationsEnabled()).toBe(false);
  });

  it('does not re-prompt an already decided browser permission', async () => {
    const requestPermission = vi.fn();
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission });

    await expect(requestAttentionPermission()).resolves.toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
