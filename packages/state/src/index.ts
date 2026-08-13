import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  CODEWAVE_DEFAULT_TRANSCRIPT_MESSAGES,
  CODEWAVE_MAX_TRANSCRIPT_MESSAGES,
  type ArchiveSessionSummary,
  type ApprovalPolicy,
  type ApprovalRecord,
  type ArtifactRecord,
  type CheckpointRecord,
  type ProviderId,
  type ProjectRecord,
  type RunSteeringInput,
  type RunSteeringStatus,
  type RunStatus,
  type SessionToolRegistration,
  type SessionOrchestrationMetadata,
  type SessionRecoveryMetadata,
  type ToolInvocationRecord,
  type ToolInvocationStatus,
  type TranscriptMessage,
  type TranscriptRole,
  type TranscriptWindow,
  type WorktreeTaskRecord,
  type WorktreeTaskStatus,
  type WorkbenchEvent,
  type WorkbenchRun,
  type WorkbenchSession,
} from '@codewave/protocol';

export type MutationReceipt = {
  key: string;
  operation: string;
  requestHash: string;
  statusCode: number;
  responseJson: string;
  createdAt: string;
  state: 'pending' | 'completed' | 'outcome_unknown' | 'response_redacted';
  finalizedAt: string | null;
  protocolVersion: number;
  clientName: string;
  clientVersion: string;
  canonicalizationVersion: 'codewave-canonical-json-v1';
  requestSchemaVersion: 'codewave-daemon-mutation-v1';
};

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

