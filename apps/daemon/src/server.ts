import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename as renamePath, rm, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildToolPlaneSnapshot, loadWorkspaceToolRegistry } from '@qwemini/mcp-hub';
import {
  type ArchiveSnapshot,
  DEFAULT_DAEMON_PORT,
  DEFAULT_PROVIDER_ID,
  type ApprovalPolicy,
  type ApprovalRecord,
  type ArtifactRecord,
  type CheckpointRecord,
  type CompareRunLane,
  type CompareRunRequest,
  type CompareRunResponse,
  type CreateSessionRequest,
  type DeleteSessionResponse,
  type DelegateRunRequest,
  type DelegateRunResponse,
  type FollowUpRunRequest,
  type FollowUpRunResponse,
  type HandoffRunRequest,
  type HandoffRunResponse,
  type RecommendPromptRequest,
  type RecommendPromptResponse,
  type OrchestrationRecommendation,
  type OrchestrationBoardSnapshot,
  type OrchestrationFlowSummary,
  type OrchestrationFlowSessionSummary,
  type OrchestrationRole,
  type ProviderAdapter,
  type ProviderApprovalDecision,
  type ProviderApprovalRequest,
  type ProviderCapabilities,
  type ProviderSessionUpdate,
  type ProviderHealth,
  type ProviderId,
  type ProviderToolCapability,
  type ResolveApprovalRequest,
  type RecoverSessionResponse,
  type RoutingToolRequirement,
  type RoutePromptRequest,
  type RoutePromptResponse,
  type RunSnapshot,
  type UndoRunResponse,
  type RuntimeInfo,
  type ToolDescriptorSource,
  type SessionSnapshot,
  type StartRunRequest,
  type ToolPlaneResponse,
  type ToolPlaneSnapshot,
  type ToolInvocationRecord,
  type UpdateSessionRequest,
  type WorkbenchEvent,
  type WorkbenchRun,
  type RunStatus,
  type WorkbenchSession,
  inferRoutingToolRequirement,
  isRoutingToolRequirement,
} from '@qwemini/protocol';
import {
  buildDelegatedPrompt,
  buildFollowUpPrompt,
  buildHandoffPrompt,
  getFollowUpRole,
  recommendDelegatedRoute,
  recommendFollowUpRoute,
  recommendHandoffRoute,
  recommendProviderRoute,
} from '@qwemini/orchestrator';
import { FreebuffCliProvider } from '@qwemini/provider-freebuff';
import { GeminiCliProvider } from '@qwemini/provider-gemini';
import { OpenCodeCliProvider } from '@qwemini/provider-opencode';
import { QwenCliProvider } from '@qwemini/provider-qwen';
import { SQLiteStateStore, resolveDataDirectory } from '@qwemini/state';

const WEB_DIST_ROOT = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const MIME_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.map', 'application/json; charset=utf-8'],
]);

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    throw new Error('Request body is required.');
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function notFound(response: ServerResponse): void {
  sendJson(response, 404, { error: 'Not found' });
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function isApprovalPolicy(value: string): value is ApprovalPolicy {
  return value === 'manual' || value === 'allow' || value === 'deny';
}

function isFollowUpKind(
  value: string,
): value is FollowUpRunRequest['kind'] {
  return value === 'review' || value === 'verify';
}

function isDelegateRole(
  value: string,
): value is DelegateRunRequest['role'] {
  return (
    value === 'planner' ||
    value === 'reviewer' ||
    value === 'verifier' ||
    value === 'researcher'
  );
}

function isToolDescriptorSource(value: unknown): value is ToolDescriptorSource {
  return (
    value === 'internal' ||
    value === 'mcp' ||
    value === 'provider' ||
    value === 'plugin'
  );
}

function inferToolRequirement(
  toolName: string,
  detail: string | null,
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
): RoutingToolRequirement | null {
  return inferRoutingToolRequirement({
    toolName,
    detail,
    input,
    metadata,
    explicitRequirementCandidates: [
      metadata.requirement,
      metadata.routingRequirement,
      metadata.toolRequirement,
    ],
  });
}

function inferToolSource(
  requirement: RoutingToolRequirement,
  metadata: Record<string, unknown>,
): ToolDescriptorSource {
  const explicitSourceCandidates = [
    metadata.source,
    metadata.toolSource,
    metadata.providerSource,
  ];
  for (const candidate of explicitSourceCandidates) {
    if (isToolDescriptorSource(candidate)) {
      return candidate;
    }
  }

  return requirement === 'mcp' ? 'mcp' : 'provider';
}

class RunEventBroker {
  private readonly subscribers = new Map<string, Set<ServerResponse>>();

  subscribe(runId: string, response: ServerResponse): void {
    const current = this.subscribers.get(runId) ?? new Set<ServerResponse>();
    current.add(response);
    this.subscribers.set(runId, current);
  }

  unsubscribe(runId: string, response: ServerResponse): void {
    const current = this.subscribers.get(runId);
    if (!current) {
      return;
    }

    current.delete(response);
    if (current.size === 0) {
      this.subscribers.delete(runId);
    }
  }

  publish(event: WorkbenchEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const subscribers = this.subscribers.get(event.runId);
    if (!subscribers) {
      return;
    }

    for (const response of subscribers) {
      response.write(payload);
    }
  }
}

type PendingApproval = {
  approvalId: string;
  runId: string;
  resolve: (decision: ProviderApprovalDecision) => void;
};

type WorkspaceEntryKind = 'file' | 'folder';

type WorkspaceEntryRecord = {
  name: string;
  relativePath: string;
  kind: WorkspaceEntryKind;
};

type WorkspaceEntriesResponse = {
  workspacePath: string;
  relativePath: string;
  entries: WorkspaceEntryRecord[];
};

type CreateWorkspaceFolderRequest = {
  workspacePath: string;
  parentPath?: string | null;
  name: string;
};

type RenameWorkspaceEntryRequest = {
  workspacePath: string;
  targetPath: string;
  nextName: string;
};

const execFileAsync = promisify(execFile);

async function getGitHeadCommit(workspacePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--short', 'HEAD'],
      { cwd: workspacePath, timeout: 5000, windowsHide: true },
    );
    const value = stdout.trim();
    return value || null;
  } catch {
    return null;
  }
}

