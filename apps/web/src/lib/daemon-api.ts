import type {
  ApprovalRecord,
  ArchiveSnapshot,
  CompareRunRequest,
  CompareRunResponse,
  CreateSessionRequest,
  DeleteSessionResponse,
  DelegateRunRequest,
  DelegateRunResponse,
  FollowUpRunRequest,
  FollowUpRunResponse,
  HandoffRunRequest,
  HandoffRunResponse,
  JsonError,
  OrchestrationBoardSnapshot,
  RecommendPromptRequest,
  RecommendPromptResponse,
  RecoverSessionResponse,
  ResolveApprovalRequest,
  RoutePromptRequest,
  RoutePromptResponse,
  RunSnapshot,
  RuntimeInfo,
  SessionSnapshot,
  StartRunRequest,
  ToolPlaneResponse,
  UndoRunResponse,
  UpdateSessionRequest,
  WorkbenchSession,
} from '@qwemini/protocol';

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | object | null;
};

export interface ToolPlaneQuery {
  workspacePath?: string;
  sessionId?: string;
}

export interface DaemonApi {
  getRuntime(): Promise<RuntimeInfo>;
  getToolPlane(query?: ToolPlaneQuery): Promise<ToolPlaneResponse>;
  getSessions(): Promise<WorkbenchSession[]>;
  createSession(input: CreateSessionRequest): Promise<WorkbenchSession>;
  deleteSession(sessionId: string): Promise<DeleteSessionResponse>;
  getSession(sessionId: string): Promise<SessionSnapshot>;
  updateSession(
    sessionId: string,
    input: UpdateSessionRequest,
  ): Promise<WorkbenchSession>;
  recoverSession(sessionId: string): Promise<RecoverSessionResponse>;
  startRun(sessionId: string, input: StartRunRequest): Promise<RunSnapshot>;
  getRun(runId: string): Promise<RunSnapshot>;
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
  ): Promise<RecoverSessionResponse>;
}

export function createDaemonApi({
  onError,
}: {
  onError?: (message: string) => void;
} = {}): DaemonApi {
  async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { body, headers, ...rest } = options;
    const requestHeaders = new Headers(headers);
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

    const response = await fetch(path, {
      ...rest,
      headers: requestHeaders,
      body: requestBody,
    });

    if (!response.ok) {
      const payload = (await response
        .json()
        .catch(() => ({ error: response.statusText }))) as JsonError;
      const message =
        typeof payload.error === 'string' && payload.error
          ? payload.error
          : response.statusText;
      onError?.(message);
      throw new Error(message);
    }

    return (await response.json()) as T;
  }

  return {
    getRuntime() {
      return requestJson<RuntimeInfo>('/api/runtime');
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
    updateSession(sessionId, input) {
      return requestJson<WorkbenchSession>(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        body: input,
      });
    },
    recoverSession(sessionId) {
      return requestJson<RecoverSessionResponse>(
        `/api/sessions/${sessionId}/recover`,
        {
          method: 'POST',
        },
      );
    },
    startRun(sessionId, input) {
      return requestJson<RunSnapshot>(`/api/sessions/${sessionId}/runs`, {
        method: 'POST',
        body: input,
      });
    },
    getRun(runId) {
      return requestJson<RunSnapshot>(`/api/runs/${runId}`);
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
    recoverCheckpointSession(checkpointId) {
      return requestJson<RecoverSessionResponse>(
        `/api/checkpoints/${checkpointId}/recover-session`,
        {
          method: 'POST',
        },
      );
    },
  };
}
