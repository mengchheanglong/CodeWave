const NOTIFICATION_PERMISSION_KEY = 'qwemini.notifications.enabled';

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

export function requestAttentionPermission(): void {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }
  if (window.Notification.permission !== 'default') {
    return;
  }
  void window.Notification.requestPermission().then((permission) => {
    if (permission === 'granted') {
      try {
        window.localStorage.setItem(NOTIFICATION_PERMISSION_KEY, 'true');
      } catch {
        // ignore storage failures
      }
    }
  });
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
      ? 'Qwemini needs a decision'
      : kind === 'run-failed'
        ? 'Qwemini run failed'
        : 'Qwemini run completed';

  try {
    const notification = new window.Notification(title, {
      body: detail,
      tag: `qwemini-${kind}`,
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