async function gitResetToCommit(
  workspacePath: string,
  commit: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['reset', '--hard', commit],
      { cwd: workspacePath, timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    return { ok: true, detail: `Reset workspace to ${commit}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `Git reset failed: ${message}` };
  }
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function isValidEntryName(value: string): boolean {
  if (!value || value === '.' || value === '..') {
    return false;
  }

  if (value.includes('/') || value.includes('\\')) {
    return false;
  }

  return true;
}

export class QweminiDaemon {
  private readonly port: number;
  private readonly dataDirectory: string;
  private readonly stateStore: SQLiteStateStore;
  private readonly eventBroker = new RunEventBroker();
  private readonly providers = new Map<string, ProviderAdapter>();
  private readonly runHandles = new Map<string, { cancel: () => Promise<void> }>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  constructor(private readonly rootPath: string, port = DEFAULT_DAEMON_PORT) {
    this.port = port;
    this.dataDirectory = resolveDataDirectory(rootPath);
    this.stateStore = new SQLiteStateStore(
      path.join(this.dataDirectory, 'state.sqlite'),
    );
    this.providers.set(DEFAULT_PROVIDER_ID, new QwenCliProvider({ rootPath }));
    this.providers.set('gemini', new GeminiCliProvider());
    this.providers.set('opencode', new OpenCodeCliProvider({ rootPath }));
    this.providers.set('freebuff', new FreebuffCliProvider({ rootPath }));
  }

  async start(): Promise<void> {
    const server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        try {
          sendJson(response, 400, {
            error: `Daemon request failed: ${message}`,
          });
        } catch {
          response.destroy();
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!request.url) {
      notFound(response);
      return;
    }

    const url = new URL(request.url, this.getBaseUrl());
    const pathname = url.pathname;

    if (request.method === 'GET' && pathname === '/api/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/runtime') {
      sendJson(response, 200, await this.buildRuntimeInfo());
      return;
    }

    if (request.method === 'GET' && pathname === '/api/tool-plane') {
      const workspacePath = url.searchParams.get('workspacePath');
      const sessionId = url.searchParams.get('sessionId');
      sendJson(
        response,
        200,
        {
          snapshot: await this.buildToolPlane(
            workspacePath ?? undefined,
            sessionId ?? undefined,
          ),
        } satisfies ToolPlaneResponse,
      );
      return;
    }

    if (request.method === 'GET' && pathname === '/api/workspace/entries') {
      const workspacePath = url.searchParams.get('workspacePath');
      if (!workspacePath) {
        sendJson(response, 400, { error: 'workspacePath is required.' });
        return;
      }

      const relativePath = url.searchParams.get('relativePath') ?? '';
      const listing = await this.listWorkspaceEntries(workspacePath, relativePath);
      if (listing instanceof Error) {
        sendJson(response, 409, { error: listing.message });
        return;
      }

      sendJson(response, 200, listing satisfies WorkspaceEntriesResponse);
      return;
    }

    if (request.method === 'POST' && pathname === '/api/workspace/folders') {
      const body = await readJsonBody<CreateWorkspaceFolderRequest>(request);
      const created = await this.createWorkspaceFolder(body);
      if (created instanceof Error) {
        sendJson(response, 409, { error: created.message });
        return;
      }

      sendJson(response, 201, { ok: true });
      return;
    }

    if (request.method === 'PATCH' && pathname === '/api/workspace/entries/rename') {
      const body = await readJsonBody<RenameWorkspaceEntryRequest>(request);
      const renamed = await this.renameWorkspaceEntry(body);
      if (renamed instanceof Error) {
        sendJson(response, 409, { error: renamed.message });
        return;
      }

      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'DELETE' && pathname === '/api/workspace/entries') {
      const workspacePath = url.searchParams.get('workspacePath');
      const targetPath = url.searchParams.get('targetPath');
      if (!workspacePath || targetPath === null) {
        sendJson(response, 400, { error: 'workspacePath and targetPath are required.' });
        return;
      }

      const deleted = await this.deleteWorkspaceEntry(workspacePath, targetPath);
      if (deleted instanceof Error) {
        sendJson(response, 409, { error: deleted.message });
        return;
      }

      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'DELETE' && pathname === '/api/workspace/folders') {
      const workspacePath = url.searchParams.get('workspacePath');
      const targetPath = url.searchParams.get('targetPath');
      if (!workspacePath || targetPath === null) {
        sendJson(response, 400, { error: 'workspacePath and targetPath are required.' });
        return;
      }

      const deleted = await this.deleteWorkspaceFolder(workspacePath, targetPath);
      if (deleted instanceof Error) {
        sendJson(response, 409, { error: deleted.message });
        return;
      }

      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/orchestrator/recommend') {
      const body = await readJsonBody<RecommendPromptRequest>(request);
      const recommendation = await this.recommendPrompt(body);
      if (recommendation instanceof Error) {
        sendJson(response, 409, { error: recommendation.message });
        return;
      }

      sendJson(
        response,
        200,
        { recommendation } satisfies RecommendPromptResponse,
      );
      return;
    }

    if (request.method === 'POST' && pathname === '/api/orchestrator/route') {
      const body = await readJsonBody<RoutePromptRequest>(request);
      const route = await this.routePrompt(body);
      if (route instanceof Error) {
        sendJson(response, 409, { error: route.message });
        return;
      }

      sendJson(response, 201, route satisfies RoutePromptResponse);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/sessions') {
      sendJson(response, 200, this.stateStore.listSessions());
      return;
    }

    if (request.method === 'GET' && pathname === '/api/archive') {
      sendJson(response, 200, {
        sessions: this.stateStore.listArchiveSessions(),
      } satisfies ArchiveSnapshot);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/orchestrator/board') {
      sendJson(
        response,
        200,
        this.buildOrchestrationBoard() satisfies OrchestrationBoardSnapshot,
      );
      return;
    }

    if (request.method === 'POST' && pathname === '/api/sessions') {
      const body = await readJsonBody<CreateSessionRequest>(request);
      const session = await this.createSession(body);
      if (session instanceof Error) {
        sendJson(response, 409, { error: session.message });
        return;
      }
      sendJson(response, 201, session);
      return;
    }

    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (request.method === 'GET' && sessionMatch) {
      const snapshot = this.getSessionSnapshot(sessionMatch[1]!);
      if (!snapshot) {
        notFound(response);
        return;
      }

      sendJson(response, 200, snapshot);
      return;
    }

    if (request.method === 'PATCH' && sessionMatch) {
      const body = await readJsonBody<UpdateSessionRequest>(request);
      if (body.approvalPolicy && !isApprovalPolicy(body.approvalPolicy)) {
        sendJson(response, 400, { error: 'Invalid approval policy.' });
        return;
      }

      const session = await this.updateSessionPolicy(sessionMatch[1]!, body);
      if (!session) {
        notFound(response);
        return;
      }

      if (session instanceof Error) {
        sendJson(response, 409, { error: session.message });
        return;
      }

      sendJson(response, 200, session);
      return;
    }

    if (request.method === 'DELETE' && sessionMatch) {
      const deleted = this.stateStore.deleteSession(sessionMatch[1]!);
      if (!deleted) {
        notFound(response);
        return;
      }

      sendJson(
        response,
        200,
        { deletedSessionId: sessionMatch[1]! } satisfies DeleteSessionResponse,
      );
      return;
    }

    const recoverSessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/recover$/);
    if (request.method === 'POST' && recoverSessionMatch) {
      const recovered = await this.recoverSession(recoverSessionMatch[1]!);
      if (recovered === null) {
        notFound(response);
        return;
      }

      if (recovered instanceof Error) {
        sendJson(response, 409, { error: recovered.message });
        return;
      }

      sendJson(response, 201, { session: recovered } satisfies RecoverSessionResponse);
      return;
    }

    const sessionRunMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/runs$/);
    if (request.method === 'POST' && sessionRunMatch) {
      const body = await readJsonBody<StartRunRequest>(request);
      const snapshot = await this.startRun(sessionRunMatch[1]!, body);
      if (!snapshot) {
        notFound(response);
        return;
      }

      if (snapshot instanceof Error) {
        sendJson(response, 409, { error: snapshot.message });
        return;
      }

      sendJson(response, 201, snapshot);
      return;
    }

    if (request.method === 'POST' && pathname === '/api/compare') {
      const body = await readJsonBody<CompareRunRequest>(request);
      const responsePayload = await this.compareRun(body);
      if (responsePayload instanceof Error) {
        sendJson(response, 409, { error: responsePayload.message });
        return;
      }

      sendJson(response, 201, responsePayload satisfies CompareRunResponse);
      return;
    }

    const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (request.method === 'GET' && runMatch) {
      const snapshot = this.getRunSnapshot(runMatch[1]!);
      if (!snapshot) {
        notFound(response);
        return;
      }

      sendJson(response, 200, snapshot);
      return;
    }

    const followUpRunMatch = pathname.match(/^\/api\/runs\/([^/]+)\/follow-up$/);
    if (request.method === 'POST' && followUpRunMatch) {
      const body = await readJsonBody<FollowUpRunRequest>(request);
      if (!isFollowUpKind(body.kind)) {
        sendJson(response, 400, { error: 'Invalid follow-up kind.' });
        return;
      }
      const responsePayload = await this.createFollowUpRun(
        followUpRunMatch[1]!,
        body,
      );
      if (responsePayload === null) {
        notFound(response);
        return;
      }

      if (responsePayload instanceof Error) {
        sendJson(response, 409, { error: responsePayload.message });
        return;
      }

      sendJson(response, 201, responsePayload satisfies FollowUpRunResponse);
      return;
    }

    const delegateRunMatch = pathname.match(/^\/api\/runs\/([^/]+)\/delegate$/);
    if (request.method === 'POST' && delegateRunMatch) {
      const body = await readJsonBody<DelegateRunRequest>(request);
      if (!isDelegateRole(body.role)) {
        sendJson(response, 400, { error: 'Invalid delegate role.' });
        return;
      }

      const responsePayload = await this.createDelegatedRun(
        delegateRunMatch[1]!,
        body,
      );
      if (responsePayload === null) {
        notFound(response);
        return;
      }

      if (responsePayload instanceof Error) {
        sendJson(response, 409, { error: responsePayload.message });
        return;
      }

      sendJson(response, 201, responsePayload satisfies DelegateRunResponse);
      return;
    }

    const handoffRunMatch = pathname.match(/^\/api\/runs\/([^/]+)\/handoff$/);
    if (request.method === 'POST' && handoffRunMatch) {
      const body = await readJsonBody<HandoffRunRequest>(request);
      const responsePayload = await this.createHandedOffRun(
        handoffRunMatch[1]!,
        body,
      );
      if (responsePayload === null) {
        notFound(response);
        return;
      }

      if (responsePayload instanceof Error) {
        sendJson(response, 409, { error: responsePayload.message });
        return;
      }

      sendJson(response, 201, responsePayload satisfies HandoffRunResponse);
      return;
    }

    const cancelRunMatch = pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
    if (request.method === 'POST' && cancelRunMatch) {
      const snapshot = await this.cancelRun(cancelRunMatch[1]!);
      if (!snapshot) {
        notFound(response);
        return;
      }

      sendJson(response, 200, snapshot);
      return;
    }

    const undoRunMatch = pathname.match(/^\/api\/runs\/([^/]+)\/undo$/);
    if (request.method === 'POST' && undoRunMatch) {
      const result = await this.undoRun(undoRunMatch[1]!);
      if (result === null) {
        notFound(response);
        return;
      }

      if (result instanceof Error) {
        sendJson(response, 409, { error: result.message });
        return;
      }

      sendJson(response, 200, result satisfies UndoRunResponse);
      return;
    }

    const streamMatch = pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);
    if (request.method === 'GET' && streamMatch) {
      const runId = streamMatch[1]!;
      const run = this.stateStore.getRun(runId);
      if (!run) {
        notFound(response);
        return;
      }

      this.handleStream(runId, response);
      return;
    }

    const approvalMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/resolve$/);
    if (request.method === 'POST' && approvalMatch) {
      const body = await readJsonBody<ResolveApprovalRequest>(request);
      const approval = await this.resolveApproval(approvalMatch[1]!, body);
      if (!approval) {
        notFound(response);
        return;
      }

      sendJson(response, 200, approval);
      return;
    }

    const checkpointRecoverMatch = pathname.match(
      /^\/api\/checkpoints\/([^/]+)\/recover-session$/,
    );
    if (request.method === 'POST' && checkpointRecoverMatch) {
      const recovered = await this.recoverSessionFromCheckpoint(
        checkpointRecoverMatch[1]!,
      );
      if (recovered === null) {
        notFound(response);
        return;
      }

      if (recovered instanceof Error) {
        sendJson(response, 409, { error: recovered.message });
        return;
      }

      sendJson(response, 201, { session: recovered } satisfies RecoverSessionResponse);
      return;
    }

    await this.serveStatic(pathname, response);
  }

  private async serveStatic(
    pathname: string,
    response: ServerResponse,
  ): Promise<void> {
    const relativePath =
      pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const requestedPath = path.join(WEB_DIST_ROOT, relativePath);

    if (!requestedPath.startsWith(WEB_DIST_ROOT)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    let filePath = requestedPath;
    if (!existsSync(filePath)) {
      if (path.extname(relativePath)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }

      filePath = path.join(WEB_DIST_ROOT, 'index.html');
    }

    if (!existsSync(filePath)) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(
        'Web shell assets are not built yet. Run "npm run build:web" before starting the daemon shell.',
      );
      return;
    }

    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type':
        MIME_TYPES.get(path.extname(filePath)) ??
        'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
  }

  private async buildRuntimeInfo(): Promise<RuntimeInfo> {
    const providers = await this.listProviderHealth();

    return {
      defaultWorkspacePath: this.rootPath,
      dataDirectory: this.dataDirectory,
      providers,
    };
  }

  private resolveWorkspaceTargetPath(
    workspacePath: string,
    relativePath: string,
  ): { workspaceRoot: string; absolutePath: string } | Error {
    const workspaceRoot = path.resolve(workspacePath);
    const normalizedRelativePath = normalizeRelativePath(relativePath);
    const absolutePath = path.resolve(
      workspaceRoot,
      normalizedRelativePath || '.',
    );
    const relativeFromRoot = path.relative(workspaceRoot, absolutePath);

    if (
      relativeFromRoot.startsWith('..') ||
      path.isAbsolute(relativeFromRoot)
    ) {
      return new Error('Path escapes the selected workspace.');
    }

    return {
      workspaceRoot,
      absolutePath,
    };
  }

  private toWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
    const relativePath = path.relative(workspaceRoot, absolutePath);
    if (!relativePath) {
      return '';
    }

    return relativePath.split(path.sep).join('/');
  }

  private async listWorkspaceEntries(
    workspacePath: string,
    relativePath: string,
  ): Promise<WorkspaceEntriesResponse | Error> {
    const resolved = this.resolveWorkspaceTargetPath(workspacePath, relativePath);
    if (resolved instanceof Error) {
      return resolved;
    }

    const { workspaceRoot, absolutePath } = resolved;
    try {
      const targetStats = await stat(absolutePath);
      if (!targetStats.isDirectory()) {
        return new Error('The selected path is not a folder.');
      }

      const entries = await readdir(absolutePath, { withFileTypes: true });
      const mappedEntries: WorkspaceEntryRecord[] = entries
        .filter((entry) => entry.isDirectory() || entry.isFile())
        .map((entry) => {
          const entryAbsolutePath = path.join(absolutePath, entry.name);
          const kind: WorkspaceEntryKind = entry.isDirectory() ? 'folder' : 'file';
          return {
            name: entry.name,
            relativePath: this.toWorkspaceRelativePath(
              workspaceRoot,
              entryAbsolutePath,
            ),
            kind,
          };
        })
        .sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === 'folder' ? -1 : 1;
          }

          return left.name.localeCompare(right.name);
        });

      return {
        workspacePath: workspaceRoot,
        relativePath: this.toWorkspaceRelativePath(workspaceRoot, absolutePath),
        entries: mappedEntries,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Error(`Unable to list workspace entries: ${message}`);
    }
  }

  private async createWorkspaceFolder(
    request: CreateWorkspaceFolderRequest,
  ): Promise<true | Error> {
    const folderName = request.name.trim();
    if (!isValidEntryName(folderName)) {
      return new Error('Folder name is invalid.');
    }

    const resolvedParent = this.resolveWorkspaceTargetPath(
      request.workspacePath,
      request.parentPath ?? '',
    );
    if (resolvedParent instanceof Error) {
      return resolvedParent;
    }

    try {
      const parentStats = await stat(resolvedParent.absolutePath);
      if (!parentStats.isDirectory()) {
        return new Error('The parent path is not a folder.');
      }

      await mkdir(path.join(resolvedParent.absolutePath, folderName));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Error(`Unable to create folder: ${message}`);
    }
  }

  private async renameWorkspaceEntry(
    request: RenameWorkspaceEntryRequest,
  ): Promise<true | Error> {
    const nextName = request.nextName.trim();
    if (!isValidEntryName(nextName)) {
      return new Error('New name is invalid.');
    }

    const resolvedTarget = this.resolveWorkspaceTargetPath(
      request.workspacePath,
      request.targetPath,
    );
    if (resolvedTarget instanceof Error) {
      return resolvedTarget;
    }

    try {
      await stat(resolvedTarget.absolutePath);
      const parentPath = path.dirname(resolvedTarget.absolutePath);
      const nextAbsolutePath = path.resolve(parentPath, nextName);
      const relativeFromRoot = path.relative(
        resolvedTarget.workspaceRoot,
        nextAbsolutePath,
      );
      if (
        relativeFromRoot.startsWith('..') ||
        path.isAbsolute(relativeFromRoot)
      ) {
        return new Error('Renamed path escapes the selected workspace.');
      }

      await renamePath(resolvedTarget.absolutePath, nextAbsolutePath);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Error(`Unable to rename entry: ${message}`);
    }
  }

  private async deleteWorkspaceEntry(
    workspacePath: string,
    targetPath: string,
  ): Promise<true | Error> {
    const normalizedTargetPath = normalizeRelativePath(targetPath);
    if (!normalizedTargetPath) {
      return new Error('Refusing to delete the workspace root folder.');
    }

    const resolvedTarget = this.resolveWorkspaceTargetPath(
      workspacePath,
      normalizedTargetPath,
    );
    if (resolvedTarget instanceof Error) {
      return resolvedTarget;
    }

    try {
      const targetStats = await stat(resolvedTarget.absolutePath);
      if (targetStats.isDirectory()) {
        await rm(resolvedTarget.absolutePath, { recursive: true, force: false });
      } else {
        await rm(resolvedTarget.absolutePath, { force: false });
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Error(`Unable to delete entry: ${message}`);
    }
  }

  private async deleteWorkspaceFolder(
    workspacePath: string,
    targetPath: string,
  ): Promise<true | Error> {
    const normalizedTargetPath = normalizeRelativePath(targetPath);
    if (!normalizedTargetPath) {
      return new Error('Refusing to delete the workspace root folder.');
    }

    const resolvedTarget = this.resolveWorkspaceTargetPath(
      workspacePath,
      normalizedTargetPath,
    );
    if (resolvedTarget instanceof Error) {
      return resolvedTarget;
    }

    try {
      const targetStats = await stat(resolvedTarget.absolutePath);
      if (!targetStats.isDirectory()) {
        return new Error('Only folders can be deleted from this action.');
      }

      await rm(resolvedTarget.absolutePath, { recursive: true, force: false });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Error(`Unable to delete folder: ${message}`);
    }
  }

  private async listProviderHealth(): Promise<ProviderHealth[]> {
    return Promise.all(
      [...this.providers.values()].map((provider) => provider.healthCheck()),
    );
  }

  private async buildToolPlane(
    workspacePath = this.rootPath,
    sessionId?: string,
  ): Promise<ToolPlaneSnapshot> {
    const session = sessionId ? this.stateStore.getSession(sessionId) : null;
    const resolvedWorkspacePath = path.resolve(session?.workspacePath ?? workspacePath);
    const providers = await this.listProviderHealth();
    const providerCatalogEntries = await Promise.all(
      [...this.providers.entries()].map(async ([providerId, provider]) => [
        providerId,
        await provider.toolCatalog(),
      ] as const),
    );
    const providerCatalogs = Object.fromEntries(providerCatalogEntries) as Record<
      ProviderId,
      ProviderToolCapability[]
    >;
    const observedTools = (
      session
        ? this.stateStore.listRecentToolInvocationsForSession(session.id, 80)
        : this.stateStore.listRecentToolInvocations(80)
    )
      .map((invocation) => {
        const run = this.stateStore.getRun(invocation.runId);
        if (!run) {
          return null;
        }
        const invocationSession = this.stateStore.getSession(run.sessionId);
        if (!invocationSession) {
          return null;
        }
        if (session) {
          if (invocationSession.id !== session.id) {
            return null;
          }
        } else if (path.resolve(invocationSession.workspacePath) !== resolvedWorkspacePath) {
          return null;
        }

        return {
          providerId: run.providerId,
          invocation,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const registeredSessionTools = session
      ? this.stateStore.listSessionToolRegistrations(session.id)
      : [];

    return buildToolPlaneSnapshot({
      scope: session ? 'session' : 'workspace',
      sessionId: session?.id ?? null,
      workspacePath: resolvedWorkspacePath,
      providers,
      providerCatalogs,
      observedTools,
      registeredSessionTools,
      workspaceRegistry: loadWorkspaceToolRegistry(resolvedWorkspacePath),
    });
  }

  private async getProviderCapabilities(
    providerId: string,
  ): Promise<ProviderCapabilities | null> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return null;
    }

    return provider.capabilities();
  }

  private async getProviderHealth(providerId: string): Promise<ProviderHealth | null> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return null;
    }

    return provider.healthCheck();
  }

  private async validateApprovalPolicyForProvider(
    providerId: string,
    approvalPolicy: ApprovalPolicy,
  ): Promise<Error | null> {
    const capabilities = await this.getProviderCapabilities(providerId);
    if (!capabilities) {
      return new Error(`Provider ${providerId} is not configured.`);
    }

    if (approvalPolicy !== 'manual' && !capabilities.daemonApprovalMediation) {
      return new Error(
        `Provider ${providerId} does not support daemon-managed approval policies.`,
      );
    }

    return null;
  }

  private async resolveRouteApprovalPolicy(
    providerId: string,
    approvalPolicy: ApprovalPolicy,
  ): Promise<ApprovalPolicy | Error> {
    const capabilities = await this.getProviderCapabilities(providerId);
    if (!capabilities) {
      return new Error(`Provider ${providerId} is not configured.`);
    }

    if (approvalPolicy !== 'manual' && !capabilities.daemonApprovalMediation) {
      return 'manual';
    }

    return approvalPolicy;
  }

  private async recommendPrompt(
    input: RecommendPromptRequest,
  ) {
    const prompt = input.prompt.trim();
    const workspacePath = input.workspacePath.trim();
    if (!prompt) {
      return new Error('Prompt is required for orchestration.');
    }
    if (!workspacePath) {
      return new Error('Workspace path is required for orchestration.');
    }

    const providers = await this.listProviderHealth();
    const toolPlane = await this.buildToolPlane(
      workspacePath,
      input.sessionId ?? undefined,
    );

    try {
      return recommendProviderRoute({
        prompt,
        workspacePath: path.resolve(workspacePath),
        providers,
        preferredProviderId: input.preferredProviderId ?? null,
        requiredTools: input.requiredTools ?? [],
        toolPlane,
      });
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  private async routePrompt(
    input: RoutePromptRequest,
  ): Promise<RoutePromptResponse | Error> {
    const recommendation = await this.recommendPrompt(input);
    if (recommendation instanceof Error) {
      return recommendation;
    }

    const requestedApprovalPolicy =
      input.approvalPolicy && isApprovalPolicy(input.approvalPolicy)
        ? input.approvalPolicy
        : this.getDefaultApprovalPolicy();
    const approvalPolicy = await this.resolveRouteApprovalPolicy(
      recommendation.primaryProviderId,
      requestedApprovalPolicy,
    );
    if (approvalPolicy instanceof Error) {
      return approvalPolicy;
    }

    const session = await this.createSession({
      workspacePath: recommendation.workspacePath,
      providerId: recommendation.primaryProviderId,
      approvalPolicy,
      orchestration: {
        kind: 'route',
        role: 'main',
        sourceSessionId: null,
        sourceRunId: null,
        sourceProviderId: null,
      },
    });
    if (session instanceof Error) {
      return session;
    }

    const runSnapshot = await this.startRun(session.id, {
      prompt: recommendation.prompt,
    });
    if (!runSnapshot) {
      return new Error('Failed to create the routed run session.');
    }
    if (runSnapshot instanceof Error) {
      return runSnapshot;
    }

    return {
      recommendation,
      session,
      runSnapshot,
    };
  }

  private extractFollowUpSourceOutput(runSnapshot: RunSnapshot): string {
    const assistantArtifacts = runSnapshot.artifacts
      .filter((artifact) => artifact.kind === 'text')
      .map((artifact) => artifact.content.trim())
      .filter(Boolean);
    if (assistantArtifacts.length > 0) {
      return assistantArtifacts[assistantArtifacts.length - 1]!;
    }

    const assistantMessages = runSnapshot.events
      .filter(
        (event) =>
          event.type === 'message.created' &&
          event.payload.role === 'assistant' &&
          typeof event.payload.content === 'string',
      )
      .map((event) => String(event.payload.content).trim())
      .filter(Boolean);
    if (assistantMessages.length > 0) {
      return assistantMessages[assistantMessages.length - 1]!;
    }

    const completedPayload = [...runSnapshot.events]
      .reverse()
      .find(
        (event: WorkbenchEvent) =>
          event.type === 'run.completed' &&
          typeof event.payload.result === 'string',
      );
    return completedPayload ? String(completedPayload.payload.result) : '';
  }

  private async createOrchestratedSessionFromRecommendation(
    recommendation: OrchestrationRecommendation,
    approvalPolicy: ApprovalPolicy,
    orchestration: WorkbenchSession['orchestration'],
  ): Promise<WorkbenchSession | Error> {
    return this.createSession({
      workspacePath: recommendation.workspacePath,
      providerId: recommendation.primaryProviderId,
      approvalPolicy,
      orchestration,
    });
  }

  private getCompletedSourceRunContext(
    runId: string,
  ): { runSnapshot: RunSnapshot; session: WorkbenchSession } | Error | null {
    const runSnapshot = this.getRunSnapshot(runId);
    if (!runSnapshot) {
      return null;
    }

    if (runSnapshot.run.status !== 'completed') {
      return new Error('Orchestrated child runs can only fork from completed runs.');
    }

    const session = this.stateStore.getSession(runSnapshot.run.sessionId);
    if (!session) {
      return null;
    }

    return { runSnapshot, session };
  }

  private async createFollowUpRun(
    runId: string,
    input: FollowUpRunRequest,
  ): Promise<FollowUpRunResponse | Error | null> {
    const sourceContext = this.getCompletedSourceRunContext(runId);
    if (!sourceContext || sourceContext instanceof Error) {
      return sourceContext;
    }
    const { runSnapshot: sourceRunSnapshot, session: sourceSession } = sourceContext;

    const providers = await this.listProviderHealth();
    let recommendation: OrchestrationRecommendation;
    try {
      recommendation = recommendFollowUpRoute({
        kind: input.kind,
        workspacePath: sourceSession.workspacePath,
        providers,
        sourceRun: sourceRunSnapshot.run,
        preferredProviderId: input.preferredProviderId ?? null,
      });
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }

    const requestedApprovalPolicy =
      input.approvalPolicy && isApprovalPolicy(input.approvalPolicy)
        ? input.approvalPolicy
        : sourceSession.approvalPolicy;
    const approvalPolicy = await this.resolveRouteApprovalPolicy(
      recommendation.primaryProviderId,
      requestedApprovalPolicy,
    );
    if (approvalPolicy instanceof Error) {
      return approvalPolicy;
    }

    const followUpPrompt = buildFollowUpPrompt({
      kind: input.kind,
      sourceRun: sourceRunSnapshot.run,
      sourceProviderId: sourceRunSnapshot.run.providerId,
      sourceOutput: this.extractFollowUpSourceOutput(sourceRunSnapshot),
    });

    const session = await this.createOrchestratedSessionFromRecommendation(
      recommendation,
      approvalPolicy,
      {
        kind: input.kind,
        role: getFollowUpRole(input.kind),
        sourceSessionId: sourceSession.id,
        sourceRunId: sourceRunSnapshot.run.id,
        sourceProviderId: sourceRunSnapshot.run.providerId,
      },
    );
    if (session instanceof Error) {
      return session;
    }

    const runSnapshot = await this.startRun(session.id, {
      prompt: followUpPrompt,
    });
    if (!runSnapshot) {
      return new Error('Failed to create the follow-up run session.');
    }
    if (runSnapshot instanceof Error) {
      return runSnapshot;
    }

    return {
      recommendation,
      session,
      runSnapshot,
    };
  }

  private async createDelegatedRun(
    runId: string,
    input: DelegateRunRequest,
  ): Promise<DelegateRunResponse | Error | null> {
    const prompt = input.prompt.trim();
    if (!prompt) {
      return new Error('Delegated prompt is required.');
    }

    const sourceContext = this.getCompletedSourceRunContext(runId);
    if (!sourceContext || sourceContext instanceof Error) {
      return sourceContext;
    }
    const { runSnapshot: sourceRunSnapshot, session: sourceSession } = sourceContext;

    const providers = await this.listProviderHealth();
    const toolPlane = await this.buildToolPlane(
      sourceSession.workspacePath,
      sourceSession.id,
    );
    let recommendation: OrchestrationRecommendation;
    try {
      recommendation = recommendDelegatedRoute({
        prompt,
        role: input.role,
        workspacePath: sourceSession.workspacePath,
        providers,
        sourceRun: sourceRunSnapshot.run,
        preferredProviderId: input.preferredProviderId ?? null,
        requiredTools: input.requiredTools ?? [],
        toolPlane,
      });
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }

    const requestedApprovalPolicy =
      input.approvalPolicy && isApprovalPolicy(input.approvalPolicy)
        ? input.approvalPolicy
        : sourceSession.approvalPolicy;
    const approvalPolicy = await this.resolveRouteApprovalPolicy(
      recommendation.primaryProviderId,
      requestedApprovalPolicy,
    );
    if (approvalPolicy instanceof Error) {
      return approvalPolicy;
    }

    const delegatedPrompt = buildDelegatedPrompt({
      prompt,
      role: input.role,
      sourceRun: sourceRunSnapshot.run,
      sourceProviderId: sourceRunSnapshot.run.providerId,
      sourceOutput: this.extractFollowUpSourceOutput(sourceRunSnapshot),
    });

    const session = await this.createOrchestratedSessionFromRecommendation(
      recommendation,
      approvalPolicy,
      {
        kind: 'delegate',
        role: input.role,
        sourceSessionId: sourceSession.id,
        sourceRunId: sourceRunSnapshot.run.id,
        sourceProviderId: sourceRunSnapshot.run.providerId,
      },
    );
    if (session instanceof Error) {
      return session;
    }

    const runSnapshot = await this.startRun(session.id, {
      prompt: delegatedPrompt,
    });
    if (!runSnapshot) {
      return new Error('Failed to create the delegated run session.');
    }
    if (runSnapshot instanceof Error) {
      return runSnapshot;
    }

    return {
      recommendation,
      session,
      runSnapshot,
    };
  }

  private async createHandedOffRun(
    runId: string,
    input: HandoffRunRequest,
  ): Promise<HandoffRunResponse | Error | null> {
    const prompt = input.prompt.trim();
    if (!prompt) {
      return new Error('Handoff prompt is required.');
    }

    const sourceContext = this.getCompletedSourceRunContext(runId);
    if (!sourceContext || sourceContext instanceof Error) {
      return sourceContext;
    }
    const { runSnapshot: sourceRunSnapshot, session: sourceSession } = sourceContext;

    const providers = await this.listProviderHealth();
    const toolPlane = await this.buildToolPlane(
      sourceSession.workspacePath,
      sourceSession.id,
    );
    let recommendation: OrchestrationRecommendation;
    try {
      recommendation = recommendHandoffRoute({
        prompt,
        workspacePath: sourceSession.workspacePath,
        providers,
        sourceRun: sourceRunSnapshot.run,
        preferredProviderId: input.preferredProviderId ?? null,
        requiredTools: input.requiredTools ?? [],
        toolPlane,
      });
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }

    const requestedApprovalPolicy =
      input.approvalPolicy && isApprovalPolicy(input.approvalPolicy)
        ? input.approvalPolicy
        : sourceSession.approvalPolicy;
    const approvalPolicy = await this.resolveRouteApprovalPolicy(
      recommendation.primaryProviderId,
      requestedApprovalPolicy,
    );
    if (approvalPolicy instanceof Error) {
      return approvalPolicy;
    }

    const handoffPrompt = buildHandoffPrompt({
      prompt,
      sourceRun: sourceRunSnapshot.run,
      sourceProviderId: sourceRunSnapshot.run.providerId,
      sourceOutput: this.extractFollowUpSourceOutput(sourceRunSnapshot),
    });

    const session = await this.createOrchestratedSessionFromRecommendation(
      recommendation,
      approvalPolicy,
      {
        kind: 'handoff',
        role: 'main',
        sourceSessionId: sourceSession.id,
        sourceRunId: sourceRunSnapshot.run.id,
        sourceProviderId: sourceRunSnapshot.run.providerId,
      },
    );
    if (session instanceof Error) {
      return session;
    }

    const runSnapshot = await this.startRun(session.id, {
      prompt: handoffPrompt,
    });
    if (!runSnapshot) {
      return new Error('Failed to create the handed-off run session.');
    }
    if (runSnapshot instanceof Error) {
      return runSnapshot;
    }

    return {
      recommendation,
      session,
      runSnapshot,
    };
  }

  private async validateResumeSupport(providerId: string): Promise<Error | null> {
    const capabilities = await this.getProviderCapabilities(providerId);
    if (!capabilities) {
      return new Error(`Provider ${providerId} is not configured.`);
    }

    if (!capabilities.resumableSessions) {
      return new Error(
        `Provider ${providerId} does not support resumable sessions.`,
      );
    }

    return null;
  }

  private async createSession(
    input: CreateSessionRequest,
  ): Promise<WorkbenchSession | Error> {
    const requestedApprovalPolicy = input.approvalPolicy;
    const approvalPolicy =
      requestedApprovalPolicy && isApprovalPolicy(requestedApprovalPolicy)
        ? requestedApprovalPolicy
        : this.getDefaultApprovalPolicy();
    const validationError = await this.validateApprovalPolicyForProvider(
      input.providerId,
      approvalPolicy,
    );
    if (validationError) {
      return validationError;
    }

    const session: WorkbenchSession = {
      id: randomUUID(),
      workspacePath: path.resolve(input.workspacePath),
      providerId: input.providerId,
      createdAt: new Date().toISOString(),
      providerSessionId: null,
      approvalPolicy,
      recovery: null,
      orchestration: input.orchestration ?? null,
    };

    return this.stateStore.createSession(session);
  }

  private async compareRun(
    input: CompareRunRequest,
  ): Promise<CompareRunResponse | Error> {
    const prompt = input.prompt.trim();
    if (!prompt) {
      return new Error('A prompt is required for comparison.');
    }

    const providers = [...new Set(input.providers)];
    if (providers.length < 2) {
      return new Error('Choose at least two different providers to compare.');
    }

    const approvalPolicy = input.approvalPolicy ?? this.getDefaultApprovalPolicy();
    const lanes: CompareRunLane[] = [];

    for (const providerId of providers) {
      const session = await this.createSession({
        workspacePath: input.workspacePath,
        providerId,
        approvalPolicy,
      });
      if (session instanceof Error) {
        return session;
      }

      const snapshot = await this.startRun(session.id, {
        prompt,
        mode: 'execute',
      });
      if (!snapshot) {
        return new Error(`Failed to start the ${providerId} lane.`);
      }
      if (snapshot instanceof Error) {
        return snapshot;
      }

      lanes.push({
        sessionId: session.id,
        providerId,
        runSnapshot: snapshot,
      });
    }

    return { lanes } satisfies CompareRunResponse;
  }

  private async updateSessionPolicy(
    sessionId: string,
    body: UpdateSessionRequest,
  ): Promise<WorkbenchSession | Error | null> {
    const session = this.stateStore.getSession(sessionId);
    if (!session) {
      return null;
    }

    let nextApprovalPolicy = body.approvalPolicy ?? session.approvalPolicy;
    const nextProviderId = body.providerId ?? session.providerId;

    let validationError = await this.validateApprovalPolicyForProvider(
      nextProviderId,
      nextApprovalPolicy,
    );

    if (validationError && body.providerId && !body.approvalPolicy) {
      nextApprovalPolicy = 'manual';
      validationError = await this.validateApprovalPolicyForProvider(
        nextProviderId,
        nextApprovalPolicy,
      );
    }

    if (validationError) {
      return validationError;
    }

    this.stateStore.updateSession(sessionId, {
      approvalPolicy: nextApprovalPolicy,
      providerId: nextProviderId,
    });
    return this.stateStore.getSession(sessionId);
  }

  private getSessionSnapshot(sessionId: string): SessionSnapshot | null {
    const session = this.stateStore.getSession(sessionId);
    if (!session) {
      return null;
    }

    return {
      session,
      runs: this.stateStore.listRuns(sessionId),
    };
  }

  private buildOrchestrationBoard(): OrchestrationBoardSnapshot {
    const sessionSummaries = this.stateStore.listArchiveSessions();
    const summariesById = new Map(
      sessionSummaries.map((summary) => [summary.session.id, summary] as const),
    );
    const flows = new Map<string, OrchestrationFlowSessionSummary[]>();

    for (const summary of sessionSummaries) {
      const rootSessionId = this.getFlowRootSessionId(summary.session.id, summariesById);
      const flowSessions = flows.get(rootSessionId) ?? [];
      flowSessions.push({
        ...summary,
        depth: this.getFlowDepth(summary.session.id, summariesById),
        parentSessionId: summary.session.orchestration?.sourceSessionId ?? null,
      });
      flows.set(rootSessionId, flowSessions);
    }

    const flowSummaries: OrchestrationFlowSummary[] = [];

    for (const [flowId, flowSessions] of flows.entries()) {
      const rootSummary = summariesById.get(flowId);
      if (!rootSummary) {
        continue;
      }

      const orderedSessions = flowSessions.sort((left, right) => {
        if (left.depth !== right.depth) {
          return left.depth - right.depth;
        }

        return left.session.createdAt.localeCompare(right.session.createdAt);
      });

      const latestActivityAt = orderedSessions.reduce((latest, current) => {
        const candidate =
          current.latestRun?.completedAt ??
          current.latestRun?.startedAt ??
          current.latestRun?.createdAt ??
          current.session.createdAt;
        return candidate > latest ? candidate : latest;
      }, rootSummary.latestRun?.completedAt ??
        rootSummary.latestRun?.startedAt ??
        rootSummary.latestRun?.createdAt ??
        rootSummary.session.createdAt);

      flowSummaries.push({
        flowId,
        rootSession: rootSummary.session,
        rootLatestRun: rootSummary.latestRun,
        latestActivityAt,
        sessions: orderedSessions,
      });
    }

    flowSummaries.sort((left, right) =>
      right.latestActivityAt.localeCompare(left.latestActivityAt),
    );

    return {
      flows: flowSummaries,
    };
  }

  private getFlowRootSessionId(
    sessionId: string,
    summariesById: Map<string, ReturnType<SQLiteStateStore['listArchiveSessions']>[number]>,
  ): string {
    let currentSessionId = sessionId;
    const seen = new Set<string>();

    while (!seen.has(currentSessionId)) {
      seen.add(currentSessionId);
      const current = summariesById.get(currentSessionId);
      const parentSessionId = current?.session.orchestration?.sourceSessionId;
      if (!parentSessionId || !summariesById.has(parentSessionId)) {
        return currentSessionId;
      }

      currentSessionId = parentSessionId;
    }

    return sessionId;
  }

  private getFlowDepth(
    sessionId: string,
    summariesById: Map<string, ReturnType<SQLiteStateStore['listArchiveSessions']>[number]>,
  ): number {
    let depth = 0;
    let currentSessionId = sessionId;
    const seen = new Set<string>();

    while (!seen.has(currentSessionId)) {
      seen.add(currentSessionId);
      const current = summariesById.get(currentSessionId);
      const parentSessionId = current?.session.orchestration?.sourceSessionId;
      if (!parentSessionId || !summariesById.has(parentSessionId)) {
        break;
      }

      depth += 1;
      currentSessionId = parentSessionId;
    }

    return depth;
  }

  private async recoverSession(
    sessionId: string,
  ): Promise<WorkbenchSession | Error | null> {
    const session = this.stateStore.getSession(sessionId);
    if (!session) {
      return null;
    }

    const resumeError = await this.validateResumeSupport(session.providerId);
    if (resumeError) {
      return resumeError;
    }

    if (!session.providerSessionId) {
      return new Error(
        'This session does not have provider resume metadata yet.',
      );
    }

    return this.createRecoveredSession(session, session.providerSessionId);
  }

  private async recoverSessionFromCheckpoint(
    checkpointId: string,
  ): Promise<WorkbenchSession | Error | null> {
    const checkpoint = this.stateStore.getCheckpoint(checkpointId);
    if (!checkpoint) {
      return null;
    }

    const session = this.stateStore.getSession(checkpoint.sessionId);
    if (!session) {
      return null;
    }

    const resumeError = await this.validateResumeSupport(session.providerId);
    if (resumeError) {
      return resumeError;
    }

    if (!checkpoint.providerSessionId) {
      return new Error(
        'This checkpoint does not include provider resume metadata.',
      );
    }

    return this.createRecoveredSession(session, checkpoint.providerSessionId, {
      kind: 'checkpoint',
      sourceSessionId: checkpoint.sessionId,
      sourceCheckpointId: checkpoint.id,
      sourceProviderSessionId: checkpoint.providerSessionId,
      sourceRunId: checkpoint.runId,
    });
  }

  private createRecoveredSession(
    sourceSession: WorkbenchSession,
    providerSessionId: string,
    recovery: WorkbenchSession['recovery'] = {
      kind: 'session',
      sourceSessionId: sourceSession.id,
      sourceCheckpointId: null,
      sourceProviderSessionId: providerSessionId,
      sourceRunId: null,
    },
  ): WorkbenchSession {
    const recovered: WorkbenchSession = {
      id: randomUUID(),
      workspacePath: sourceSession.workspacePath,
      providerId: sourceSession.providerId,
      createdAt: new Date().toISOString(),
      providerSessionId,
      approvalPolicy: sourceSession.approvalPolicy,
      recovery,
      orchestration: null,
    };

    return this.stateStore.createSession(recovered);
  }

  private getRunSnapshot(runId: string): RunSnapshot | null {
    const run = this.stateStore.getRun(runId);
    if (!run) {
      return null;
    }

    const events = this.stateStore.listEvents(runId);
    let contextChars = 0;
    for (const event of events) {
      if (event.type === 'run.output.delta') {
        const text =
          typeof event.payload.text === 'string' ? event.payload.text : '';
        contextChars += text.length;
      } else if (event.type === 'message.created') {
        const content =
          typeof event.payload.content === 'string' ? event.payload.content : '';
        contextChars += content.length;
      } else {
        const serialized = JSON.stringify(event.payload ?? {});
        contextChars += serialized.length;
      }
    }

    const isTerminal = isTerminalRunStatus(run.status);
    const undo = {
      available: Boolean(isTerminal && run.preRunCommit),
      detail: run.preRunCommit
        ? isTerminal
          ? `Reverts tracked workspace changes to commit ${run.preRunCommit}.`
          : 'Undo becomes available when the run completes.'
        : 'Workspace is not a git repository.',
    };

    return {
      run,
      events,
      artifacts: this.stateStore.listArtifacts(runId),
      approvals: this.stateStore.listApprovals(runId),
      checkpoints: this.stateStore.listCheckpoints(runId),
      toolInvocations: this.stateStore.listToolInvocations(runId),
      contextChars,
      undo,
    };
  }

  private handleStream(runId: string, response: ServerResponse): void {
    const history = this.stateStore.listEvents(runId);

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    response.write(': connected\n\n');
    for (const event of history) {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    this.eventBroker.subscribe(runId, response);

    const heartbeat = setInterval(() => {
      response.write(': keepalive\n\n');
    }, 15000);

    response.on('close', () => {
      clearInterval(heartbeat);
      this.eventBroker.unsubscribe(runId, response);
    });
  }

  private async syncProviderConnectedTools(
    session: WorkbenchSession,
    run: WorkbenchRun,
  ): Promise<void> {
    const provider = this.providers.get(session.providerId);
    if (!provider) {
      return;
    }

    let connectedTools = [] as Awaited<
      ReturnType<ProviderAdapter['enumerateConnectedTools']>
    >;
    try {
      connectedTools = await provider.enumerateConnectedTools({
        workspacePath: session.workspacePath,
        sessionId: session.id,
        providerSessionId: session.providerSessionId,
      });
    } catch {
      return;
    }

    if (connectedTools.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    for (const tool of connectedTools) {
      const existing = this.stateStore.getSessionToolRegistrationByName(
        session.id,
        session.providerId,
        tool.name,
      );
      this.stateStore.upsertSessionToolRegistration({
        sessionId: session.id,
        providerId: session.providerId,
        toolName: tool.name,
        requirement: tool.requirement,
        source: tool.source,
        firstSeenAt: existing?.firstSeenAt ?? now,
        lastSeenAt: now,
        lastRunId: run.id,
        lastStatus: existing?.lastStatus ?? 'requested',
        metadata: {
          ...(existing?.metadata ?? {}),
          ...(tool.metadata ?? {}),
          detail: tool.detail,
          registrationKind: 'provider-enumeration',
          registeredAt: now,
        },
      });
    }
  }

  private async startRun(
    sessionId: string,
    body: StartRunRequest,
  ): Promise<RunSnapshot | Error | null> {
    const session = this.stateStore.getSession(sessionId);
    if (!session) {
      return null;
    }

    const provider = this.providers.get(session.providerId);
    if (!provider) {
      return new Error(`Provider ${session.providerId} is not configured.`);
    }

    const health = await this.getProviderHealth(session.providerId);
    if (!health) {
      return new Error(`Provider ${session.providerId} is not configured.`);
    }
    if (!health.available) {
      return new Error(
        `${provider.displayName} is not ready for runs: ${health.detail}`,
      );
    }

    const now = new Date().toISOString();
    const run: WorkbenchRun = {
      id: randomUUID(),
      sessionId: session.id,
      providerId: session.providerId,
      prompt: body.prompt,
      status: 'running',
      mode: body.mode === 'plan' ? 'plan' : 'execute',
      preRunCommit: null,
      createdAt: now,
      startedAt: now,
      completedAt: null,
      errorMessage: null,
    };

    const preRunCommit = await getGitHeadCommit(session.workspacePath);
    if (preRunCommit) {
      run.preRunCommit = preRunCommit;
    }

    this.stateStore.createRun(run);
    if (run.preRunCommit) {
      this.stateStore.setRunPreRunCommit(run.id, run.preRunCommit);
    }
    await this.syncProviderConnectedTools(session, run);
    await this.acceptEvent({
      id: randomUUID(),
      sessionId: session.id,
      runId: run.id,
      timestamp: now,
      source: 'system',
      type: 'run.started',
      payload: {
        providerId: session.providerId,
        workspacePath: session.workspacePath,
        ...(session.orchestration
          ? {
              orchestration: session.orchestration,
            }
          : {}),
      },
    });

    let handle: Awaited<ReturnType<ProviderAdapter['startRun']>>;
    try {
      handle = await provider.startRun({
        session,
        run,
        emitEvent: async (event) => {
          await this.acceptEvent(event);
        },
        updateSession: async (updates) => this.updateSession(session.id, updates),
        requestApproval: async (approval) => this.requestApproval(run, approval),
      });
    } catch (launchError) {
      const message =
        launchError instanceof Error
          ? launchError.message
          : typeof launchError === 'object' && launchError !== null &&
              'message' in launchError
            ? String(launchError.message)
            : String(launchError);
      await this.acceptEvent({
        id: randomUUID(),
        sessionId: session.id,
        runId: run.id,
        timestamp: new Date().toISOString(),
        source: 'system',
        type: 'run.failed',
        payload: {
          message: `${provider.displayName} failed to start the run.`,
          detail: message,
        },
      });
      return new Error(`${provider.displayName} failed to start the run: ${message}`);
    }

    this.runHandles.set(run.id, handle);
    return this.getRunSnapshot(run.id);
  }

  private async cancelRun(runId: string): Promise<RunSnapshot | null> {
    const run = this.stateStore.getRun(runId);
    if (!run) {
      return null;
    }

    if (isTerminalRunStatus(run.status)) {
      return this.getRunSnapshot(runId);
    }

    const handle = this.runHandles.get(runId);
    if (handle) {
      await handle.cancel();
    }

    const current = this.stateStore.getRun(runId);
    if (current && !isTerminalRunStatus(current.status)) {
      await this.acceptEvent({
        id: randomUUID(),
        sessionId: current.sessionId,
        runId,
        timestamp: new Date().toISOString(),
        source: 'system',
        type: 'run.cancelled',
        payload: {
          reason: 'Cancelled by user.',
        },
      });
    }

    return this.getRunSnapshot(runId);
  }

  private async undoRun(
    runId: string,
  ): Promise<UndoRunResponse | Error | null> {
    const run = this.stateStore.getRun(runId);
    if (!run) {
      return null;
    }

    if (!isTerminalRunStatus(run.status)) {
      return new Error('Undo is only available after the run completes.');
    }

    if (!run.preRunCommit) {
      return new Error(
        'Undo is unavailable because the workspace is not a git repository.',
      );
    }

    const session = this.stateStore.getSession(run.sessionId);
    if (!session) {
      return new Error('Session for the run was not found.');
    }

    const result = await gitResetToCommit(session.workspacePath, run.preRunCommit);
    if (!result.ok) {
      return new Error(result.detail);
    }

    await this.acceptEvent({
      id: randomUUID(),
      sessionId: run.sessionId,
      runId,
      timestamp: new Date().toISOString(),
      source: 'system',
      type: 'run.undo',
      payload: {
        targetCommit: run.preRunCommit,
        detail: result.detail,
      },
    });

    return {
      run: this.stateStore.getRun(runId)!,
      detail: result.detail,
    } satisfies UndoRunResponse;
  }

  private async requestApproval(
    run: WorkbenchRun,
    request: ProviderApprovalRequest,
  ): Promise<ProviderApprovalDecision> {
    const approval: ApprovalRecord = {
      id: randomUUID(),
      sessionId: run.sessionId,
      runId: run.id,
      toolName: request.toolName,
      toolUseId: request.toolUseId,
      status: 'requested',
      reason: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      payload: {
        input: request.input,
        metadata: request.metadata,
      },
    };

    this.stateStore.createApproval(approval);

    await this.acceptEvent({
      id: randomUUID(),
      sessionId: approval.sessionId,
      runId: approval.runId,
      timestamp: approval.createdAt,
      source: 'system',
      type: 'approval.requested',
      payload: {
        approvalId: approval.id,
        toolName: approval.toolName,
        toolUseId: approval.toolUseId,
        input: request.input,
        metadata: request.metadata,
      },
    });

    const session = this.stateStore.getSession(run.sessionId);
    const approvalPolicy = session?.approvalPolicy ?? this.getDefaultApprovalPolicy();

    if (run.mode === 'plan') {
      return this.finalizeApproval(approval.id, {
        decision: 'denied',
        reason: 'Plan mode is read-only; tool execution was blocked.',
      });
    }

    if (approvalPolicy === 'allow') {
      return this.finalizeApproval(approval.id, {
        decision: 'approved',
        reason: 'Auto-approved by the session approval policy.',
      });
    }

    if (approvalPolicy === 'deny') {
      return this.finalizeApproval(approval.id, {
        decision: 'denied',
        reason: 'Auto-denied by the session approval policy.',
      });
    }

    return new Promise<ProviderApprovalDecision>((resolve) => {
      this.pendingApprovals.set(approval.id, {
        approvalId: approval.id,
        runId: approval.runId,
        resolve,
      });
    });
  }

  private async updateSession(
    sessionId: string,
    updates: ProviderSessionUpdate,
  ): Promise<void> {
    this.stateStore.updateSession(sessionId, {
      providerSessionId: updates.providerSessionId,
    });
  }

  private getDefaultApprovalPolicy(): ApprovalPolicy {
    const policy = (process.env.QWEMINI_APPROVAL_POLICY ?? 'manual').toLowerCase();
    return isApprovalPolicy(policy) ? policy : 'manual';
  }

  private async resolveApproval(
    approvalId: string,
    body: ResolveApprovalRequest,
  ): Promise<ApprovalRecord | null> {
    const approval = this.stateStore.getApproval(approvalId);
    if (!approval) {
      return null;
    }

    await this.finalizeApproval(approvalId, body);
    return this.stateStore.getApproval(approvalId);
  }

  private async finalizeApproval(
    approvalId: string,
    body: ResolveApprovalRequest,
  ): Promise<ProviderApprovalDecision> {
    const approval = this.stateStore.getApproval(approvalId);
    if (!approval) {
      throw new Error(`Approval ${approvalId} was not found.`);
    }

    if (approval.status !== 'requested') {
      return approval.status === 'approved'
        ? { behavior: 'allow' }
        : {
            behavior: 'deny',
            message: approval.reason ?? 'Approval was denied.',
          };
    }

    const resolvedAt = new Date().toISOString();
    this.stateStore.updateApprovalStatus(approval.id, body.decision, {
      reason: body.reason ?? null,
      resolvedAt,
    });

    await this.acceptEvent({
      id: randomUUID(),
      sessionId: approval.sessionId,
      runId: approval.runId,
      timestamp: resolvedAt,
      source: 'system',
      type: 'approval.resolved',
      payload: {
        approvalId: approval.id,
        toolName: approval.toolName,
        toolUseId: approval.toolUseId,
        decision: body.decision,
        reason: body.reason ?? null,
      },
    });

    const pending = this.pendingApprovals.get(approval.id);
    const decision: ProviderApprovalDecision =
      body.decision === 'approved'
        ? { behavior: 'allow' }
        : {
            behavior: 'deny',
            message: body.reason ?? 'Tool execution denied in Qwemini.',
          };

    if (pending) {
      pending.resolve(decision);
      this.pendingApprovals.delete(approval.id);
    }

    return decision;
  }

  private async denyPendingApprovalsForRun(
    runId: string,
    reason: string,
  ): Promise<void> {
    const pending = [...this.pendingApprovals.values()].filter(
      (approval) => approval.runId === runId,
    );

    for (const approval of pending) {
      await this.finalizeApproval(approval.approvalId, {
        decision: 'denied',
        reason,
      });
    }
  }

  private async capturePlanArtifact(runId: string): Promise<void> {
    const messages = this.stateStore
      .listEvents(runId)
      .filter((event) => event.type === 'message.created')
      .map((event) => ({
        role: typeof event.payload.role === 'string' ? event.payload.role : '',
        content:
          typeof event.payload.content === 'string' ? event.payload.content.trim() : '',
      }));

    const planContent = messages
      .filter((message) => message.role === 'assistant' && message.content)
      .at(-1)?.content;

    if (!planContent) {
      return;
    }

    const run = this.stateStore.getRun(runId);
    if (!run) {
      return;
    }

    const artifact: ArtifactRecord = {
      id: randomUUID(),
      sessionId: run.sessionId,
      runId,
      kind: 'plan',
      title: 'Plan',
      createdAt: new Date().toISOString(),
      content: planContent,
      metadata: {
        sourceRunId: runId,
        prompt: run.prompt,
      },
    };

    this.stateStore.createArtifact(artifact);
    await this.acceptEvent({
      id: randomUUID(),
      sessionId: artifact.sessionId,
      runId: artifact.runId,
      timestamp: artifact.createdAt,
      source: 'system',
      type: 'artifact.created',
      payload: {
        artifactId: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
      },
    });
  }

  private syncRunStatusFromApprovals(runId: string): void {
    const run = this.stateStore.getRun(runId);
    if (!run || isTerminalRunStatus(run.status)) {
      return;
    }

    const hasPendingApprovals = this.stateStore
      .listApprovals(runId)
      .some((approval) => approval.status === 'requested');

    this.stateStore.updateRunStatus(
      runId,
      hasPendingApprovals ? 'awaiting_approval' : 'running',
      {
        errorMessage: null,
      },
    );
  }

  private syncToolInvocationFromEvent(
    event: WorkbenchEvent,
  ): ToolInvocationRecord | null {
    if (
      event.type !== 'tool.requested' &&
      event.type !== 'tool.started' &&
      event.type !== 'tool.completed' &&
      event.type !== 'tool.denied'
    ) {
      return null;
    }

    const toolUseId =
      typeof event.payload.toolUseId === 'string' ? event.payload.toolUseId : null;
    const existing =
      toolUseId !== null
        ? this.stateStore.getToolInvocationByUseId(event.runId, toolUseId)
        : null;

    const toolName =
      typeof event.payload.toolName === 'string'
        ? event.payload.toolName
        : existing?.toolName ?? 'unknown';
    const input =
      event.payload.input && typeof event.payload.input === 'object'
        ? (event.payload.input as Record<string, unknown>)
        : existing?.input ?? {};
    const detail =
      typeof event.payload.detail === 'string'
        ? event.payload.detail
        : existing?.detail ?? null;

    let status: ToolInvocationRecord['status'];
    let output = existing?.output ?? null;
    let metadata = { ...(existing?.metadata ?? {}) };

    if (event.type === 'tool.requested') {
      status = 'requested';
      const providerMetadata =
        event.payload.metadata && typeof event.payload.metadata === 'object'
          ? (event.payload.metadata as Record<string, unknown>)
          : {};
      metadata = {
        ...metadata,
        ...providerMetadata,
      };
    } else if (event.type === 'tool.started') {
      status = 'started';
      const progress =
        event.payload.progress && typeof event.payload.progress === 'object'
          ? (event.payload.progress as Record<string, unknown>)
          : {};
      metadata = {
        ...metadata,
        ...progress,
      };
    } else if (event.type === 'tool.completed') {
      status = 'completed';
      output = event.payload.output ?? null;
      metadata = {
        ...metadata,
        ...(typeof event.payload.isError === 'boolean'
          ? { isError: event.payload.isError }
          : {}),
      };
    } else {
      status = 'denied';
      metadata = {
        ...metadata,
        denied: true,
      };
    }

    if (!existing) {
      const created = this.stateStore.createToolInvocation({
        id: randomUUID(),
        sessionId: event.sessionId,
        runId: event.runId,
        toolUseId,
        toolName,
        status,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        input,
        output,
        detail,
        metadata,
      });
      return created;
    }

    this.stateStore.updateToolInvocation(existing.id, {
      toolName,
      status,
      updatedAt: event.timestamp,
      input,
      output,
      detail,
      metadata,
    });

    return {
      ...existing,
      toolName,
      status,
      updatedAt: event.timestamp,
      input,
      output,
      detail,
      metadata,
    };
  }

  private syncSessionToolRegistrationFromRegisteredEvent(
    event: WorkbenchEvent,
  ): void {
    if (event.type !== 'tool.registered') {
      return;
    }

    const run = this.stateStore.getRun(event.runId);
    if (!run) {
      return;
    }

    const toolName =
      typeof event.payload.toolName === 'string' ? event.payload.toolName.trim() : '';
    if (!toolName) {
      return;
    }

    const detail =
      typeof event.payload.detail === 'string' ? event.payload.detail : null;
    const metadata =
      event.payload.metadata && typeof event.payload.metadata === 'object'
        ? ({
            ...(event.payload.metadata as Record<string, unknown>),
          } as Record<string, unknown>)
        : {};
    const input =
      event.payload.input && typeof event.payload.input === 'object'
        ? (event.payload.input as Record<string, unknown>)
        : {};

    const requirement = isRoutingToolRequirement(event.payload.requirement)
      ? event.payload.requirement
      : inferToolRequirement(toolName, detail, input, metadata);
    if (!requirement) {
      return;
    }

    const source = isToolDescriptorSource(event.payload.source)
      ? event.payload.source
      : inferToolSource(requirement, metadata);

    const existing = this.stateStore.getSessionToolRegistrationByName(
      event.sessionId,
      run.providerId,
      toolName,
    );

    this.stateStore.upsertSessionToolRegistration({
      sessionId: event.sessionId,
      providerId: run.providerId,
      toolName,
      requirement,
      source,
      firstSeenAt: existing?.firstSeenAt ?? event.timestamp,
      lastSeenAt: event.timestamp,
      lastRunId: event.runId,
      lastStatus: existing?.lastStatus ?? 'requested',
      metadata: {
        ...(existing?.metadata ?? {}),
        ...metadata,
        ...(detail ? { detail } : {}),
        registrationKind: 'provider-enumeration',
        confirmedBy:
          typeof metadata.confirmedBy === 'string'
            ? metadata.confirmedBy
            : 'provider-runtime',
        registeredAt: event.timestamp,
      },
    });
  }

  private syncSessionToolRegistrationFromEvent(
    event: WorkbenchEvent,
    invocation: ToolInvocationRecord | null,
  ): void {
    if (!invocation) {
      return;
    }

    const run = this.stateStore.getRun(event.runId);
    if (!run) {
      return;
    }

    const requirement = inferToolRequirement(
      invocation.toolName,
      invocation.detail,
      invocation.input,
      invocation.metadata,
    );
    if (!requirement) {
      return;
    }

    const source = inferToolSource(requirement, invocation.metadata);
    const existing = this.stateStore.getSessionToolRegistrationByName(
      event.sessionId,
      run.providerId,
      invocation.toolName,
    );

    this.stateStore.upsertSessionToolRegistration({
      sessionId: event.sessionId,
      providerId: run.providerId,
      toolName: invocation.toolName,
      requirement,
      source,
      firstSeenAt: existing?.firstSeenAt ?? event.timestamp,
      lastSeenAt: event.timestamp,
      lastRunId: event.runId,
      lastStatus: invocation.status,
      metadata: {
        ...invocation.metadata,
        ...(invocation.toolUseId ? { toolUseId: invocation.toolUseId } : {}),
        ...(invocation.detail ? { detail: invocation.detail } : {}),
        registrationKind:
          existing?.metadata?.registrationKind === 'provider-enumeration'
            ? 'provider-enumeration'
            : 'event-observed',
      },
    });
  }

  private async acceptEvent(event: WorkbenchEvent): Promise<void> {
    const currentRun = this.stateStore.getRun(event.runId);
    if (
      currentRun &&
      isTerminalRunStatus(currentRun.status) &&
      (event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled')
    ) {
      return;
    }

    this.stateStore.appendEvent(event);
    this.syncSessionToolRegistrationFromRegisteredEvent(event);
    const invocation = this.syncToolInvocationFromEvent(event);
    this.syncSessionToolRegistrationFromEvent(event, invocation);
    this.eventBroker.publish(event);

    if (event.type === 'checkpoint.saved') {
      const session = this.stateStore.getSession(event.sessionId);
      const run = this.stateStore.getRun(event.runId);

      if (session && run) {
        const pendingApprovals = this.stateStore
          .listApprovals(event.runId)
          .filter((approval) => approval.status === 'requested')
          .map((approval) => approval.id);
        const recentArtifacts = this.stateStore
          .listArtifacts(event.runId)
          .slice(-3)
          .map((artifact) => artifact.id);

        const checkpoint: CheckpointRecord = {
          id: randomUUID(),
          sessionId: event.sessionId,
          runId: event.runId,
          providerSessionId: session.providerSessionId,
          createdAt: event.timestamp,
          title:
            typeof event.payload.detail === 'string'
              ? event.payload.detail
              : 'provider-checkpoint',
          metadata: {
            providerId: run.providerId,
            runStatus: run.status,
            eventId: event.id,
            eventPayload: event.payload,
            pendingApprovalIds: pendingApprovals,
            recentArtifactIds: recentArtifacts,
          },
        };

        this.stateStore.createCheckpoint(checkpoint);
      }
    }

    if (event.type === 'message.created') {
      const role = typeof event.payload.role === 'string' ? event.payload.role : '';
      const content =
        typeof event.payload.content === 'string' ? event.payload.content.trim() : '';

      if (role === 'assistant' && content) {
        const artifact: ArtifactRecord = {
          id: randomUUID(),
          sessionId: event.sessionId,
          runId: event.runId,
          kind: 'text',
          title: 'Assistant message',
          createdAt: new Date().toISOString(),
          content,
          metadata: {
            role,
          },
        };

        this.stateStore.createArtifact(artifact);

        const artifactEvent: WorkbenchEvent = {
          id: randomUUID(),
          sessionId: artifact.sessionId,
          runId: artifact.runId,
          timestamp: artifact.createdAt,
          source: 'system',
          type: 'artifact.created',
          payload: {
            artifactId: artifact.id,
            kind: artifact.kind,
            title: artifact.title,
          },
        };

        this.stateStore.appendEvent(artifactEvent);
        this.eventBroker.publish(artifactEvent);
      }
    }

    if (event.type === 'run.completed') {
      const current = this.stateStore.getRun(event.runId);
      if (current?.status === 'cancelled') {
        this.runHandles.delete(event.runId);
        return;
      }

      this.stateStore.updateRunStatus(event.runId, 'completed', {
        completedAt: event.timestamp,
        errorMessage: null,
      });
      await this.denyPendingApprovalsForRun(
        event.runId,
        'Run completed before the approval was resolved.',
      );
      if (current?.mode === 'plan') {
        await this.capturePlanArtifact(event.runId);
      }
      this.runHandles.delete(event.runId);
    }

    if (event.type === 'run.failed') {
      const current = this.stateStore.getRun(event.runId);
      if (current?.status === 'cancelled') {
        this.runHandles.delete(event.runId);
        return;
      }

      this.stateStore.updateRunStatus(event.runId, 'failed', {
        completedAt: event.timestamp,
        errorMessage:
          typeof event.payload.message === 'string'
            ? event.payload.message
            : 'Run failed',
      });
      await this.denyPendingApprovalsForRun(
        event.runId,
        'Run failed before the approval was resolved.',
      );
      this.runHandles.delete(event.runId);
    }

    if (event.type === 'run.cancelled') {
      const current = this.stateStore.getRun(event.runId);
      if (!current || isTerminalRunStatus(current.status)) {
        this.runHandles.delete(event.runId);
        return;
      }

      this.stateStore.updateRunStatus(event.runId, 'cancelled', {
        completedAt: event.timestamp,
        errorMessage:
          typeof event.payload.reason === 'string' ? event.payload.reason : null,
      });
      await this.denyPendingApprovalsForRun(
        event.runId,
        'Run was cancelled before the approval was resolved.',
      );
      this.runHandles.delete(event.runId);
    }

    if (event.type === 'approval.requested' || event.type === 'approval.resolved') {
      this.syncRunStatusFromApprovals(event.runId);
    }
  }
}
