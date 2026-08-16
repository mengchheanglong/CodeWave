import {
  CODEWAVE_PROTOCOL_VERSION,
  DAEMON_CLIENT_SCOPES,
} from '@codewave/protocol';
import type {
  ApprovalRecord,
  ArchiveSnapshot,
  ClientHandshakeResponse,
  CompareRunRequest,
  CompareRunResponse,
  CreateSessionRequest,
  DeleteSessionResponse,
  DelegateRunRequest,
  DelegateRunResponse,
  DaemonClientScope,
  FollowUpRunRequest,
  FollowUpRunResponse,
  HandoffRunRequest,
  HandoffRunResponse,
  JsonError,
  OrchestrationBoardSnapshot,
  RecommendPromptRequest,
  RecommendPromptResponse,
  RecoverSessionRequest,
  RecoverSessionResponse,
  ResolveApprovalRequest,
  RoutePromptRequest,
  RoutePromptResponse,
  RunSnapshot,
  SteerRunRequest,
  SteerRunResponse,
  RuntimeInfo,
  ProviderId,
  ProviderRegistrySnapshot,
  SessionSnapshot,
  StartRunRequest,
  ToolPlaneResponse,
  TranscriptWindow,
  UndoRunResponse,
  UpdateSessionRequest,
  UpdateDefaultProviderRequest,
  UpdateProviderConfigurationRequest,
  WorkbenchSession,
} from '@codewave/protocol';

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | object | null;
};

interface ToolPlaneQuery {
  workspacePath?: string;
  sessionId?: string;
}

export interface DaemonApi {
  getRuntime(): Promise<RuntimeInfo>;
  getProviders(): Promise<ProviderRegistrySnapshot>;
  updateProvider(
    providerId: ProviderId,
    input: UpdateProviderConfigurationRequest,
  ): Promise<ProviderRegistrySnapshot>;
  updateDefaultProvider(
    input: UpdateDefaultProviderRequest,
  ): Promise<ProviderRegistrySnapshot>;
  getToolPlane(query?: ToolPlaneQuery): Promise<ToolPlaneResponse>;
  getSessions(): Promise<WorkbenchSession[]>;
  createSession(input: CreateSessionRequest): Promise<WorkbenchSession>;
  deleteSession(sessionId: string): Promise<DeleteSessionResponse>;
  getSession(sessionId: string): Promise<SessionSnapshot>;
  getSessionTranscript(
    sessionId: string,
    options?: { beforeSequence?: number; limit?: number },
  ): Promise<TranscriptWindow>;
  updateSession(
    sessionId: string,
    input: UpdateSessionRequest,
  ): Promise<WorkbenchSession>;
  recoverSession(
    sessionId: string,
    input: RecoverSessionRequest,
  ): Promise<RecoverSessionResponse>;
  startRun(sessionId: string, input: StartRunRequest): Promise<RunSnapshot>;
  steerRun(runId: string, input: SteerRunRequest): Promise<SteerRunResponse>;
  getRun(runId: string): Promise<RunSnapshot>;
  getRunStreamUrl(runId: string, afterSequence?: number): Promise<string>;
  cancelRun(runId: string): Promise<RunSnapshot>;
  undoRun(runId: string): Promise<UndoRunResponse>;
  compareRun(input: CompareRunRequest): Promise<CompareRunResponse>;
  getArchive(): Promise<ArchiveSnapshot>;
  getOrchestrationBoard(): Promise<OrchestrationBoardSnapshot>;
  recommendPrompt(
    input: RecommendPromptRequest,
  ): Promise<RecommendPromptResponse>;
  routePrompt(input: RoutePromptRequest): Promise<RoutePromptResponse>;
  createFollowUpRun(
    runId: string,
    input: FollowUpRunRequest,
  ): Promise<FollowUpRunResponse>;
  delegateRun(
    runId: string,
    input: DelegateRunRequest,
  ): Promise<DelegateRunResponse>;
  handoffRun(
    runId: string,
    input: HandoffRunRequest,
  ): Promise<HandoffRunResponse>;
  resolveApproval(
    approvalId: string,
    input: ResolveApprovalRequest,
  ): Promise<ApprovalRecord>;
  recoverCheckpointSession(
    checkpointId: string,
    input: RecoverSessionRequest,
  ): Promise<RecoverSessionResponse>;
}

class DaemonRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly currentProviderRevision?: string,
    readonly requiredScope?: DaemonClientScope,
    readonly supportedProtocolVersions?: number[],
  ) {
    super(message);
    this.name = 'DaemonRequestError';
  }
}

const WEB_CLIENT_VERSION = '0.1.0-dev';
let negotiatedConnection: ClientHandshakeResponse | null = null;
let handshakePromise: Promise<ClientHandshakeResponse> | null = null;

function hasUsableConnection(
  connection: ClientHandshakeResponse | null,
): connection is ClientHandshakeResponse {
  return Boolean(
    connection?.connectionId &&
      connection.protocolVersion === CODEWAVE_PROTOCOL_VERSION &&
      Date.parse(connection.expiresAt) > Date.now() + 5_000,
  );
}