function triggerContinuityTransactionCrash(point: string): void {
  if (
    process.env.NODE_ENV === 'test' &&
    process.env.CODEWAVE_TEST_CRASH_POINT === point
  ) {
    const signalPath = process.env.CODEWAVE_TEST_CRASH_SIGNAL_PATH;
    if (!signalPath) {
      throw new Error('A test crash signal path is required for continuity failpoints.');
    }
    writeFileSync(signalPath, point, { encoding: 'utf8', flag: 'wx' });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
}

export function resolveDataDirectory(rootPath: string): string {
  return path.join(rootPath, '.codewave');
}

export class SQLiteStateStore {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } finally {
      this.database.close();
    }
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        provider_configuration_revision TEXT NOT NULL DEFAULT 'legacy-unversioned',
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
        provider_configuration_revision TEXT NOT NULL DEFAULT 'legacy-unversioned',
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
        sequence INTEGER NOT NULL DEFAULT 0,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transcript_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        parent_message_id TEXT REFERENCES transcript_messages(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        source_event_id TEXT UNIQUE,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(session_id, sequence)
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

      CREATE TABLE IF NOT EXISTS mutation_receipts (
        idempotency_key TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        finalized_at TEXT,
        protocol_version INTEGER NOT NULL DEFAULT 1,
        client_name TEXT NOT NULL DEFAULT 'legacy-client',
        client_version TEXT NOT NULL DEFAULT 'legacy-unversioned',
        canonicalization_version TEXT NOT NULL DEFAULT 'codewave-canonical-json-v1',
        request_schema_version TEXT NOT NULL DEFAULT 'codewave-daemon-mutation-v1'
      );

      CREATE TABLE IF NOT EXISTS mutation_response_cache (
        idempotency_key TEXT PRIMARY KEY REFERENCES mutation_receipts(idempotency_key) ON DELETE CASCADE,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS codewave_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        default_branch TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worktree_tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        branch_name TEXT NOT NULL UNIQUE,
        base_ref TEXT NOT NULL,
        base_commit TEXT NOT NULL,
        worktree_path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('active', 'accepted', 'reverted')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        accepted_commit TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_worktree_tasks_project_created
        ON worktree_tasks(project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS run_steering_inputs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        target_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        expected_run_id TEXT NOT NULL,
        provider_configuration_revision TEXT NOT NULL DEFAULT 'legacy-unversioned',
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        applied_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        applied_at TEXT,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS run_steering_target_status_idx
      ON run_steering_inputs(target_run_id, status, created_at);

      CREATE INDEX IF NOT EXISTS mutation_receipts_created_at_idx
      ON mutation_receipts(created_at);

      CREATE INDEX IF NOT EXISTS transcript_messages_session_sequence_idx
      ON transcript_messages(session_id, sequence);

      CREATE INDEX IF NOT EXISTS transcript_messages_run_sequence_idx
      ON transcript_messages(run_id, sequence);
    `);

    this.ensureColumn('sessions', 'provider_session_id', 'TEXT');
    this.ensureColumn(
      'sessions',
      'approval_policy',
      "TEXT NOT NULL DEFAULT 'manual'",
    );
    this.ensureColumn(
      'sessions',
      'provider_configuration_revision',
      "TEXT NOT NULL DEFAULT 'legacy-unversioned'",
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
    this.ensureColumn(
      'runs',
      'provider_configuration_revision',
      "TEXT NOT NULL DEFAULT 'legacy-unversioned'",
    );
    this.ensureColumn('events', 'sequence', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn(
      'run_steering_inputs',
      'provider_configuration_revision',
      "TEXT NOT NULL DEFAULT 'legacy-unversioned'",
    );
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

    const expectedMetadata = {
      state_schema_version: 'codewave-state-v1',
      event_schema_version: 'codewave-event-v1',
    } as const;
    for (const [key, expectedValue] of Object.entries(expectedMetadata)) {
      const existing = this.database
        .prepare('SELECT value FROM codewave_metadata WHERE key = ?')
        .get(key) as Record<string, unknown> | undefined;
      if (existing && existing.value !== expectedValue) {
        throw new Error(
          `Unsupported CodeWave ${key} '${String(existing.value)}'; expected '${expectedValue}'.`,
        );
      }
      this.database
        .prepare('INSERT OR IGNORE INTO codewave_metadata (key, value) VALUES (?, ?)')
        .run(key, expectedValue);
    }
    this.ensureColumn(
      'mutation_receipts',
      'state',
      "TEXT NOT NULL DEFAULT 'pending'",
    );
    this.ensureColumn('mutation_receipts', 'finalized_at', 'TEXT');
    this.ensureColumn(
      'mutation_receipts',
      'protocol_version',
      'INTEGER NOT NULL DEFAULT 1',
    );
    this.ensureColumn(
      'mutation_receipts',
      'client_name',
      "TEXT NOT NULL DEFAULT 'legacy-client'",
    );
    this.ensureColumn(
      'mutation_receipts',
      'client_version',
      "TEXT NOT NULL DEFAULT 'legacy-unversioned'",
    );
    this.ensureColumn(
      'mutation_receipts',
      'canonicalization_version',
      "TEXT NOT NULL DEFAULT 'codewave-canonical-json-v1'",
    );
    this.ensureColumn(
      'mutation_receipts',
      'request_schema_version',
      "TEXT NOT NULL DEFAULT 'codewave-daemon-mutation-v1'",
    );

    this.database.exec(`
      UPDATE mutation_receipts
      SET state = 'completed', finalized_at = COALESCE(finalized_at, created_at)
      WHERE status_code > 0 AND state = 'pending';

      INSERT OR IGNORE INTO mutation_response_cache (
        idempotency_key, response_json, created_at
      )
      SELECT idempotency_key, response_json, COALESCE(finalized_at, created_at)
      FROM mutation_receipts
      WHERE status_code > 0 AND response_json <> '';

      UPDATE mutation_receipts
      SET response_json = ''
      WHERE response_json <> '';

      WITH ranked_events AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY run_id
            ORDER BY timestamp ASC, id ASC
          ) AS run_sequence
        FROM events
      )
      UPDATE events
      SET sequence = (
        SELECT run_sequence
        FROM ranked_events
        WHERE ranked_events.id = events.id
      )
      WHERE sequence = 0;

      CREATE UNIQUE INDEX IF NOT EXISTS events_run_sequence_idx
      ON events(run_id, sequence);

      WITH transcript_candidates AS (
        SELECT
          'transcript:run:' || runs.id || ':prompt' AS id,
          runs.session_id,
          runs.id AS run_id,
          'user' AS role,
          TRIM(runs.prompt) AS content,
          runs.created_at,
          NULL AS source_event_id,
          '{"origin":"run.prompt","migration":"transcript-v1"}' AS metadata_json,
          0 AS source_order
        FROM runs
        WHERE TRIM(runs.prompt) <> ''
        UNION ALL
        SELECT
          'transcript:event:' || events.id AS id,
          events.session_id,
          events.run_id,
          json_extract(events.payload_json, '$.role') AS role,
          TRIM(json_extract(events.payload_json, '$.content')) AS content,
          events.timestamp AS created_at,
          events.id AS source_event_id,
          '{"origin":"message.created","migration":"transcript-v1"}' AS metadata_json,
          1 AS source_order
        FROM events
        WHERE events.type = 'message.created'
          AND json_extract(events.payload_json, '$.role') IN ('user', 'assistant', 'system')
          AND TRIM(COALESCE(json_extract(events.payload_json, '$.content'), '')) <> ''
      ),
      ranked_transcript AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY session_id
            ORDER BY created_at ASC, source_order ASC, id ASC
          ) AS transcript_sequence
        FROM transcript_candidates
      ),
      linked_transcript AS (
        SELECT
          *,
          LAG(id) OVER (
            PARTITION BY session_id
            ORDER BY transcript_sequence ASC
          ) AS parent_id
        FROM ranked_transcript
      )
      INSERT OR IGNORE INTO transcript_messages (
        id,
        session_id,
        run_id,
        sequence,
        parent_message_id,
        role,
        content,
        created_at,
        source_event_id,
        metadata_json
      )
      SELECT
        id,
        session_id,
        run_id,
        transcript_sequence,
        parent_id,
        role,
        content,
        created_at,
        source_event_id,
        metadata_json
      FROM linked_transcript;
    `);
  }

  private withImmediateTransaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const result = work();
      this.database.exec('COMMIT;');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
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
      providerConfigurationRevision: row.provider_configuration_revision
        ? String(row.provider_configuration_revision)
        : 'legacy-unversioned',
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
            provider_configuration_revision,
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        session.id,
        session.workspacePath,
        session.providerId,
        session.providerConfigurationRevision,
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
            provider_configuration_revision,
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
            provider_configuration_revision,
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
      providerConfigurationRevision?: string;
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
            provider_id = ?,
            provider_configuration_revision = ?
          WHERE id = ?
        `,
      )
      .run(
        updates.providerSessionId ?? current.providerSessionId,
        updates.approvalPolicy ?? current.approvalPolicy,
        updates.providerId ?? current.providerId,
        updates.providerConfigurationRevision ??
          current.providerConfigurationRevision,
        sessionId,
      );
  }

  createRun(run: WorkbenchRun): WorkbenchRun {
    this.withImmediateTransaction(() => {
      this.database
        .prepare(
          `
            INSERT INTO runs (
              id,
              session_id,
              provider_id,
              provider_configuration_revision,
              prompt,
              status,
              mode,
              pre_run_commit,
              created_at,
              started_at,
              completed_at,
              error_message
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          run.id,
          run.sessionId,
          run.providerId,
          run.providerConfigurationRevision,
          run.prompt,
          run.status,
          run.mode,
          run.preRunCommit ?? null,
          run.createdAt,
          run.startedAt,
          run.completedAt,
          run.errorMessage,
        );

      const prompt = run.prompt.trim();
      if (prompt) {
        this.insertTranscriptMessage({
          id: `transcript:run:${run.id}:prompt`,
          sessionId: run.sessionId,
          runId: run.id,
          role: 'user',
          content: prompt,
          createdAt: run.createdAt,
          sourceEventId: null,
          metadata: {
            origin: 'run.prompt',
            providerId: run.providerId,
            providerConfigurationRevision: run.providerConfigurationRevision,
          },
        });
      }
    });

    return run;
  }

  listRuns(sessionId: string): WorkbenchRun[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, session_id, provider_id, provider_configuration_revision, prompt, status, mode, pre_run_commit, created_at, started_at, completed_at, error_message
          FROM runs
          WHERE session_id = ?
          ORDER BY created_at DESC
        `,
      )
      .all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((row) => this.mapRunRow(row));
  }

  listNonTerminalRuns(sessionId?: string): WorkbenchRun[] {
    const where = sessionId
      ? "WHERE session_id = ? AND status IN ('queued', 'running', 'awaiting_approval')"
      : "WHERE status IN ('queued', 'running', 'awaiting_approval')";
    const statement = this.database.prepare(
      `
        SELECT id, session_id, provider_id, provider_configuration_revision, prompt, status, mode, pre_run_commit, created_at, started_at, completed_at, error_message
        FROM runs
        ${where}
        ORDER BY created_at ASC, id ASC
      `,
    );
    const rows = (sessionId ? statement.all(sessionId) : statement.all()) as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => this.mapRunRow(row));
  }

  getRun(runId: string): WorkbenchRun | null {
    const row = this.database
      .prepare(
        `
          SELECT id, session_id, provider_id, provider_configuration_revision, prompt, status, mode, pre_run_commit, created_at, started_at, completed_at, error_message
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
      providerConfigurationRevision: String(
        row.provider_configuration_revision ?? 'legacy-unversioned',
      ),
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

  private mapTranscriptRow(row: Record<string, unknown>): TranscriptMessage {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      sequence: Number(row.sequence),
      parentMessageId: row.parent_message_id
        ? String(row.parent_message_id)
        : null,
      role: String(row.role) as TranscriptRole,
      content: String(row.content),
      createdAt: String(row.created_at),
      sourceEventId: row.source_event_id ? String(row.source_event_id) : null,
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json)),
    };
  }

  private insertTranscriptMessage(
    message: Omit<TranscriptMessage, 'sequence' | 'parentMessageId'>,
  ): TranscriptMessage {
    const previous = this.database
      .prepare(
        `
          SELECT id, sequence
          FROM transcript_messages
          WHERE session_id = ?
          ORDER BY sequence DESC
          LIMIT 1
        `,
      )
      .get(message.sessionId) as Record<string, unknown> | undefined;
    const persisted: TranscriptMessage = {
      ...message,
      sequence: previous ? Number(previous.sequence) + 1 : 1,
      parentMessageId: previous ? String(previous.id) : null,
    };

    this.database
      .prepare(
        `
          INSERT INTO transcript_messages (
            id,
            session_id,
            run_id,
            sequence,
            parent_message_id,
            role,
            content,
            created_at,
            source_event_id,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        persisted.id,
        persisted.sessionId,
        persisted.runId,
        persisted.sequence,
        persisted.parentMessageId,
        persisted.role,
        persisted.content,
        persisted.createdAt,
        persisted.sourceEventId,
        toJson(persisted.metadata),
      );

    return persisted;
  }

  listTranscriptMessages(
    sessionId: string,
    options: { beforeSequence?: number; limit?: number } = {},
  ): TranscriptWindow {
    const limit = Math.max(
      1,
      Math.min(
        Math.trunc(
          options.limit ?? CODEWAVE_DEFAULT_TRANSCRIPT_MESSAGES,
        ),
        CODEWAVE_MAX_TRANSCRIPT_MESSAGES,
      ),
    );
    const beforeSequence =
      typeof options.beforeSequence === 'number'
        ? Math.max(1, Math.trunc(options.beforeSequence))
        : null;
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM (
            SELECT
              id,
              session_id,
              run_id,
              sequence,
              parent_message_id,
              role,
              content,
              created_at,
              source_event_id,
              metadata_json
            FROM transcript_messages
            WHERE session_id = ?
              AND (? IS NULL OR sequence < ?)
            ORDER BY sequence DESC
            LIMIT ?
          )
          ORDER BY sequence ASC
        `,
      )
      .all(sessionId, beforeSequence, beforeSequence, limit) as Array<
      Record<string, unknown>
    >;
    const messages = rows.map((row) => this.mapTranscriptRow(row));
    const totalCount = Number(
      (
        this.database
          .prepare(
            `
              SELECT COUNT(*) AS total_count
              FROM transcript_messages
              WHERE session_id = ?
            `,
          )
          .get(sessionId) as Record<string, unknown>
      ).total_count,
    );
    const oldestSequence = messages[0]?.sequence ?? null;
    const newestSequence = messages.at(-1)?.sequence ?? null;
    const hasMoreBefore =
      oldestSequence !== null &&
      Boolean(
        this.database
          .prepare(
            `
              SELECT 1
              FROM transcript_messages
              WHERE session_id = ? AND sequence < ?
              LIMIT 1
            `,
          )
          .get(sessionId, oldestSequence),
      );

    return {
      sessionId,
      messages,
      hasMoreBefore,
      oldestSequence,
      newestSequence,
      totalCount,
    };
  }

  getLatestTranscriptSequenceForRun(runId: string): number | null {
    const row = this.database
      .prepare(
        `
          SELECT MAX(sequence) AS latest_sequence
          FROM transcript_messages
          WHERE run_id = ?
        `,
      )
      .get(runId) as Record<string, unknown>;
    return row.latest_sequence === null || row.latest_sequence === undefined
      ? null
      : Number(row.latest_sequence);
  }

  appendEvent(event: WorkbenchEvent): WorkbenchEvent {
    const persistedEvent = this.withImmediateTransaction(() => {
      const nextSequence = Number(
        (
          this.database
            .prepare(
              `
                SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
                FROM events
                WHERE run_id = ?
              `,
            )
            .get(event.runId) as Record<string, unknown>
        ).next_sequence,
      );
      const nextEvent = {
        ...event,
        sequence:
          typeof event.sequence === 'number' && event.sequence > 0
            ? event.sequence
            : nextSequence,
      };

      this.database
        .prepare(
          `
            INSERT INTO events (
              id,
              session_id,
              run_id,
              sequence,
              timestamp,
              source,
              type,
              payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          nextEvent.id,
          nextEvent.sessionId,
          nextEvent.runId,
          nextEvent.sequence,
          nextEvent.timestamp,
          nextEvent.source,
          nextEvent.type,
          toJson(nextEvent.payload),
        );

      if (nextEvent.type === 'message.created') {
        triggerContinuityTransactionCrash('inside_message_event_transaction');
      }

      if (nextEvent.type === 'message.created') {
        const role = nextEvent.payload.role;
        const content =
          typeof nextEvent.payload.content === 'string'
            ? nextEvent.payload.content.trim()
            : '';
        if (
          (role === 'user' || role === 'assistant' || role === 'system') &&
          content
        ) {
          this.insertTranscriptMessage({
            id: `transcript:event:${nextEvent.id}`,
            sessionId: nextEvent.sessionId,
            runId: nextEvent.runId,
            role,
            content,
            createdAt: nextEvent.timestamp,
            sourceEventId: nextEvent.id,
            metadata: {
              origin: 'message.created',
              eventSource: nextEvent.source,
            },
          });
        }
      }

      return nextEvent;
    });

    return persistedEvent;
  }

  private mapProjectRow(row: Record<string, unknown>): ProjectRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      rootPath: String(row.root_path),
      defaultBranch: String(row.default_branch),
      createdAt: String(row.created_at),
    };
  }

  createProject(project: ProjectRecord): ProjectRecord {
    this.database
      .prepare(
        `INSERT INTO projects (id, name, root_path, default_branch, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.rootPath,
        project.defaultBranch,
        project.createdAt,
      );
    return project;
  }

  listProjects(): ProjectRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, root_path, default_branch, created_at
         FROM projects ORDER BY created_at ASC, name ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapProjectRow(row));
  }

  getProject(projectId: string): ProjectRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, name, root_path, default_branch, created_at
         FROM projects WHERE id = ?`,
      )
      .get(projectId) as Record<string, unknown> | undefined;
    return row ? this.mapProjectRow(row) : null;
  }

  private mapWorktreeTaskRow(row: Record<string, unknown>): WorktreeTaskRecord {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      title: String(row.title),
      branchName: String(row.branch_name),
      baseRef: String(row.base_ref),
      baseCommit: String(row.base_commit),
      worktreePath: String(row.worktree_path),
      status: String(row.status) as WorktreeTaskStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      acceptedCommit: row.accepted_commit ? String(row.accepted_commit) : null,
    };
  }

  createWorktreeTask(task: WorktreeTaskRecord): WorktreeTaskRecord {
    this.database
      .prepare(
        `INSERT INTO worktree_tasks (
           id, project_id, title, branch_name, base_ref, base_commit,
           worktree_path, status, created_at, updated_at, accepted_commit
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.projectId,
        task.title,
        task.branchName,
        task.baseRef,
        task.baseCommit,
        task.worktreePath,
        task.status,
        task.createdAt,
        task.updatedAt,
        task.acceptedCommit,
      );
    return task;
  }

  listWorktreeTasks(projectId?: string): WorktreeTaskRecord[] {
    const rows = (projectId
      ? this.database
          .prepare(
            `SELECT * FROM worktree_tasks
             WHERE project_id = ? ORDER BY created_at DESC`,
          )
          .all(projectId)
      : this.database
          .prepare('SELECT * FROM worktree_tasks ORDER BY created_at DESC')
          .all()) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapWorktreeTaskRow(row));
  }

  getWorktreeTask(taskId: string): WorktreeTaskRecord | null {
    const row = this.database
      .prepare('SELECT * FROM worktree_tasks WHERE id = ?')
      .get(taskId) as Record<string, unknown> | undefined;
    return row ? this.mapWorktreeTaskRow(row) : null;
  }

  updateWorktreeTaskStatus(
    taskId: string,
    status: WorktreeTaskStatus,
    updatedAt: string,
    acceptedCommit: string | null,
  ): WorktreeTaskRecord | null {
    this.database
      .prepare(
        `UPDATE worktree_tasks
         SET status = ?, updated_at = ?, accepted_commit = ?
         WHERE id = ?`,
      )
      .run(status, updatedAt, acceptedCommit, taskId);
    return this.getWorktreeTask(taskId);
  }

  appendTerminalEvent(
    event: WorkbenchEvent,
    status: Extract<RunStatus, 'completed' | 'failed' | 'cancelled'>,
    errorMessage: string | null,
  ): WorkbenchEvent | null {
    return this.withImmediateTransaction(() => {
      const run = this.database
        .prepare('SELECT status FROM runs WHERE id = ?')
        .get(event.runId) as Record<string, unknown> | undefined;
      if (
        !run ||
        run.status === 'completed' ||
        run.status === 'failed' ||
        run.status === 'cancelled'
      ) {
        return null;
      }
      const nextSequence = Number(
        (
          this.database
            .prepare(
              `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
               FROM events WHERE run_id = ?`,
            )
            .get(event.runId) as Record<string, unknown>
        ).next_sequence,
      );
      const nextEvent = {
        ...event,
        sequence:
          typeof event.sequence === 'number' && event.sequence > 0
            ? event.sequence
            : nextSequence,
      };
      this.database
        .prepare(
          `INSERT INTO events (
             id, session_id, run_id, sequence, timestamp, source, type, payload_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          nextEvent.id,
          nextEvent.sessionId,
          nextEvent.runId,
          nextEvent.sequence,
          nextEvent.timestamp,
          nextEvent.source,
          nextEvent.type,
          toJson(nextEvent.payload),
        );
      this.database
        .prepare(
          `UPDATE runs
           SET status = ?, completed_at = ?, error_message = ?
           WHERE id = ? AND status IN ('queued', 'running', 'awaiting_approval')`,
        )
        .run(status, event.timestamp, errorMessage, event.runId);
      return nextEvent;
    });
  }

  listEvents(
    runId: string,
    options: { afterSequence?: number; limit?: number } = {},
  ): WorkbenchEvent[] {
    const limit = options.limit
      ? Math.max(1, Math.min(Math.trunc(options.limit), 1000))
      : null;
    const afterSequence =
      typeof options.afterSequence === 'number'
        ? Math.max(0, Math.trunc(options.afterSequence))
        : null;

    let rows: Array<Record<string, unknown>>;
    if (afterSequence !== null) {
      rows = this.database
        .prepare(
          `
            SELECT
              id, session_id, run_id, sequence, timestamp, source, type, payload_json
            FROM events
            WHERE run_id = ? AND sequence > ?
            ORDER BY sequence ASC
            ${limit === null ? '' : 'LIMIT ?'}
          `,
        )
        .all(...(limit === null ? [runId, afterSequence] : [runId, afterSequence, limit])) as Array<
        Record<string, unknown>
      >;
    } else if (limit !== null) {
      rows = this.database
        .prepare(
          `
            SELECT *
            FROM (
              SELECT
                id, session_id, run_id, sequence, timestamp, source, type, payload_json
              FROM events
              WHERE run_id = ?
              ORDER BY sequence DESC
              LIMIT ?
            )
            ORDER BY sequence ASC
          `,
        )
        .all(runId, limit) as Array<Record<string, unknown>>;
    } else {
      rows = this.database
        .prepare(
          `
            SELECT
              id, session_id, run_id, sequence, timestamp, source, type, payload_json
            FROM events
            WHERE run_id = ?
            ORDER BY sequence ASC
          `,
        )
        .all(runId) as Array<Record<string, unknown>>;
    }

    return rows.map((row) => ({
      id: String(row.id),
      sequence: Number(row.sequence),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      timestamp: String(row.timestamp),
      source: String(row.source) as WorkbenchEvent['source'],
      type: String(row.type) as WorkbenchEvent['type'],
      payload: parseJson<Record<string, unknown>>(String(row.payload_json)),
    }));
  }

  createSteeringInput(input: RunSteeringInput): RunSteeringInput {
    this.database
      .prepare(
        `
          INSERT INTO run_steering_inputs (
            id,
            session_id,
            target_run_id,
            expected_run_id,
            provider_configuration_revision,
            prompt,
            status,
            created_at,
            applied_run_id,
            applied_at,
            error_message
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.id,
        input.sessionId,
        input.targetRunId,
        input.expectedRunId,
        input.providerConfigurationRevision,
        input.prompt,
        input.status,
        input.createdAt,
        input.appliedRunId,
        input.appliedAt,
        input.errorMessage,
      );
    return input;
  }

  listSteeringInputs(targetRunId: string): RunSteeringInput[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, session_id, target_run_id, expected_run_id, provider_configuration_revision, prompt, status, created_at, applied_run_id, applied_at, error_message
          FROM run_steering_inputs
          WHERE target_run_id = ?
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all(targetRunId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapSteeringInputRow(row));
  }

  listQueuedSteeringInputs(targetRunId?: string): RunSteeringInput[] {
    const where = targetRunId
      ? "WHERE target_run_id = ? AND status = 'queued'"
      : "WHERE status = 'queued'";
    const statement = this.database.prepare(
      `
        SELECT id, session_id, target_run_id, expected_run_id, provider_configuration_revision, prompt, status, created_at, applied_run_id, applied_at, error_message
        FROM run_steering_inputs
        ${where}
        ORDER BY created_at ASC, id ASC
      `,
    );
    const rows = (targetRunId
      ? statement.all(targetRunId)
      : statement.all()) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapSteeringInputRow(row));
  }

  updateSteeringInputStatus(
    steeringId: string,
    status: RunSteeringStatus,
    updates: {
      appliedRunId?: string | null;
      appliedAt?: string | null;
      errorMessage?: string | null;
    } = {},
  ): void {
    this.database
      .prepare(
        `
          UPDATE run_steering_inputs
          SET status = ?, applied_run_id = ?, applied_at = ?, error_message = ?
          WHERE id = ?
        `,
      )
      .run(
        status,
        updates.appliedRunId ?? null,
        updates.appliedAt ?? null,
        updates.errorMessage ?? null,
        steeringId,
      );
  }

  transitionQueuedSteeringInput(
    steeringId: string,
    status: Exclude<RunSteeringStatus, 'queued'>,
    updates: {
      appliedRunId?: string | null;
      appliedAt?: string | null;
      errorMessage?: string | null;
    } = {},
  ): boolean {
    const result = this.database
      .prepare(
        `
          UPDATE run_steering_inputs
          SET status = ?, applied_run_id = ?, applied_at = ?, error_message = ?
          WHERE id = ? AND status = 'queued'
        `,
      )
      .run(
        status,
        updates.appliedRunId ?? null,
        updates.appliedAt ?? null,
        updates.errorMessage ?? null,
        steeringId,
      );
    return result.changes === 1;
  }

  private mapSteeringInputRow(row: Record<string, unknown>): RunSteeringInput {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      targetRunId: String(row.target_run_id),
      expectedRunId: String(row.expected_run_id),
      providerConfigurationRevision: String(
        row.provider_configuration_revision ?? 'legacy-unversioned',
      ),
      prompt: String(row.prompt),
      status: String(row.status) as RunSteeringStatus,
      createdAt: String(row.created_at),
      appliedRunId: row.applied_run_id ? String(row.applied_run_id) : null,
      appliedAt: row.applied_at ? String(row.applied_at) : null,
      errorMessage: row.error_message ? String(row.error_message) : null,
    };
  }

  getMutationReceipt(key: string): MutationReceipt | null {
    const row = this.database
      .prepare(
        `
          SELECT mutation_receipts.idempotency_key, operation, request_hash, status_code,
            COALESCE(mutation_response_cache.response_json, '') AS response_json,
            mutation_receipts.created_at, state, finalized_at, protocol_version, client_name,
            client_version, canonicalization_version, request_schema_version
          FROM mutation_receipts
          LEFT JOIN mutation_response_cache USING (idempotency_key)
          WHERE idempotency_key = ?
        `,
      )
      .get(key) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      key: String(row.idempotency_key),
      operation: String(row.operation),
      requestHash: String(row.request_hash),
      statusCode: Number(row.status_code),
      responseJson: String(row.response_json),
      createdAt: String(row.created_at),
      state: String(row.state ?? 'pending') as MutationReceipt['state'],
      finalizedAt: row.finalized_at ? String(row.finalized_at) : null,
      protocolVersion: Number(row.protocol_version ?? 1),
      clientName: String(row.client_name ?? 'legacy-client'),
      clientVersion: String(row.client_version ?? 'legacy-unversioned'),
      canonicalizationVersion: String(
        row.canonicalization_version,
      ) as MutationReceipt['canonicalizationVersion'],
      requestSchemaVersion: String(
        row.request_schema_version,
      ) as MutationReceipt['requestSchemaVersion'],
    };
  }

  createMutationReceipt(receipt: MutationReceipt): MutationReceipt {
    this.database
      .prepare(
        `
          INSERT INTO mutation_receipts (
            idempotency_key, operation, request_hash, status_code, response_json,
            created_at, state, finalized_at, protocol_version, client_name,
            client_version, canonicalization_version, request_schema_version
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        receipt.key,
        receipt.operation,
        receipt.requestHash,
        receipt.statusCode,
        receipt.responseJson,
        receipt.createdAt,
        receipt.state,
        receipt.finalizedAt,
        receipt.protocolVersion,
        receipt.clientName,
        receipt.clientVersion,
        receipt.canonicalizationVersion,
        receipt.requestSchemaVersion,
      );
    return receipt;
  }

  finalizeMutationReceipt(
    key: string,
    statusCode: number,
    responseJson: string,
  ): void {
    const finalizedAt = new Date().toISOString();
    this.withImmediateTransaction(() => {
      this.database
        .prepare(
          `
            UPDATE mutation_receipts
            SET status_code = ?, response_json = '', state = 'completed', finalized_at = ?
            WHERE idempotency_key = ? AND state = 'pending'
          `,
        )
        .run(statusCode, finalizedAt, key);
      this.database
        .prepare(
          `INSERT OR REPLACE INTO mutation_response_cache (
             idempotency_key, response_json, created_at
           ) VALUES (?, ?, ?)`,
        )
        .run(key, responseJson, finalizedAt);
    });
  }

  getMutationReceiptMetadata(key: string): MutationReceipt | null {
    const row = this.database
      .prepare(
        `SELECT idempotency_key, operation, request_hash, status_code,
          '' AS response_json, mutation_receipts.created_at, state, finalized_at,
          protocol_version, client_name, client_version,
          canonicalization_version, request_schema_version
         FROM mutation_receipts WHERE idempotency_key = ?`,
      )
      .get(key) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      key: String(row.idempotency_key),
      operation: String(row.operation),
      requestHash: String(row.request_hash),
      statusCode: Number(row.status_code),
      responseJson: '',
      createdAt: String(row.created_at),
      state: String(row.state) as MutationReceipt['state'],
      finalizedAt: row.finalized_at ? String(row.finalized_at) : null,
      protocolVersion: Number(row.protocol_version),
      clientName: String(row.client_name),
      clientVersion: String(row.client_version),
      canonicalizationVersion: String(
        row.canonicalization_version,
      ) as MutationReceipt['canonicalizationVersion'],
      requestSchemaVersion: String(
        row.request_schema_version,
      ) as MutationReceipt['requestSchemaVersion'],
    };
  }

  reconcilePendingMutationReceipts(reconciledAt: string): number {
    const result = this.database
      .prepare(
        `
          UPDATE mutation_receipts
          SET state = 'outcome_unknown', finalized_at = ?
          WHERE state = 'pending' AND status_code = 0
        `,
      )
      .run(reconciledAt);
    return Number(result.changes ?? 0);
  }

  redactMutationResponsesContaining(value: string, redactedAt: string): number {
    if (!value) return 0;
    return this.withImmediateTransaction(() => {
      const keys = this.database
        .prepare(
          `SELECT idempotency_key FROM mutation_response_cache
           WHERE instr(response_json, ?) > 0`,
        )
        .all(value) as Array<Record<string, unknown>>;
      if (keys.length === 0) return 0;
      const update = this.database.prepare(
        `UPDATE mutation_receipts
         SET state = 'response_redacted', finalized_at = ?
         WHERE idempotency_key = ?`,
      );
      const remove = this.database.prepare(
        'DELETE FROM mutation_response_cache WHERE idempotency_key = ?',
      );
      for (const row of keys) {
        update.run(redactedAt, String(row.idempotency_key));
        remove.run(String(row.idempotency_key));
      }
      return keys.length;
    });
  }

  pruneMutationReceipts(olderThan: string): number {
    const result = this.database
      .prepare('DELETE FROM mutation_receipts WHERE created_at < ?')
      .run(olderThan);
    return Number(result.changes ?? 0);
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
