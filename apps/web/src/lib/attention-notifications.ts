const NOTIFICATION_PERMISSION_KEY = 'codewave.notifications.enabled';

type AttentionKind =
  | 'approval'
  | 'run-completed'
  | 'run-failed';

function isVisible(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

function notificationsEnabled(): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  try {
    return window.localStorage.getItem(NOTIFICATION_PERMISSION_KEY) === 'true';
  } catch {
    return false;
  }
}

export async function requestAttentionPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (window.Notification.permission === 'granted') {
    return true;
  }
  if (window.Notification.permission === 'denied') {
    return false;
  }

  try {
    const permission = await window.Notification.requestPermission();
    return permission === 'granted';
  } catch {
    return false;
  }
}

export function toggleAttentionNotifications(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(NOTIFICATION_PERMISSION_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore storage failures
  }
}

export function attentionNotificationsEnabled(): boolean {
  return notificationsEnabled();
}

export function notifyAttention(kind: AttentionKind, detail: string): void {
  if (!notificationsEnabled()) {
    return;
  }
  if (isVisible()) {
    return;
  }
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }
  if (window.Notification.permission !== 'granted') {
    return;
  }

  const title =
    kind === 'approval'
      ? 'CodeWave needs a decision'
      : kind === 'run-failed'
        ? 'CodeWave run failed'
        : 'CodeWave run completed';

  try {
    const notification = new window.Notification(title, {
      body: detail,
      tag: `codewave-${kind}`,
      silent: false,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Some environments block construction; ignore.
  }
}
