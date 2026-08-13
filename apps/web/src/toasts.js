const MAX_TOASTS = 5;
const EXIT_DELAY_MS = 220;

let nextToastId = 0;
let container = null;
const toasts = [];
const timeoutHandles = new Map();

const DEFAULT_DURATIONS = {
  info: 4000,
  success: 4000,
  warning: 6000,
  error: 8000,
};

function render() {
  if (!container) {
    return;
  }

  container.innerHTML = '';

  for (const toast of toasts) {
    const item = document.createElement('article');
    item.className = `toast-item toast-${toast.variant}`;
    item.dataset.toastId = toast.id;
    item.setAttribute('role', toast.variant === 'error' ? 'alert' : 'status');

    const accent = document.createElement('div');
    accent.className = 'toast-accent';

    const message = document.createElement('div');
    message.className = 'toast-message';
    message.textContent = toast.message;

    const dismiss = document.createElement('button');
    dismiss.className = 'toast-dismiss';
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Dismiss notification');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', () => dismissToast(toast.id));

    item.appendChild(accent);
    item.appendChild(message);
    item.appendChild(dismiss);
    container.appendChild(item);
  }
}

function clearToastTimer(id) {
  const handle = timeoutHandles.get(id);
  if (handle) {
    clearTimeout(handle);
    timeoutHandles.delete(id);
  }
}

function scheduleDismiss(id, duration) {
  clearToastTimer(id);
  const handle = setTimeout(() => dismissToast(id), duration);
  timeoutHandles.set(id, handle);
}

function removeToast(id) {
  const index = toasts.findIndex((toast) => toast.id === id);
  if (index === -1) {
    return;
  }

  clearToastTimer(id);
  toasts.splice(index, 1);
  render();
}

export function mountToastContainer(nextContainer) {
  container = nextContainer;
  render();
}

function dismissToast(id) {
  if (!container) {
    removeToast(id);
    return;
  }

  const item = container.querySelector(`[data-toast-id="${id}"]`);
  if (!item) {
    removeToast(id);
    return;
  }

  item.dataset.exiting = 'true';
  clearToastTimer(id);
  const handle = setTimeout(() => {
    timeoutHandles.delete(id);
    removeToast(id);
  }, EXIT_DELAY_MS);
  timeoutHandles.set(id, handle);
}

function pushToast({
  message,
  variant = 'info',
  duration = DEFAULT_DURATIONS[variant] ?? DEFAULT_DURATIONS.info,
}) {
  if (!message) {
    return null;
  }

  const id = String(++nextToastId);
  toasts.push({
    id,
    message,
    variant,
  });

  if (toasts.length > MAX_TOASTS) {
    const oldest = toasts.shift();
    if (oldest) {
      clearToastTimer(oldest.id);
    }
  }

  render();
  if (duration > 0) {
    scheduleDismiss(id, duration);
  }
  return id;
}

export const toast = {
  info(message, duration) {
    return pushToast({ message, variant: 'info', duration });
  },
  success(message, duration) {
    return pushToast({ message, variant: 'success', duration });
  },
  warning(message, duration) {
    return pushToast({ message, variant: 'warning', duration });
  },
  error(message, duration) {
    return pushToast({ message, variant: 'error', duration });
  },
};
