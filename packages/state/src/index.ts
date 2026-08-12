import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type ArchiveSessionSummary,
  type ApprovalPolicy,
  type ApprovalRecord,
  type ArtifactRecord,
  type CheckpointRecord,
  type ProviderId,
  type RunStatus,
  type SessionToolRegistration,
  type SessionOrchestrationMetadata,
  type SessionRecoveryMetadata,
  type ToolInvocationRecord,
  type ToolInvocationStatus,
  type WorkbenchEvent,
  type WorkbenchRun,
  type WorkbenchSession,
} from '@qwemini/protocol';

function parseJson<T>(value: string | null): T {
  if (!value) {
    return {} as T;
  }

  return JSON.parse(value) as T;
}

function parseNullableJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as T;
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export function resolveDataDirectory(rootPath: string): string {
  return path.join(rootPath, '.qwemini');
}

export class SQLiteStateStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        provider_session_id TEXT,
        approval_policy TEXT NOT NULL DEFAULT 'manual',
        recovery_kind TEXT,
        source_session_id TEXT,
        source_checkpoint_id TEXT,
        source_provider_session_id TEXT,
        source_run_id TEXT,
        orchestration_kind TEXT,
        orchestration_role TEXT,
        orchestration_source_session_id TEXT,
        orchestration_source_run_id TEXT,
        orchestration_source_provider_id TEXT
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'execute',
        pre_run_commit TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        tool_use_id TEXT,
        status TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        provider_session_id TEXT,
        created_at TEXT NOT NULL,
        title TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_invocations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        tool_use_id TEXT,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT,
        detail TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS session_tool_registry (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        requirement TEXT NOT NULL,
        source TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        last_status TEXT NOT NULL,
        seen_count INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(session_id, provider_id, tool_name)
      );
    `);

    this.ensureColumn('sessions', 'provider_session_id', 'TEXT');
    this.ensureColumn(
      'sessions',
      'approval_policy',
      "TEXT NOT NULL DEFAULT 'manual'",
    );
    this.ensureColumn('sessions', 'recovery_kind', 'TEXT');
    this.ensureColumn('sessions', 'source_session_id', 'TEXT');
    this.ensureColumn('sessions', 'source_checkpoint_id', 'TEXT');
    this.ensureColumn('sessions', 'source_provider_session_id', 'TEXT');
    this.ensureColumn('sessions', 'source_run_id', 'TEXT');
    this.ensureColumn('sessions', 'orchestration_kind', 'TEXT');
    this.ensureColumn('sessions', 'orchestration_role', 'TEXT');
    this.ensureColumn('sessions', 'orchestration_source_session_id', 'TEXT');
    this.ensureColumn('sessions', 'orchestration_source_run_id', 'TEXT');
    this.ensureColumn('sessions', 'orchestration_source_provider_id', 'TEXT');
    this.ensureColumn('runs', 'mode', "TEXT NOT NULL DEFAULT 'execute'");
    this.ensureColumn('runs', 'pre_run_commit', 'TEXT');
    this.ensureColumn('approvals', 'tool_use_id', 'TEXT');
    this.ensureColumn(
      'approvals',
      'payload_json',
      "TEXT NOT NULL DEFAULT '{}'",
    );
    this.ensureColumn('tool_invocations', 'tool_use_id', 'TEXT');
    this.ensureColumn('tool_invocations', 'input_json', "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn('tool_invocations', 'output_json', 'TEXT');
    this.ensureColumn('tool_invocations', 'detail', 'TEXT');
    this.ensureColumn(
      'tool_invocations',
      'metadata_json',
      "TEXT NOT NULL DEFAULT '{}'",
    );
    this.ensureColumn(
      'session_tool_registry',
      'metadata_json',
      "TEXT NOT NULL DEFAULT '{}'",
    );
  }

  private ensureColumn(
    tableName: string,
    columnName: string,
    definition: string,
  ): void {
    const columns = this.database
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<Record<string, unknown>>;

    const hasColumn = columns.some((column) => column.name === columnName);
    if (!hasColumn) {
      this.database.exec(
        `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
      );
    }
  }

  private mapSessionRow(row: Record<string, unknown>): WorkbenchSession {
    return {
      id: String(row.id),
      workspacePath: String(row.workspace_path),
      providerId: String(row.provider_id) as ProviderId,
      createdAt: String(row.created_at),
      providerSessionId: row.provider_session_id
        ? String(row.provider_session_id)
        : null,
      approvalPolicy: String(row.approval_policy) as ApprovalPolicy,
      recovery:
        row.recovery_kind && row.source_session_id
          ? {
              kind: String(row.recovery_kind) as SessionRecoveryMetadata['kind'],
              sourceSessionId: String(row.source_session_id),
              sourceCheckpointId: row.source_checkpoint_id
                ? String(row.source_checkpoint_id)
                : null,
              sourceProviderSessionId: row.source_provider_session_id
                ? String(row.source_provider_session_id)
                : null,
              sourceRunId: row.source_run_id ? String(row.source_run_id) : null,
            }
          : null,
      orchestration:
        row.orchestration_kind && row.orchestration_role
          ? {
              kind: String(row.orchestration_kind) as SessionOrchestrationMetadata['kind'],
              role: String(row.orchestration_role) as SessionOrchestrationMetadata['role'],
              sourceSessionId: row.orchestration_source_session_id
                ? String(row.orchestration_source_session_id)
                : null,
              sourceRunId: row.orchestration_source_run_id
                ? String(row.orchestration_source_run_id)
                : null,
              sourceProviderId: row.orchestration_source_provider_id
                ? (String(row.orchestration_source_provider_id) as ProviderId)
                : null,
            }
          : null,
    };
  }

  createSession(session: WorkbenchSession): WorkbenchSession {
    this.database
      .prepare(
        `
          INSERT INTO sessions (
            id,
            workspace_path,
            provider_id,
            created_at,
            provider_session_id,
            approval_policy,
            recovery_kind,
            source_session_id,
            source_checkpoint_id,
            source_provider_session_id,
            source_run_id,
            orchestration_kind,
            orchestration_role,
            orchestration_source_session_id,
            orchestration_source_run_id,
            orchestration_source_provider_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        session.id,
        session.workspacePath,
        session.providerId,
        session.createdAt,
        session.providerSessionId,
        session.approvalPolicy,
        session.recovery?.kind ?? null,
        session.recovery?.sourceSessionId ?? null,
        session.recovery?.sourceCheckpointId ?? null,
        session.recovery?.sourceProviderSessionId ?? null,
        session.recovery?.sourceRunId ?? null,
        session.orchestration?.kind ?? null,
        session.orchestration?.role ?? null,
        session.orchestration?.sourceSessionId ?? null,
        session.orchestration?.sourceRunId ?? null,
        session.orchestration?.sourceProviderId ?? null,
      );

    return session;
  }

  listSessions(): WorkbenchSession[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            workspace_path,
            provider_id,
            created_at,
            provider_session_id,
            approval_policy,
            recovery_kind,
            source_session_id,
            source_checkpoint_id,
            source_provider_session_id,
            source_run_id,
            orchestration_kind,
            orchestration_role,
            orchestration_source_session_id,
            orchestration_source_run_id,
            orchestration_source_provider_id
          FROM sessions
          ORDER BY created_at DESC
        `,
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => this.mapSessionRow(row));
  }

  listArchiveSessions(): ArchiveSessionSummary[] {
    return this.listSessions().map((session) => {
      const runs = this.listRuns(session.id);
      return {
        session,
        runCount: runs.length,
        completedRunCount: runs.filter((run) => run.status === 'completed').length,
        failedRunCount: runs.filter((run) => run.status === 'failed').length,
        latestRun: runs[0] ?? null,
      };
    });
  }

  getSession(sessionId: string): WorkbenchSession | null {
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            workspace_path,
            provider_id,
            created_at,
            provider_session_id,
            approval_policy,
            recovery_kind,
            source_session_id,
            source_checkpoint_id,
            source_provider_session_id,
            source_run_id,
            orchestration_kind,
            orchestration_role,
            orchestration_source_session_id,
            orchestration_source_run_id,
            orchestration_source_provider_id
          FROM sessions
          WHERE id = ?
        `,
      )
      .get(sessionId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.mapSessionRow(row);
  }

  deleteSession(sessionId: string): boolean {
    const result = this.database
      .prepare(
        `
          DELETE FROM sessions
          WHERE id = ?
        `,
      )
      .run(sessionId);

    return Number(result.changes ?? 0) > 0;
  }

  updateSession(
    sessionId: string,
    updates: {
      providerSessionId?: string | null;
      approvalPolicy?: ApprovalPolicy;
      providerId?: ProviderId;
    } = {},
  ): void {
    const current = this.getSession(sessionId);
    if (!current) {
      return;
    }

    this.database
      .prepare(
        `
          UPDATE sessions
          SET
            provider_session_id = ?,
            approval_policy = ?,
            provider_id = ?
          WHERE id = ?
        `,
      )
      .run(
        updates.providerSessionId ?? current.providerSessionId,
        updates.approvalPolicy ?? current.approvalPolicy,
        updates.providerId ?? current.providerId,
        sessionId,
      );
  }

  createRun(run: WorkbenchRun): WorkbenchRun {
    this.database
      .prepare(
        `
          INSERT INTO runs (
            id,
            session_id,
            provider_id,
            prompt,
            status,
            mode,
            pre_run_commit,
            created_at,
            started_at,
            completed_at,
            error_message
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        run.id,
        run.sessionId,
        run.providerId,
        run.prompt,
        run.status,
        run.mode,
        run.preRunCommit ?? null,
        run.createdAt,
        run.startedAt,
        run.completedAt,
        run.errorMessage,
      );

    return run;
  }

  listRuns(sessionId: string): WorkbenchRun[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, session_id, provider_id, prompt, status, mode, pre_run_commit, created_at, started_at, completed_at, error_message
          FROM runs
          WHERE session_id = ?
          ORDER BY created_at DESC
        `,
      )
      .all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((row) => this.mapRunRow(row));
  }

  getRun(runId: string): WorkbenchRun | null {
    const row = this.database
      .prepare(
        `
          SELECT id, session_id, provider_id, prompt, status, mode, pre_run_commit, created_at, started_at, completed_at, error_message
          FROM runs
          WHERE id = ?
        `,
      )
      .get(runId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return this.mapRunRow(row);
  }

  setRunPreRunCommit(runId: string, preRunCommit: string | null): void {
    this.database
      .prepare(
        `
          UPDATE runs
          SET pre_run_commit = ?
          WHERE id = ?
        `,
      )
      .run(preRunCommit, runId);
  }

  private mapRunRow(row: Record<string, unknown>): WorkbenchRun {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      providerId: String(row.provider_id) as ProviderId,
      prompt: String(row.prompt),
      status: String(row.status) as RunStatus,
      mode: row.mode === 'plan' ? 'plan' : 'execute',
      preRunCommit: row.pre_run_commit ? String(row.pre_run_commit) : null,
      createdAt: String(row.created_at),
      startedAt: row.started_at ? String(row.started_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
      errorMessage: row.error_message ? String(row.error_message) : null,
    };
  }

  updateRunStatus(
    runId: string,
    status: RunStatus,
    updates: {
      startedAt?: string | null;
      completedAt?: string | null;
      errorMessage?: string | null;
    } = {},
  ): void {
    this.database
      .prepare(
        `
          UPDATE runs
          SET
            status = ?,
            started_at = COALESCE(?, started_at),
            completed_at = COALESCE(?, completed_at),
            error_message = ?
          WHERE id = ?
        `,
      )
      .run(
        status,
        updates.startedAt ?? null,
        updates.completedAt ?? null,
        updates.errorMessage ?? null,
        runId,
      );
  }

  appendEvent(event: WorkbenchEvent): WorkbenchEvent {
    this.database
      .prepare(
        `
          INSERT INTO events (id, session_id, run_id, timestamp, source, type, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        event.id,
        event.sessionId,
        event.runId,
        event.timestamp,
        event.source,
        event.type,
        toJson(event.payload),
      );

    return event;
  }

  listEvents(runId: string): WorkbenchEvent[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, session_id, run_id, timestamp, source, type, payload_json
          FROM events
          WHERE run_id = ?
          ORDER BY timestamp ASC, id ASC
        `,
      )
      .all(runId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      timestamp: String(row.timestamp),
      source: String(row.source) as WorkbenchEvent['source'],
      type: String(row.type) as WorkbenchEvent['type'],
      payload: parseJson<Record<string, unknown>>(String(row.payload_json)),
    }));
  }

  createToolInvocation(invocation: ToolInvocationRecord): ToolInvocationRecord {
    this.database
      .prepare(
        `
          INSERT INTO tool_invocations (
            id,
            session_id,
            run_id,
            tool_use_id,
            tool_name,
            status,
            created_at,
            updated_at,
            input_json,
            output_json,
            detail,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        invocation.id,
        invocation.sessionId,
        invocation.runId,
        invocation.toolUseId,
        invocation.toolName,
        invocation.status,
        invocation.createdAt,
        invocation.updatedAt,
        toJson(invocation.input),
        invocation.output === null ? null : JSON.stringify(invocation.output),
        invocation.detail,
        toJson(invocation.metadata),
      );

    return invocation;
  }

  getToolInvocationByUseId(
    runId: string,
    toolUseId: string,
  ): ToolInvocationRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            session_id,
            run_id,
            tool_use_id,
            tool_name,
            status,
            created_at,
            updated_at,
            input_json,
            output_json,
            detail,
            metadata_json
          FROM tool_invocations
          WHERE run_id = ? AND tool_use_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `,
      )
      .get(runId, toolUseId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      toolUseId: row.tool_use_id ? String(row.tool_use_id) : null,
      toolName: String(row.tool_name),
      status: String(row.status) as ToolInvocationStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      input: parseJson<Record<string, unknown>>(String(row.input_json)),
      output: parseNullableJson<unknown>(
        row.output_json ? String(row.output_json) : null,
      ),
      detail: row.detail ? String(row.detail) : null,
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)),
    };
  }

  updateToolInvocation(
    invocationId: string,
    updates: {
      toolName?: string;
      status?: ToolInvocationStatus;
      updatedAt?: string;
      input?: Record<string, unknown>;
      output?: unknown;
      detail?: string | null;
      metadata?: Record<string, unknown>;
    } = {},
  ): void {
    const current = this.getToolInvocation(invocationId);
    if (!current) {
      return;
    }

    this.database
      .prepare(
        `
          UPDATE tool_invocations
          SET
            tool_name = ?,
            status = ?,
            updated_at = ?,
            input_json = ?,
            output_json = ?,
            detail = ?,
            metadata_json = ?
          WHERE id = ?
        `,
      )
      .run(
        updates.toolName ?? current.toolName,
        updates.status ?? current.status,
        updates.updatedAt ?? current.updatedAt,
        toJson(updates.input ?? current.input),
        JSON.stringify(updates.output === undefined ? current.output : updates.output),
        updates.detail === undefined ? current.detail : updates.detail,
        toJson(updates.metadata ?? current.metadata),
        invocationId,
      );
  }

  getToolInvocation(invocationId: string): ToolInvocationRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            session_id,
            run_id,
            tool_use_id,
            tool_name,
            status,
            created_at,
            updated_at,
            input_json,
            output_json,
            detail,
            metadata_json
          FROM tool_invocations
          WHERE id = ?
        `,
      )
      .get(invocationId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      toolUseId: row.tool_use_id ? String(row.tool_use_id) : null,
      toolName: String(row.tool_name),
      status: String(row.status) as ToolInvocationStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      input: parseJson<Record<string, unknown>>(String(row.input_json)),
      output: parseNullableJson<unknown>(
        row.output_json ? String(row.output_json) : null,
      ),
      detail: row.detail ? String(row.detail) : null,
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)),
    };
  }

  listToolInvocations(runId: string): ToolInvocationRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            session_id,
            run_id,
            tool_use_id,
            tool_name,
            status,
            created_at,
            updated_at,
            input_json,
            output_json,
            detail,
            metadata_json
          FROM tool_invocations
          WHERE run_id = ?
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all(runId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      toolUseId: row.tool_use_id ? String(row.tool_use_id) : null,
      toolName: String(row.tool_name),
      status: String(row.status) as ToolInvocationStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      input: parseJson<Record<string, unknown>>(String(row.input_json)),
      output: parseNullableJson<unknown>(
        row.output_json ? String(row.output_json) : null,
      ),
      detail: row.detail ? String(row.detail) : null,
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)),
    }));
  }

  listRecentToolInvocations(limit = 50): ToolInvocationRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            session_id,
            run_id,
            tool_use_id,
            tool_name,
            status,
            created_at,
            updated_at,
            input_json,
            output_json,
            detail,
            metadata_json
          FROM tool_invocations
          ORDER BY updated_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      toolUseId: row.tool_use_id ? String(row.tool_use_id) : null,
      toolName: String(row.tool_name),
      status: String(row.status) as ToolInvocationStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      input: parseJson<Record<string, unknown>>(String(row.input_json)),
      output: parseNullableJson<unknown>(
        row.output_json ? String(row.output_json) : null,
      ),
      detail: row.detail ? String(row.detail) : null,
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)),
    }));
  }

  listRecentToolInvocationsForSession(
    sessionId: string,
    limit = 50,
  ): ToolInvocationRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            session_id,
            run_id,
            tool_use_id,
            tool_name,
            status,
            created_at,
            updated_at,
            input_json,
            output_json,
            detail,
            metadata_json
          FROM tool_invocations
          WHERE session_id = ?
          ORDER BY updated_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(sessionId, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      toolUseId: row.tool_use_id ? String(row.tool_use_id) : null,
      toolName: String(row.tool_name),
      status: String(row.status) as ToolInvocationStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      input: parseJson<Record<string, unknown>>(String(row.input_json)),
      output: parseNullableJson<unknown>(
        row.output_json ? String(row.output_json) : null,
      ),
      detail: row.detail ? String(row.detail) : null,
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)),
    }));
  }

  getSessionToolRegistrationByName(
    sessionId: string,
    providerId: ProviderId,
    toolName: string,
  ): SessionToolRegistration | null {
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            session_id,
            provider_id,
            tool_name,
            requirement,
            source,
            first_seen_at,
            last_seen_at,
            last_run_id,
            last_status,
            seen_count,
            metadata_json
          FROM session_tool_registry
          WHERE session_id = ? AND provider_id = ? AND tool_name = ?
          LIMIT 1
        `,
      )
      .get(sessionId, providerId, toolName) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      providerId: String(row.provider_id) as ProviderId,
      toolName: String(row.tool_name),
      requirement: String(row.requirement) as SessionToolRegistration['requirement'],
      source: String(row.source) as SessionToolRegistration['source'],
      firstSeenAt: String(row.first_seen_at),
      lastSeenAt: String(row.last_seen_at),
      lastRunId: String(row.last_run_id),
      lastStatus: String(row.last_status) as SessionToolRegistration['lastStatus'],
      seenCount: Number(row.seen_count),
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)),
    };
  }

  upsertSessionToolRegistration(
    registration: Omit<SessionToolRegistration, 'id' | 'seenCount'>,
  ): void {
    const existing = this.getSessionToolRegistrationByName(
      registration.sessionId,
      registration.providerId,
      registration.toolName,
    );

    if (!existing) {
      this.database
        .prepare(
          `
            INSERT INTO session_tool_registry (
              id,
              session_id,
              provider_id,
              tool_name,
              requirement,
              source,
              first_seen_at,
              last_seen_at,
              last_run_id,
              last_status,
              seen_count,
              metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          `${registration.sessionId}:${registration.providerId}:${registration.toolName}`,
          registration.sessionId,
          registration.providerId,
          registration.toolName,
          registration.requirement,
          registration.source,
          registration.firstSeenAt,
          registration.lastSeenAt,
          registration.lastRunId,
          registration.lastStatus,
          1,
          toJson(registration.metadata),
        );
      return;
    }

    const mergedMetadata = {
      ...existing.metadata,
      ...registration.metadata,
    };

    this.database
      .prepare(
        `
          UPDATE session_tool_registry
          SET
            requirement = ?,
            source = ?,
            last_seen_at = ?,
            last_run_id = ?,
            last_status = ?,
            seen_count = ?,
            metadata_json = ?
          WHERE id = ?
        `,
      )
      .run(
        registration.requirement,
        registration.source,
        registration.lastSeenAt,
        registration.lastRunId,
        registration.lastStatus,
        existing.seenCount + 1,
        toJson(mergedMetadata),
        existing.id,
      );
  }

  listSessionToolRegistrations(sessionId: string): SessionToolRegistration[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            session_id,
            provider_id,
            tool_name,
            requirement,
            source,
            first_seen_at,
            last_seen_at,
            last_run_id,
            last_status,
            seen_count,
            metadata_json
          FROM session_tool_registry
          WHERE session_id = ?
          ORDER BY last_seen_at DESC, id DESC
        `,
      )
      .all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      providerId: String(row.provider_id) as ProviderId,
      toolName: String(row.tool_name),
      requirement: String(row.requirement) as SessionToolRegistration['requirement'],
      source: String(row.source) as SessionToolRegistration['source'],
      firstSeenAt: String(row.first_seen_at),
      lastSeenAt: String(row.last_seen_at),
      lastRunId: String(row.last_run_id),
      lastStatus: String(row.last_status) as SessionToolRegistration['lastStatus'],
      seenCount: Number(row.seen_count),
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)),
    }));
  }

  createArtifact(artifact: ArtifactRecord): ArtifactRecord {
    this.database
      .prepare(
        `
          INSERT INTO artifacts (id, session_id, run_id, kind, title, created_at, content, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        artifact.id,
        artifact.sessionId,
        artifact.runId,
        artifact.kind,
        artifact.title,
        artifact.createdAt,
        artifact.content,
        toJson(artifact.metadata),
      );

    return artifact;
  }

  listArtifacts(runId: string): ArtifactRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, session_id, run_id, kind, title, created_at, content, metadata_json
          FROM artifacts
          WHERE run_id = ?
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all(runId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      kind: String(row.kind) as ArtifactRecord['kind'],
      title: String(row.title),
      createdAt: String(row.created_at),
      content: String(row.content),
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)),
    }));
  }

  createApproval(approval: ApprovalRecord): ApprovalRecord {
    this.database
      .prepare(
        `
          INSERT INTO approvals (
            id,
            session_id,
            run_id,
            tool_name,
            tool_use_id,
            status,
            reason,
            created_at,
            resolved_at,
            payload_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        approval.id,
        approval.sessionId,
        approval.runId,
        approval.toolName,
        approval.toolUseId,
        approval.status,
        approval.reason,
        approval.createdAt,
        approval.resolvedAt,
        toJson(approval.payload),
      );

    return approval;
  }

  createCheckpoint(checkpoint: CheckpointRecord): CheckpointRecord {
    this.database
      .prepare(
        `
          INSERT INTO checkpoints (
            id,
            session_id,
            run_id,
            provider_session_id,
            created_at,
            title,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        checkpoint.id,
        checkpoint.sessionId,
        checkpoint.runId,
        checkpoint.providerSessionId,
        checkpoint.createdAt,
        checkpoint.title,
        toJson(checkpoint.metadata),
      );

    return checkpoint;
  }

  listCheckpoints(runId: string): CheckpointRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            session_id,
            run_id,
            provider_session_id,
            created_at,
            title,
            metadata_json
          FROM checkpoints
          WHERE run_id = ?
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all(runId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      providerSessionId: row.provider_session_id
        ? String(row.provider_session_id)
        : null,
      createdAt: String(row.created_at),
      title: String(row.title),
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)),
    }));
  }

  getCheckpoint(checkpointId: string): CheckpointRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            session_id,
            run_id,
            provider_session_id,
            created_at,
            title,
            metadata_json
          FROM checkpoints
          WHERE id = ?
        `,
      )
      .get(checkpointId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      providerSessionId: row.provider_session_id
        ? String(row.provider_session_id)
        : null,
      createdAt: String(row.created_at),
      title: String(row.title),
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)),
    };
  }

  getApproval(approvalId: string): ApprovalRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            session_id,
            run_id,
            tool_name,
            tool_use_id,
            status,
            reason,
            created_at,
            resolved_at,
            payload_json
          FROM approvals
          WHERE id = ?
        `,
      )
      .get(approvalId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      toolName: String(row.tool_name),
      toolUseId: row.tool_use_id ? String(row.tool_use_id) : null,
      status: String(row.status) as ApprovalRecord['status'],
      reason: row.reason ? String(row.reason) : null,
      createdAt: String(row.created_at),
      resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
      payload: parseJson<Record<string, unknown>>(String(row.payload_json)),
    };
  }

  updateApprovalStatus(
    approvalId: string,
    status: ApprovalRecord['status'],
    updates: {
      reason?: string | null;
      resolvedAt?: string | null;
    } = {},
  ): void {
    this.database
      .prepare(
        `
          UPDATE approvals
          SET
            status = ?,
            reason = ?,
            resolved_at = ?
          WHERE id = ?
        `,
      )
      .run(status, updates.reason ?? null, updates.resolvedAt ?? null, approvalId);
  }

  listApprovals(runId: string): ApprovalRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            session_id,
            run_id,
            tool_name,
            tool_use_id,
            status,
            reason,
            created_at,
            resolved_at,
            payload_json
          FROM approvals
          WHERE run_id = ?
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all(runId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      toolName: String(row.tool_name),
      toolUseId: row.tool_use_id ? String(row.tool_use_id) : null,
      status: String(row.status) as ApprovalRecord['status'],
      reason: row.reason ? String(row.reason) : null,
      createdAt: String(row.created_at),
      resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
      payload: parseJson<Record<string, unknown>>(String(row.payload_json)),
    }));
  }
}
