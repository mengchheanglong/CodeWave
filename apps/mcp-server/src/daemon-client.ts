import type {
  ArchiveSnapshot,
  ClientHandshakeResponse,
  DaemonClientScope,
  RunSnapshot,
  SessionSnapshot,
  TranscriptWindow,
} from '@codewave/protocol';

const OBSERVER_SCOPES: DaemonClientScope[] = ['sessions:read', 'runs:read'];
const MAX_DAEMON_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

export class CodeWaveDaemonError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

function resolveDaemonOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !['127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error(
      'CODEWAVE_DAEMON_URL must be a credential-free loopback HTTP origin.',
    );
  }
  return url.origin;
}

function errorMessage(status: number): string {
  if (status === 404) return 'The requested CodeWave record was not found.';
  if (status === 403) return 'The CodeWave daemon denied the observer scope.';
  return `The CodeWave daemon could not satisfy this read (HTTP ${status}).`;
}

export class CodeWaveDaemonClient {
  private readonly origin: string;
  private connectionId: string | null = null;
  private handshakePromise: Promise<string> | null = null;

  constructor(origin = process.env.CODEWAVE_DAEMON_URL ?? 'http://127.0.0.1:4120') {
    this.origin = resolveDaemonOrigin(origin);
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_DAEMON_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new CodeWaveDaemonError('The daemon response exceeded the MCP observer safety limit.');
    }
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        if (receivedBytes > MAX_DAEMON_RESPONSE_BYTES) {
          await reader.cancel();
          throw new CodeWaveDaemonError('The daemon response exceeded the MCP observer safety limit.');
        }
        chunks.push(value);
      }
    }
    const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    try {
      return text ? (JSON.parse(text) as unknown) : null;
    } catch {
      throw new CodeWaveDaemonError('The daemon returned malformed JSON.', response.status);
    }
  }

  private requestSignal(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  private async handshake(signal?: AbortSignal): Promise<string> {
    const response = await fetch(`${this.origin}/api/handshake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientName: 'CodeWave MCP observer',
        clientVersion: '0.1.0',
        protocolVersion: 1,
        requestedScopes: OBSERVER_SCOPES,
      }),
      signal: this.requestSignal(signal),
    });
    const payload = await this.parseResponse(response);
    if (!response.ok) {
      throw new CodeWaveDaemonError(errorMessage(response.status), response.status);
    }
    const connectionId = (payload as Partial<ClientHandshakeResponse>)?.connectionId;
    const grantedScopes = (payload as Partial<ClientHandshakeResponse>)?.grantedScopes;
    if (
      typeof connectionId !== 'string' ||
      !Array.isArray(grantedScopes) ||
      OBSERVER_SCOPES.some((scope) => !grantedScopes.includes(scope))
    ) {
      throw new CodeWaveDaemonError('The daemon returned an invalid or under-scoped handshake.');
    }
    this.connectionId = connectionId;
    return connectionId;
  }

  private ensureConnection(): Promise<string> {
    if (this.connectionId) return Promise.resolve(this.connectionId);
    if (!this.handshakePromise) {
      this.handshakePromise = this.handshake().finally(() => {
        this.handshakePromise = null;
      });
    }
    return this.handshakePromise;
  }

  private async get<T>(pathname: string, signal?: AbortSignal, retry = true): Promise<T> {
    const connectionId = await this.ensureConnection();
    const response = await fetch(`${this.origin}${pathname}`, {
      headers: { 'x-codewave-connection': connectionId },
      signal: this.requestSignal(signal),
    });
    const payload = await this.parseResponse(response);
    if (response.status === 401 && retry) {
      this.connectionId = null;
      return this.get<T>(pathname, signal, false);
    }
    if (!response.ok) {
      throw new CodeWaveDaemonError(errorMessage(response.status), response.status);
    }
    return payload as T;
  }

  listSessions(signal?: AbortSignal): Promise<ArchiveSnapshot> {
    return this.get('/api/archive', signal);
  }

  getSession(sessionId: string, signal?: AbortSignal): Promise<SessionSnapshot> {
    return this.get(`/api/sessions/${encodeURIComponent(sessionId)}`, signal);
  }

  getRun(runId: string, signal?: AbortSignal): Promise<RunSnapshot> {
    return this.get(`/api/runs/${encodeURIComponent(runId)}`, signal);
  }

  readTranscript(
    sessionId: string,
    options: { before?: number; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<TranscriptWindow> {
    const query = new URLSearchParams();
    if (options.before !== undefined) query.set('before', String(options.before));
    query.set('limit', String(options.limit ?? 20));
    return this.get(
      `/api/sessions/${encodeURIComponent(sessionId)}/transcript?${query}`,
      signal,
    );
  }
}

export { OBSERVER_SCOPES };
