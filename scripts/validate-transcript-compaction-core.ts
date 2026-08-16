import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { TranscriptMessage } from '@codewave/protocol';
import {
  TRANSCRIPT_COMPACTION_AUTHORITY,
  TranscriptCompactionError,
  canonicalCompactionJson,
  createDeterministicTranscriptSummaryHook,
  createTranscriptCompaction,
  type PreCompactionMemoryHook,
  type TranscriptCompactionBoundary,
  type TranscriptCompactionCheckpoint,
} from '../apps/daemon/src/transcript-compaction.js';

const SESSION_ID = 'session-compaction-core';
const POLICY_REVISION = `sha256:${createHash('sha256')
  .update('compaction-policy-v1')
  .digest('hex')}`;
const GENERATOR = {
  id: 'codewave.local-compactor',
  version: '1',
  kind: 'local-deterministic' as const,
};

function message(
  sequence: number,
  options: { parentId?: string | null; runId?: string; content?: string } = {},
): TranscriptMessage {
  const id = `message-${sequence}`;
  return {
    id,
    sessionId: SESSION_ID,
    runId: options.runId ?? `run-${Math.ceil(sequence / 2)}`,
    sequence,
    parentMessageId:
      options.parentId !== undefined
        ? options.parentId
        : sequence === 1
          ? null
          : `message-${sequence - 1}`,
    role: sequence % 2 === 1 ? 'user' : 'assistant',
    content: options.content ?? `Transcript content ${sequence}`,
    createdAt: `2026-08-13T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    sourceEventId: sequence % 2 === 0 ? `event-${sequence}` : null,
    metadata: sequence % 2 === 0
      ? { origin: 'message.created', nested: { b: 2, a: 1 } }
      : { origin: 'run.prompt' },
  };
}

function boundary(
  messages: readonly TranscriptMessage[],
  transcriptHeadSequence: number,
): TranscriptCompactionBoundary {
  const last = messages.at(-1)!;
  return {
    sessionId: SESSION_ID,
    transcriptHeadSequence,
    throughSequence: last.sequence,
    throughMessageId: last.id,
    throughRunId: last.runId,
    throughRunStatus: 'completed',
    isRunTranscriptTail: true,
  };
}

function compact(
  messages: readonly TranscriptMessage[],
  options: {
    previousCheckpoint?: TranscriptCompactionCheckpoint | null;
    hooks?: readonly PreCompactionMemoryHook[];
    head?: number;
    signal?: AbortSignal;
    limits?: Parameters<typeof createTranscriptCompaction>[0]['limits'];
  } = {},
) {
  return createTranscriptCompaction({
    messages,
    boundary: boundary(messages, options.head ?? messages.at(-1)!.sequence + 2),
    previousCheckpoint: options.previousCheckpoint,
    policyRevision: POLICY_REVISION,
    generator: GENERATOR,
    hooks: options.hooks ?? [createDeterministicTranscriptSummaryHook()],
    limits: {
      minimumRawTailMessages: 2,
      ...(options.limits ?? {}),
    },
    signal: options.signal,
  });
}

async function expectCode(
  action: () => Promise<unknown>,
  code: TranscriptCompactionError['code'],
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof TranscriptCompactionError);
    assert.equal(error.code, code);
    return true;
  });
}

const results: string[] = [];
function passed(name: string): void {
  results.push(name);
  process.stdout.write(`PASS ${name}\n`);
}

const firstSegment = [message(1), message(2), message(3), message(4)];
const rawBefore = canonicalCompactionJson(firstSegment);
const frozenMutationHook: PreCompactionMemoryHook = {
  id: 'fixture.mutation-attempt',
  version: '1',
  run({ messages }) {
    assert.throws(() => {
      (messages[0] as TranscriptMessage).content = 'MUTATED';
    });
    return {
      summaryFragments: [
        {
          key: 'immutability-proof',
          content: 'The hook received a frozen transcript projection.',
          sourceMessageIds: [messages[0]!.id],
        },
      ],
      memories: [
        {
          key: 'frozen-input',
          kind: 'constraint',
          content: 'Raw transcript messages remain authoritative and immutable.',
          sourceMessageIds: [messages[0]!.id, messages[1]!.id],
        },
      ],
    };
  },
};
const extractiveHook = createDeterministicTranscriptSummaryHook({
  maxExcerptCharacters: 80,
});
const first = await compact(firstSegment, {
  hooks: [frozenMutationHook, extractiveHook],
});
assert.equal(canonicalCompactionJson(firstSegment), rawBefore);
assert.equal(first.authority, TRANSCRIPT_COMPACTION_AUTHORITY);
assert.equal(first.fromSequence, 1);
assert.equal(first.throughSequence, 4);
assert.match(first.segmentDigest, /^sha256:[a-f0-9]{64}$/);
assert.match(first.coverageDigest, /^sha256:[a-f0-9]{64}$/);
assert.match(first.outputDigest, /^sha256:[a-f0-9]{64}$/);
assert.match(first.id, /^transcript-compaction:[a-f0-9]{64}$/);
assert.ok(Object.isFrozen(first));
assert.ok(Object.isFrozen(first.memories));
passed('immutable source and derived authority labels');

const repeated = await compact(firstSegment, {
  hooks: [extractiveHook, frozenMutationHook],
});
assert.equal(canonicalCompactionJson(repeated), canonicalCompactionJson(first));
assert.equal(repeated.id, first.id);
assert.equal(repeated.coverageDigest, first.coverageDigest);
passed('deterministic bytes independent of hook registration order');

const secondSegment = [message(5), message(6), message(7), message(8)];
const second = await compact(secondSegment, {
  previousCheckpoint: first,
  head: 10,
});
assert.equal(second.previousCheckpointId, first.id);
assert.equal(second.fromSequence, 5);
assert.equal(second.throughSequence, 8);
assert.notEqual(second.segmentDigest, first.segmentDigest);
assert.notEqual(second.coverageDigest, first.coverageDigest);
const secondRepeat = await compact(secondSegment, {
  previousCheckpoint: first,
  head: 10,
});
assert.equal(secondRepeat.coverageDigest, second.coverageDigest);
assert.equal(secondRepeat.id, second.id);
passed('contiguous checkpoint chain and deterministic coverage digests');

const invalidCitationHook: PreCompactionMemoryHook = {
  id: 'fixture.invalid-citation',
  version: '1',
  run() {
    return {
      summaryFragments: [
        {
          key: 'bad-citation',
          content: 'This cites a message outside the exact source segment.',
          sourceMessageIds: ['message-999'],
        },
      ],
    };
  },
};
await expectCode(
  () => compact(firstSegment, { hooks: [invalidCitationHook] }),
  'compaction_hook_output_invalid',
);
passed('invalid and cross-boundary citations fail closed');

const mixedAllOrNothingHook: PreCompactionMemoryHook = {
  id: 'fixture.valid-first',
  version: '1',
  run({ messages }) {
    return {
      summaryFragments: [
        {
          key: 'valid',
          content: 'This output is valid but must not escape a later hook failure.',
          sourceMessageIds: [messages[0]!.id],
        },
      ],
    };
  },
};
await expectCode(
  () =>
    compact(firstSegment, {
      hooks: [mixedAllOrNothingHook, invalidCitationHook],
    }),
  'compaction_hook_output_invalid',
);
passed('hook output is all-or-nothing');

const neverSettlesHook: PreCompactionMemoryHook = {
  id: 'fixture.never-settles',
  version: '1',
  run() {
    return new Promise(() => {});
  },
};
await expectCode(
  () =>
    compact(firstSegment, {
      hooks: [neverSettlesHook],
      limits: { perHookTimeoutMs: 20, totalHookTimeoutMs: 40 },
    }),
  'compaction_hook_timed_out',
);
passed('non-cooperative hooks are bounded by timeout');

const abortController = new AbortController();
setTimeout(() => abortController.abort(new Error('validator abort')), 10).unref?.();
await expectCode(
  () =>
    compact(firstSegment, {
      hooks: [neverSettlesHook],
      signal: abortController.signal,
      limits: { perHookTimeoutMs: 100, totalHookTimeoutMs: 150 },
    }),
  'compaction_aborted',
);
passed('caller abort interrupts hook wait');

const oversizeHook: PreCompactionMemoryHook = {
  id: 'fixture.oversize',
  version: '1',
  run({ messages }) {
    return {
      summaryFragments: [
        {
          key: 'oversize',
          content: 'x'.repeat(256),
          sourceMessageIds: [messages[0]!.id],
        },
      ],
    };
  },
};
await expectCode(
  () =>
    compact(firstSegment, {
      hooks: [oversizeHook],
      limits: { maxSummaryBytes: 64, maxDerivedOutputBytes: 512 },
    }),
  'compaction_limit_exceeded',
);
passed('oversize derived summaries fail closed');

const gap = [message(1), message(3, { parentId: 'message-1' })];
await expectCode(() => compact(gap), 'compaction_chain_invalid');
const wrongSession = firstSegment.map((entry, index) =>
  index === 2 ? { ...entry, sessionId: 'session-other' } : entry,
);
await expectCode(
  () => compact(wrongSession),
  'compaction_boundary_invalid',
);
passed('sequence gaps and cross-session raw input fail closed');

const badBoundary = boundary(firstSegment, 6);
badBoundary.isRunTranscriptTail = false as never;
await expectCode(
  () =>
    createTranscriptCompaction({
      messages: firstSegment,
      boundary: badBoundary,
      policyRevision: POLICY_REVISION,
      generator: GENERATOR,
      hooks: [extractiveHook],
      limits: { minimumRawTailMessages: 2 },
    }),
  'compaction_boundary_invalid',
);
passed('caller terminal-boundary facts are mandatory');

assert.equal(results.length, 10);
process.stdout.write(
  `Transcript compaction core validation passed: ${results.length}/${results.length} hostile and deterministic vectors.\n`,
);
