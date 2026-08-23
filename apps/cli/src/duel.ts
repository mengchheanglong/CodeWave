import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DaemonClient } from "./daemon.js";
import type { ParsedArgs } from "./args.js";

const MUTATION_SCHEMA_VERSION = "codewave-daemon-mutation-v1";
const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "awaiting_approval",
]);

export class DuelError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "DuelError";
    this.code = code;
  }
}

export interface Lane {
  sessionId: string;
  providerId: string;
  runId: string;
}

interface CompareLanePayload {
  sessionId?: unknown;
  providerId?: unknown;
  runSnapshot?: { run?: { id?: unknown } | null; id?: unknown } | null;
}

export interface LaneResult {
  providerId: string;
  runId: string;
  sessionId: string;
  finalStatus: string;
  durationMs: number | null;
  errorMessage: string | null;
  assistantOutput: string | null;
  changedFilesSummary: string | null;
}

function laneFromCompareEntry(entry: CompareLanePayload): Lane {
  const sessionId =
    typeof entry.sessionId === "string" ? entry.sessionId : null;
  const providerId =
    typeof entry.providerId === "string" ? entry.providerId : null;
  // The daemon nests the run inside the snapshot: { runSnapshot: { run: { id } } }.
  const snapshotRun =
    entry.runSnapshot && typeof entry.runSnapshot === "object"
      ? entry.runSnapshot.run
      : null;
  const runId =
    snapshotRun && typeof snapshotRun.id === "string"
      ? snapshotRun.id
      : entry.runSnapshot && typeof entry.runSnapshot.id === "string"
        ? entry.runSnapshot.id
        : null;
  if (!sessionId || !providerId || !runId) {
    throw new DuelError(
      "The daemon returned a compare lane with missing identifiers.",
    );
  }
  return { sessionId, providerId, runId };
}

async function fetchProviderRevision(client: DaemonClient): Promise<string> {
  const registry = await client.request<{ revision?: unknown }>("/api/providers");
  if (typeof registry.revision !== "string" || registry.revision.length === 0) {
    throw new DuelError("The daemon did not report a provider policy revision.");
  }
  return registry.revision;
}

export async function startDuel(
  client: DaemonClient,
  args: ParsedArgs,
): Promise<Lane[]> {
  const attempt = async (revision: string): Promise<Lane[]> => {
    try {
      const response = await client.request<{ lanes?: unknown[] }>(
        "/api/compare",
        {
          method: "POST",
          body: {
            requestSchemaVersion: MUTATION_SCHEMA_VERSION,
            prompt: args.prompt,
            workspacePath: args.workspace,
            providers: args.providers,
            expectedProviderRevision: revision,
          },
          idempotencyKey: `duel-${randomUUID()}`,
        },
      );
      const lanes = Array.isArray(response.lanes) ? (response.lanes as CompareLanePayload[]) : [];
      return lanes.map(laneFromCompareEntry);
    } catch (error) {
      if (
        error instanceof Error &&
        (error as DuelError & { code?: unknown }).code ===
          "provider_revision_conflict"
      ) {
        throw error;
      }
      throw error;
    }
  };

  let revision = await fetchProviderRevision(client);
  try {
    return await attempt(revision);
  } catch (error) {
    const code =
      error instanceof Error
        ? ((error as { code?: unknown }).code ?? null)
        : null;
    if (code === "provider_revision_conflict") {
      // Retry exactly once with a freshly negotiated provider revision.
      revision = await fetchProviderRevision(client);
      return attempt(revision);
    }
    throw new DuelError(
      error instanceof Error ? error.message : String(error),
      typeof code === "string" ? code : null,
    );
  }
}

interface RunSnapshotLike {
  status?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  errorMessage?: unknown;
  preRunCommit?: unknown;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Unwrap the daemon's run-snapshot envelope: GET /api/runs/:id returns
 * { run, events, transcript, ... } with the WorkbenchRun fields under `run`.
 */
function unwrapRun(snapshot: unknown): RunSnapshotLike & Record<string, unknown> {
  if (
    snapshot &&
    typeof snapshot === "object" &&
    (snapshot as Record<string, unknown>).run &&
    typeof (snapshot as Record<string, unknown>).run === "object"
  ) {
    return (snapshot as { run: RunSnapshotLike & Record<string, unknown> }).run;
  }
  return (snapshot ?? {}) as RunSnapshotLike & Record<string, unknown>;
}

async function pollRunToTerminal(
  client: DaemonClient,
  runId: string,
): Promise<RunSnapshotLike> {
  for (;;) {
    const snapshot = unwrapRun(
      await client.request<unknown>(`/api/runs/${runId}`),
    );
    const status = typeof snapshot.status === "string" ? snapshot.status : "";
    if (TERMINAL_STATUSES.has(status)) return snapshot;
    await sleep(POLL_INTERVAL_MS);
  }
}

function extractMessageText(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const record = message as Record<string, unknown>;
  for (const key of ["content", "text", "message"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

async function fetchAssistantOutput(
  client: DaemonClient,
  sessionId: string,
): Promise<string | null> {
  const window = (await client.request<unknown>(
    `/api/sessions/${sessionId}/transcript?limit=50`,
  )) as { messages?: unknown[] } | unknown[];
  const messages = Array.isArray(window)
    ? window
    : Array.isArray(window?.messages)
      ? window.messages
      : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message &&
      typeof message === "object" &&
      (message as Record<string, unknown>).role === "assistant"
    ) {
      const text = extractMessageText(message);
      if (text) return text;
    }
  }
  return null;
}

function gitDiffStat(workspace: string, preRunCommit: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["diff", "--stat", preRunCommit],
      { cwd: workspace, timeout: 10_000, windowsHide: true },
      (error, stdout) => resolve(error ? null : stdout.trim() || null),
    );
  });
}

export async function collectLaneResults(
  client: DaemonClient,
  lanes: Lane[],
  workspace: string,
): Promise<LaneResult[]> {
  const results: LaneResult[] = [];
  for (const lane of lanes) {
    const snapshot = await pollRunToTerminal(client, lane.runId);
    const status = typeof snapshot.status === "string" ? snapshot.status : "unknown";
    const startedAt =
      typeof snapshot.startedAt === "string"
        ? Date.parse(snapshot.startedAt)
        : Number.NaN;
    const completedAt =
      typeof snapshot.completedAt === "string"
        ? Date.parse(snapshot.completedAt)
        : Number.NaN;
    const durationMs =
      Number.isFinite(startedAt) && Number.isFinite(completedAt)
        ? completedAt - startedAt
        : null;
    const errorMessage =
      typeof snapshot.errorMessage === "string" && snapshot.errorMessage
        ? snapshot.errorMessage
        : null;

    const assistantOutput = await fetchAssistantOutput(client, lane.sessionId);
    const changedFilesSummary =
      typeof snapshot.preRunCommit === "string" && snapshot.preRunCommit
        ? await gitDiffStat(workspace, snapshot.preRunCommit)
        : null;

    results.push({
      providerId: lane.providerId,
      runId: lane.runId,
      sessionId: lane.sessionId,
      finalStatus: status,
      durationMs,
      errorMessage,
      assistantOutput,
      changedFilesSummary,
    });
  }
  return results;
}
