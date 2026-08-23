import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { AddressInfo } from "node:net";
import { DaemonClient } from "./daemon.js";
import { DuelError, collectLaneResults, startDuel } from "./duel.js";
import type { ParsedArgs } from "./args.js";

const HANDSHAKE_BODY = {
  connectionId: "conn-test-1",
  grantedScopes: [
    "runtime:read",
    "providers:read",
    "providers:write",
    "sessions:read",
    "sessions:write",
    "runs:read",
    "runs:write",
    "orchestration:read",
    "orchestration:write",
    "tools:read",
    "workspace:read",
    "workspace:write",
    "projects:read",
    "projects:write",
    "approvals:write",
  ],
};

function makeArgs(daemonUrl: string): ParsedArgs {
  return {
    prompt: "fix the bug",
    providers: ["opencode", "qwen"],
    workspace: process.cwd(),
    daemonUrl,
    json: false,
  };
}

interface StubState {
  providerRevisions: string[];
  compareCalls: number;
  runPolls: number;
  compareStatus: number;
  compareBody: Record<string, unknown>;
}

async function withStubServer(
  handler: (reqPath: string, method: string, state: StubState) => { status: number; body: unknown },
): Promise<{ server: Server; url: () => string; state: StubState }> {
  const state: StubState = {
    providerRevisions: ["rev-1"],
    compareCalls: 0,
    runPolls: 0,
    compareStatus: 201,
    compareBody: {},
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const path = req.url ?? "/";
      const outcome = handler(path, req.method ?? "GET", state);
      res.writeHead(outcome.status, { "content-type": "application/json" });
      res.end(JSON.stringify(outcome.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { server, url: () => `http://127.0.0.1:${address.port}`, state };
}

describe("startDuel", () => {
  let harness: Awaited<ReturnType<typeof withStubServer>>;

  before(async () => {
    harness = await withStubServer((path, _method, state) => {
      if (path === "/api/handshake") return { status: 201, body: HANDSHAKE_BODY };
      if (path === "/api/providers") {
        const revision = state.providerRevisions.at(-1) ?? "rev-1";
        return { status: 200, body: { version: 1, revision } };
      }
      if (path === "/api/compare") {
        state.compareCalls += 1;
        // Simulate one-shot conflict: first call 409, retry succeeds.
        if (state.compareStatus !== 201 && state.compareCalls > 1) {
          state.compareStatus = 201;
        }
        if (state.compareStatus !== 201) {
          return {
            status: state.compareStatus,
            body: { error: "Provider configuration changed.", code: "provider_revision_conflict" },
          };
        }
        return {
          status: 201,
          body: {
            lanes: [
              { sessionId: "s-1", providerId: "opencode", runSnapshot: { run: { id: "r-1" } } },
              { sessionId: "s-2", providerId: "qwen", runSnapshot: { run: { id: "r-2" } } },
            ],
          },
        };
      }
      return { status: 404, body: { error: "Not found" } };
    });
  });

  after(() => new Promise<void>((resolve) => harness.server.close(() => resolve())));

  it("returns parsed lanes on the happy path", async () => {
    const client = new DaemonClient(harness.url());
    await client.connect();
    const lanes = await startDuel(client, makeArgs(harness.url()));
    assert.equal(lanes.length, 2);
    assert.equal(lanes[0]?.providerId, "opencode");
    assert.equal(lanes[1]?.runId, "r-2");
  });

  it("retries exactly once on provider_revision_conflict", async () => {
    harness.state.providerRevisions.push("rev-2");
    // First compare call conflicts; the retry (second call) succeeds.
    const originalCompare = harness.state.compareStatus;
    harness.state.compareStatus = 409;
    const client = new DaemonClient(harness.url());
    await client.connect();
    const lanes = await startDuel(client, makeArgs(harness.url()));
    assert.equal(lanes.length, 2);
    assert.equal(harness.state.compareCalls, 2, "expected exactly one retry");
    assert.equal(harness.state.compareStatus, originalCompare);
    harness.state.compareStatus = originalCompare;
  });

  it("wraps daemon failures in DuelError carrying the verbatim message", async () => {
    const failing = await withStubServer((path) => {
      if (path === "/api/handshake") return { status: 201, body: HANDSHAKE_BODY };
      if (path === "/api/providers") return { status: 200, body: { revision: "rev-1" } };
      if (path === "/api/compare") {
        return { status: 400, body: { error: "Choose at least two different providers to compare." } };
      }
      return { status: 404, body: {} };
    });
    try {
      const client = new DaemonClient(failing.url());
      await client.connect();
      await assert.rejects(
        () => startDuel(client, makeArgs(failing.url())),
        (error: unknown) =>
          error instanceof DuelError &&
          error.message.includes("Choose at least two different providers"),
      );
    } finally {
      failing.server.close();
    }
  });
});

describe("collectLaneResults", () => {
  it("picks the last assistant message and reports terminal status", async () => {
    const pollHarness = await withStubServer((path, _method, state) => {
      if (path === "/api/handshake") return { status: 201, body: HANDSHAKE_BODY };
      if (path === "/api/runs/r-1") {
        state.runPolls += 1;
        const status = state.runPolls >= 2 ? "completed" : "running";
        return {
          status: 200,
          body: {
            run: {
              id: "r-1",
              status,
              startedAt: "2026-08-23T10:00:00.000Z",
              completedAt: status === "completed" ? "2026-08-23T10:00:05.000Z" : null,
              preRunCommit: null,
            },
            events: [],
          },
        };
      }
      if (path === "/api/sessions/s-1/transcript?limit=50") {
        return {
          status: 200,
          body: {
            messages: [
              { role: "user", content: "fix the bug" },
              { role: "assistant", content: "first draft" },
              { role: "assistant", text: "final fixed answer" },
            ],
          },
        };
      }
      return { status: 404, body: {} };
    });
    try {
      const client = new DaemonClient(pollHarness.url());
      await client.connect();
      const results = await collectLaneResults(
        client,
        [{ sessionId: "s-1", providerId: "opencode", runId: "r-1" }],
        process.cwd(),
      );
      assert.equal(results.length, 1);
      assert.equal(results[0]?.finalStatus, "completed");
      assert.equal(results[0]?.durationMs, 5000);
      assert.equal(results[0]?.assistantOutput, "final fixed answer");
    } finally {
      pollHarness.server.close();
    }
  });
});
