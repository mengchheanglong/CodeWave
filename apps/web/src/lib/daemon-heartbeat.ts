const HEARTBEAT_INTERVAL_MS = 10_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

export type DaemonConnectionState = 
  | { status: 'connected'; lastCheckMs: number }
  | { status: 'connecting'; sinceMs: number }
  | { status: 'disconnected'; sinceMs: number; attempts: number };

type Listener = (state: DaemonConnectionState) => void;

let state: DaemonConnectionState = { status: 'connecting', sinceMs: Date.now() };
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let lastCheckMs = Date.now();

function notify() {
  for (const fn of listeners) {
    fn(state);
  }
}

export function startDaemonHeartbeat(): () => void {
  let isDestroyed = false;

  function scheduleNext() {
    if (state.status === 'connected') {
      timer = setTimeout(check, HEARTBEAT_INTERVAL_MS);
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(1.5, reconnectAttempts),
      RECONNECT_MAX_MS,
    );
    timer = setTimeout(check, delay);
  }

  async function check() {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        reconnectAttempts = 0;
        lastCheckMs = Date.now();
        state = { status: 'connected', lastCheckMs };
        notify();
        if (!isDestroyed) {
          scheduleNext();
        }
        return;
      }
    } catch {
      // Connection failed — fall through
    }

    reconnectAttempts += 1;
    state = { status: 'disconnected', sinceMs: Date.now(), attempts: reconnectAttempts };
    notify();
    if (!isDestroyed) {
      scheduleNext();
    }
  }

  // Initial check
  void check();

  return () => {
    isDestroyed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    listeners.clear();
  };
}

export function subscribeDaemonHeartbeat(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function getDaemonConnectionState(): DaemonConnectionState {
  return state;
}