async function readErrorPayload(response: Response): Promise<JsonError> {
  return (await response
    .json()
    .catch(() => ({ error: response.statusText }))) as JsonError;
}

function toDaemonRequestError(
  response: Response,
  payload: JsonError,
): DaemonRequestError {
  const message =
    typeof payload.error === 'string' && payload.error
      ? payload.error
      : response.statusText;
  return new DaemonRequestError(
    message,
    response.status,
    payload.code,
    payload.currentProviderRevision,
    payload.requiredScope,
    payload.supportedProtocolVersions,
  );
}

export function resetDaemonConnection(): void {
  negotiatedConnection = null;
  handshakePromise = null;
}

async function ensureDaemonConnection(): Promise<ClientHandshakeResponse> {
  if (hasUsableConnection(negotiatedConnection)) return negotiatedConnection;
  if (handshakePromise) return handshakePromise;

  handshakePromise = (async () => {
    const response = await fetch('/api/handshake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: 'codewave-web',
        clientVersion: WEB_CLIENT_VERSION,
        protocolVersion: CODEWAVE_PROTOCOL_VERSION,
        requestedScopes: [...DAEMON_CLIENT_SCOPES],
      }),
    });
    if (!response.ok) {
      throw toDaemonRequestError(response, await readErrorPayload(response));
    }
    const connection = (await response.json()) as ClientHandshakeResponse;
    if (
      !connection?.connectionId ||
      connection.protocolVersion !== CODEWAVE_PROTOCOL_VERSION ||
      !Array.isArray(connection.grantedScopes) ||
      !connection.expiresAt
    ) {
      throw new Error('The daemon returned an invalid handshake response.');
    }
    negotiatedConnection = connection;
    return connection;
  })();

  try {
    return await handshakePromise;
  } finally {
    handshakePromise = null;
  }
}

function withConnection(
  options: RequestInit,
  connection: ClientHandshakeResponse | null,
): RequestInit {
  if (!connection) return options;
  const headers = new Headers(options.headers);
  headers.set('X-CodeWave-Connection', connection.connectionId);
  return { ...options, headers };
}

export async function daemonFetch(
  path: string,
  options: RequestInit = {},
  { negotiateBeforeRequest = true }: { negotiateBeforeRequest?: boolean } = {},
): Promise<Response> {
  let connection = negotiateBeforeRequest
    ? await ensureDaemonConnection()
    : hasUsableConnection(negotiatedConnection)
      ? negotiatedConnection
      : null;
  let response = await fetch(path, withConnection(options, connection));

  if (response.status === 401) {
    const payload = await readErrorPayload(response.clone());
    if (
      payload.code === 'client_handshake_required' ||
      payload.code === 'client_connection_invalid' ||
      payload.code === 'client_connection_expired'
    ) {
      resetDaemonConnection();
      connection = await ensureDaemonConnection();
      response = await fetch(path, withConnection(options, connection));
    }
  }
  return response;
}

