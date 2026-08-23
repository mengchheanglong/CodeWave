import {
  CODEWAVE_PROTOCOL_VERSION,
  DAEMON_CLIENT_SCOPES,
  type DaemonClientScope,
} from "@codewave/protocol";

export const CW_DUEL_CLIENT_NAME = "cw-duel";
export const CW_DUEL_CLIENT_VERSION = "0.0.1";

const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

export class DaemonConnectionError extends Error {
  constructor(
    readonly baseUrl: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DaemonConnectionError";
  }
}

export class DaemonRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly payload: unknown = null,
  ) {
    super(message);
    this.name = "DaemonRequestError";
  }

  get code(): string | null {
    if (
      this.payload !== null &&
      typeof this.payload === "object" &&
      "code" in this.payload
    ) {
      const value = (this.payload as { code?: unknown }).code;
      return typeof value === "string" ? value : null;
    }
    return null;
  }
}

export interface DaemonRequestInit {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
}

interface HandshakePayload {
  connectionId?: unknown;
  grantedScopes?: unknown;
}

/**
 * Connected daemon client. Owns the handshake lifecycle and the
 * X-CodeWave-Connection header, retrying once when the daemon reports the
 * connection as expired (HTTP 401).
 */
export class DaemonClient {
  private connectionId: string | null = null;

  constructor(readonly baseUrl: string) {}

  get isConnected(): boolean {
    return this.connectionId !== null;
  }

  /** Negotiated connection id; only valid after a successful connect(). */
  get currentConnectionId(): string | null {
    return this.connectionId;
  }

  async connect(): Promise<string> {
    this.connectionId = await this.handshake();
    return this.connectionId;
  }

  async ensureConnected(): Promise<string> {
    if (this.connectionId) return this.connectionId;
    return this.connect();
  }

  async request<T>(pathname: string, init: DaemonRequestInit = {}): Promise<T> {
    const first = await this.authenticatedFetch(pathname, init, false);
    if (first.response.status === 401 && !first.reused) {
      // Connection expired or unknown to the daemon: reconnect once and retry.
      await this.connect();
      const second = await this.authenticatedFetch(pathname, init, true);
      const secondPayload = await parseJsonBody(second.response);
      if (!second.response.ok) {
        throw await this.toError({ response: second.response, payload: secondPayload });
      }
      return secondPayload as T;
    }
    const firstPayload = await parseJsonBody(first.response);
    if (!first.response.ok) {
      throw await this.toError({ response: first.response, payload: firstPayload });
    }
    return firstPayload as T;
  }

  private async handshake(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/handshake`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientName: CW_DUEL_CLIENT_NAME,
          clientVersion: CW_DUEL_CLIENT_VERSION,
          protocolVersion: CODEWAVE_PROTOCOL_VERSION,
          requestedScopes: [...DAEMON_CLIENT_SCOPES],
        }),
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new DaemonConnectionError(
        this.baseUrl,
        `Could not reach the CodeWave daemon at ${this.baseUrl} — is the daemon running? (${describeCause(cause)})`,
        { cause },
      );
    }
    const payload = await parseJsonBody(response);
    if (!response.ok) throw await this.toError({ response, payload });
    const connectionId = (payload as HandshakePayload).connectionId;
    const grantedScopes = (payload as HandshakePayload).grantedScopes;
    if (
      typeof connectionId !== "string" ||
      connectionId.length === 0 ||
      !Array.isArray(grantedScopes) ||
      DAEMON_CLIENT_SCOPES.some(
        (scope) => !(grantedScopes as unknown[]).includes(scope),
      )
    ) {
      throw new DaemonConnectionError(
        this.baseUrl,
        `The CodeWave daemon at ${this.baseUrl} returned an invalid or under-scoped handshake.`,
      );
    }
    return connectionId;
  }

  private async authenticatedFetch(
    pathname: string,
    init: DaemonRequestInit,
    reused: boolean,
  ): Promise<{ response: Response; ok: boolean; reused: boolean }> {
    const connectionId = await this.ensureConnected();
    const headers: Record<string, string> = {
      "X-CodeWave-Connection": connectionId,
    };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = init.idempotencyKey;
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${pathname}`, {
        method: init.method ?? "GET",
        headers,
        ...(init.body !== undefined
          ? { body: JSON.stringify(init.body) }
          : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new DaemonConnectionError(
        this.baseUrl,
        `Could not reach the CodeWave daemon at ${this.baseUrl} while calling ${pathname}. (${describeCause(cause)})`,
        { cause },
      );
    }
    return { response, ok: response.ok, reused };
  }

  private async toError(result: {
    response: Response;
    payload: unknown;
  }): Promise<DaemonRequestError> {
    const message =
      extractErrorMessage(result.payload) ??
      `The CodeWave daemon request failed (HTTP ${result.response.status}).`;
    return new DaemonRequestError(message, result.response.status, result.payload);
  }
}

/** Handshake with the daemon and return a ready-to-use client. */
export async function connectDaemon(baseUrl: string): Promise<DaemonClient> {
  const origin = normalizeBaseUrl(baseUrl);
  const client = new DaemonClient(origin);
  await client.connect();
  return client;
}

function normalizeBaseUrl(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`Invalid CodeWave daemon URL: ${value}`);
  }
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DaemonRequestError(
      "The CodeWave daemon returned malformed JSON.",
      response.status,
      null,
    );
  }
}

function extractErrorMessage(payload: unknown): string | null {
  if (
    payload !== null &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return null;
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