export function createDaemonApi({
  onError,
  onProviderRevisionConflict,
}: {
  onError?: (message: string) => void;
  onProviderRevisionConflict?: (currentRevision: string) => void | Promise<void>;
} = {}): DaemonApi {
  async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { body, headers, ...rest } = options;
    const requestHeaders = new Headers(headers);
    const method = String(rest.method ?? 'GET').toUpperCase();
    if (
      (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') &&
      !requestHeaders.has('Idempotency-Key')
    ) {
      requestHeaders.set(
        'Idempotency-Key',
        globalThis.crypto?.randomUUID?.() ??
          `codewave-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
    }
    let requestBody: BodyInit | null | undefined = body as BodyInit | null | undefined;

    if (
      body &&
      typeof body === 'object' &&
      !(body instanceof FormData) &&
      !(body instanceof URLSearchParams) &&
      !(body instanceof Blob) &&
      !(body instanceof ArrayBuffer)
    ) {
      requestHeaders.set('Content-Type', 'application/json');
      requestBody = JSON.stringify(body);
    } else if (!requestHeaders.has('Content-Type')) {
      requestHeaders.set('Content-Type', 'application/json');
    }

    let response: Response;
    try {
      response = await daemonFetch(path, {
        ...rest,
        headers: requestHeaders,
        body: requestBody,
      });
    } catch (error) {
      onError?.(
        error instanceof Error
          ? error.message
          : 'The daemon connection could not be negotiated.',
      );
      throw error;
    }

    if (!response.ok) {
      const payload = await readErrorPayload(response);
      const error = toDaemonRequestError(response, payload);
      if (
        payload.code === 'provider_revision_conflict' &&
        payload.currentProviderRevision
      ) {
        try {
          await onProviderRevisionConflict?.(payload.currentProviderRevision);
        } catch {
          // Preserve the authoritative daemon conflict even if refresh also fails.
        }
      }
      onError?.(error.message);
      throw error;
    }

    return (await response.json()) as T;
  }

  return {
    getRuntime() {
      return requestJson<RuntimeInfo>('/api/runtime');
    },
    getProviders() {
      return requestJson<ProviderRegistrySnapshot>('/api/providers');
    },
    updateProvider(providerId, input) {
      return requestJson<ProviderRegistrySnapshot>(`/api/providers/${providerId}`, {
        method: 'PATCH',
        body: input,
      });
    },
    updateDefaultProvider(input) {
      return requestJson<ProviderRegistrySnapshot>('/api/providers/default', {
        method: 'PATCH',
        body: input,
      });
    },
    getToolPlane(query = {}) {
      const params = new URLSearchParams();
      if (query.workspacePath) {
        params.set('workspacePath', query.workspacePath);
      }
      if (query.sessionId) {
        params.set('sessionId', query.sessionId);
      }
      const suffix = params.toString() ? `?${params.toString()}` : '';
      return requestJson<ToolPlaneResponse>(`/api/tool-plane${suffix}`);
    },
    getSessions() {
      return requestJson<WorkbenchSession[]>('/api/sessions');
    },
    createSession(input) {
      return requestJson<WorkbenchSession>('/api/sessions', {
        method: 'POST',
        body: input,
      });
    },
    deleteSession(sessionId) {
      return requestJson<DeleteSessionResponse>(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
      });
    },
    getSession(sessionId) {
      return requestJson<SessionSnapshot>(`/api/sessions/${sessionId}`);
    },
    getSessionTranscript(sessionId, options = {}) {
      const params = new URLSearchParams();
      if (options.beforeSequence !== undefined) {
        params.set('before', String(options.beforeSequence));
      }
      if (options.limit !== undefined) {
        params.set('limit', String(options.limit));
      }
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      return requestJson<TranscriptWindow>(
        `/api/sessions/${sessionId}/transcript${suffix}`,
      );
    },
    updateSession(sessionId, input) {
      return requestJson<WorkbenchSession>(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        body: input,
      });
    },
    recoverSession(sessionId, input) {
      return requestJson<RecoverSessionResponse>(
        `/api/sessions/${sessionId}/recover`,
        {
          method: 'POST',
          body: input,
        },
      );
    },
    startRun(sessionId, input) {
      return requestJson<RunSnapshot>(`/api/sessions/${sessionId}/runs`, {
        method: 'POST',
        body: input,
      });
    },
    steerRun(runId, input) {
      return requestJson<SteerRunResponse>(`/api/runs/${runId}/steer`, {
        method: 'POST',
        body: input,
      });
    },
    getRun(runId) {
      return requestJson<RunSnapshot>(`/api/runs/${runId}`);
    },
    async getRunStreamUrl(runId, afterSequence) {
      const connection = await ensureDaemonConnection();
      const params = new URLSearchParams({
        connectionId: connection.connectionId,
      });
      if (afterSequence !== undefined) {
        params.set('after', String(afterSequence));
      }
      return `/api/runs/${encodeURIComponent(runId)}/stream?${params.toString()}`;
    },
    cancelRun(runId) {
      return requestJson<RunSnapshot>(`/api/runs/${runId}/cancel`, {
        method: 'POST',
      });
    },
    undoRun(runId) {
      return requestJson<UndoRunResponse>(`/api/runs/${runId}/undo`, {
        method: 'POST',
      });
    },
    compareRun(input) {
      return requestJson<CompareRunResponse>('/api/compare', {
        method: 'POST',
        body: input,
      });
    },
    getArchive() {
      return requestJson<ArchiveSnapshot>('/api/archive');
    },
    getOrchestrationBoard() {
      return requestJson<OrchestrationBoardSnapshot>('/api/orchestrator/board');
    },
    recommendPrompt(input) {
      return requestJson<RecommendPromptResponse>('/api/orchestrator/recommend', {
        method: 'POST',
        body: input,
      });
    },
    routePrompt(input) {
      return requestJson<RoutePromptResponse>('/api/orchestrator/route', {
        method: 'POST',
        body: input,
      });
    },
    createFollowUpRun(runId, input) {
      return requestJson<FollowUpRunResponse>(`/api/runs/${runId}/follow-up`, {
        method: 'POST',
        body: input,
      });
    },
    delegateRun(runId, input) {
      return requestJson<DelegateRunResponse>(`/api/runs/${runId}/delegate`, {
        method: 'POST',
        body: input,
      });
    },
    handoffRun(runId, input) {
      return requestJson<HandoffRunResponse>(`/api/runs/${runId}/handoff`, {
        method: 'POST',
        body: input,
      });
    },
    resolveApproval(approvalId, input) {
      return requestJson<ApprovalRecord>(`/api/approvals/${approvalId}/resolve`, {
        method: 'POST',
        body: input,
      });
    },
    recoverCheckpointSession(checkpointId, input) {
      return requestJson<RecoverSessionResponse>(
        `/api/checkpoints/${checkpointId}/recover-session`,
        {
          method: 'POST',
          body: input,
        },
      );
    },
  };
}
