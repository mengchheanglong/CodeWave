import { createHash } from 'node:crypto';
import type { TranscriptMessage } from '@codewave/protocol';

export const TRANSCRIPT_COMPACTION_SCHEMA_VERSION =
  'codewave-transcript-compaction-v1' as const;
export const TRANSCRIPT_COMPACTION_AUTHORITY =
  'derived-non-authoritative' as const;

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const MEMORY_KINDS = new Set([
  'fact',
  'decision',
  'constraint',
  'preference',
  'open-question',
]);

export type TranscriptCompactionErrorCode =
  | 'compaction_aborted'
  | 'compaction_boundary_invalid'
  | 'compaction_chain_invalid'
  | 'compaction_hook_failed'
  | 'compaction_hook_output_invalid'
  | 'compaction_hook_timed_out'
  | 'compaction_input_invalid'
  | 'compaction_limit_exceeded';

export class TranscriptCompactionError extends Error {
  constructor(
    readonly code: TranscriptCompactionErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TranscriptCompactionError';
  }
}

export type TranscriptCompactionLimits = {
  maxSourceMessages: number;
  maxSourceBytes: number;
  minimumRawTailMessages: number;
  maxHooks: number;
  perHookTimeoutMs: number;
  totalHookTimeoutMs: number;
  maxSummaryBytes: number;
  maxMemoryCandidates: number;
  maxMemoryCandidateBytes: number;
  maxDerivedOutputBytes: number;
  maxCitationsPerOutput: number;
};

export const DEFAULT_TRANSCRIPT_COMPACTION_LIMITS = Object.freeze({
  maxSourceMessages: 100,
  maxSourceBytes: 256 * 1024,
  minimumRawTailMessages: 32,
  maxHooks: 8,
  perHookTimeoutMs: 5_000,
  totalHookTimeoutMs: 15_000,
  maxSummaryBytes: 32 * 1024,
  maxMemoryCandidates: 16,
  maxMemoryCandidateBytes: 4 * 1024,
  maxDerivedOutputBytes: 32 * 1024,
  maxCitationsPerOutput: 64,
}) satisfies Readonly<TranscriptCompactionLimits>;

export type TranscriptCompactionBoundary = {
  sessionId: string;
  transcriptHeadSequence: number;
  throughSequence: number;
  throughMessageId: string;
  throughRunId: string;
  throughRunStatus: 'completed' | 'failed' | 'cancelled';
  isRunTranscriptTail: true;
};

export type TranscriptCompactionGenerator = {
  id: string;
  version: string;
  kind: 'local-deterministic';
};

export type PreCompactionSummaryFragment = {
  key: string;
  content: string;
  sourceMessageIds: readonly string[];
};

export type PreCompactionMemoryCandidate = {
  key: string;
  kind: 'fact' | 'decision' | 'constraint' | 'preference' | 'open-question';
  content: string;
  sourceMessageIds: readonly string[];
};

export type PreCompactionHookOutput = {
  summaryFragments: readonly PreCompactionSummaryFragment[];
  memories?: readonly PreCompactionMemoryCandidate[];
};

export type PreCompactionHookInput = {
  sessionId: string;
  fromSequence: number;
  throughSequence: number;
  previousCheckpoint:
    | {
        id: string;
        fromSequence: number;
        throughSequence: number;
        coverageDigest: string;
      }
    | TranscriptCompactionCheckpoint
    | null;
  messages: readonly TranscriptMessage[];
  limits: Readonly<TranscriptCompactionLimits>;
  signal: AbortSignal;
};

export type PreCompactionMemoryHook = {
  id: string;
  version: string;
  run: (
    input: Readonly<PreCompactionHookInput>,
  ) => PreCompactionHookOutput | Promise<PreCompactionHookOutput>;
};

export type TranscriptCompactionSummaryFragment = {
  hookId: string;
  hookVersion: string;
  key: string;
  content: string;
  sourceMessageIds: string[];
};

export type TranscriptCompactionMemory = {
  id: string;
  hookId: string;
  hookVersion: string;
  key: string;
  kind: PreCompactionMemoryCandidate['kind'];
  content: string;
  sourceMessageIds: string[];
  authority: typeof TRANSCRIPT_COMPACTION_AUTHORITY;
};

export type TranscriptCompactionHookResult = {
  hookId: string;
  hookVersion: string;
  summaryFragments: TranscriptCompactionSummaryFragment[];
  memories: Omit<TranscriptCompactionMemory, 'id'>[];
};

export type TranscriptCompactionCheckpoint = {
  schemaVersion: typeof TRANSCRIPT_COMPACTION_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  previousCheckpointId: string | null;
  fromSequence: number;
  throughSequence: number;
  throughMessageId: string;
  throughRunId: string;
  sourceMessageCount: number;
  segmentDigest: string;
  coverageDigest: string;
  outputDigest: string;
  policyRevision: string;
  generator: TranscriptCompactionGenerator;
  authority: typeof TRANSCRIPT_COMPACTION_AUTHORITY;
  summaryText: string;
  summaryFragments: TranscriptCompactionSummaryFragment[];
  memories: TranscriptCompactionMemory[];
  hookResults: TranscriptCompactionHookResult[];
  createdAt: string;
};

export type CreateTranscriptCompactionInput = {
  messages: readonly TranscriptMessage[];
  boundary: TranscriptCompactionBoundary;
  previousCheckpoint?:
    | {
        id: string;
        sessionId?: string;
        fromSequence: number;
        throughSequence: number;
        throughMessageId?: string;
        segmentDigest?: string;
        coverageDigest: string;
        outputDigest?: string;
        schemaVersion?: string;
        authority?: string;
      }
    | TranscriptCompactionCheckpoint
    | null;
  policyRevision: string;
  generator: TranscriptCompactionGenerator;
  hooks: readonly PreCompactionMemoryHook[];
  limits?: Partial<TranscriptCompactionLimits>;
  signal?: AbortSignal;
  createdAt?: string;
};

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function hasValidUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function hasForbiddenControl(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function validateText(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new TranscriptCompactionError(
      'compaction_input_invalid',
      `${label} must be ${allowEmpty ? 'text' : 'non-empty text'}.`,
    );
  }
  if (!hasValidUnicode(value) || hasForbiddenControl(value)) {
    throw new TranscriptCompactionError(
      'compaction_input_invalid',
      `${label} contains invalid Unicode or control characters.`,
    );
  }
  return value;
}

function validateIdentifier(value: unknown, label: string): string {
  const text = validateText(value, label);
  if (!SAFE_IDENTIFIER_PATTERN.test(text)) {
    throw new TranscriptCompactionError(
      'compaction_input_invalid',
      `${label} must match ${SAFE_IDENTIFIER_PATTERN.source}.`,
    );
  }
  return text;
}

function assertPlainRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TranscriptCompactionError(
      'compaction_hook_output_invalid',
      `${label} must be a plain object.`,
    );
  }
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const unknownKey = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknownKey) {
    throw new TranscriptCompactionError(
      'compaction_hook_output_invalid',
      `${label} contains undeclared property '${unknownKey}'.`,
    );
  }
}

function toCanonicalValue(
  value: unknown,
  path: string,
  seen: Set<object>,
): CanonicalValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && !hasValidUnicode(value)) {
      throw new TranscriptCompactionError(
        'compaction_input_invalid',
        `${path} contains invalid Unicode.`,
      );
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TranscriptCompactionError(
        'compaction_input_invalid',
        `${path} contains a non-finite number.`,
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== 'object') {
    throw new TranscriptCompactionError(
      'compaction_input_invalid',
      `${path} contains a non-canonical value.`,
    );
  }
  if (seen.has(value)) {
    throw new TranscriptCompactionError(
      'compaction_input_invalid',
      `${path} contains a circular reference.`,
    );
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result: CanonicalValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new TranscriptCompactionError(
            'compaction_input_invalid',
            `${path} contains a sparse array.`,
          );
        }
        result.push(toCanonicalValue(value[index], `${path}[${index}]`, seen));
      }
      return result;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TranscriptCompactionError(
        'compaction_input_invalid',
        `${path} contains a non-plain object.`,
      );
    }
    const record = value as Record<string, unknown>;
    const result: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(record).sort()) {
      if (!hasValidUnicode(key)) {
        throw new TranscriptCompactionError(
          'compaction_input_invalid',
          `${path} contains an invalid object key.`,
        );
      }
      result[key] = toCanonicalValue(record[key], `${path}.${key}`, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function canonicalCompactionJson(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value, '$', new Set()));
}

function sha256(domain: string, value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(domain)
    .update('\0')
    .update(canonicalCompactionJson(value))
    .digest('hex')}`;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalCompactionJson(value)) as T;
}

function positiveInteger(value: unknown, label: string, allowZero = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1)
  ) {
    throw new TranscriptCompactionError(
      'compaction_input_invalid',
      `${label} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer.`,
    );
  }
  return value;
}

function resolveLimits(
  overrides: Partial<TranscriptCompactionLimits> | undefined,
): TranscriptCompactionLimits {
  const limits = {
    ...DEFAULT_TRANSCRIPT_COMPACTION_LIMITS,
    ...(overrides ?? {}),
  };
  for (const key of Object.keys(limits) as Array<keyof TranscriptCompactionLimits>) {
    const allowZero = key === 'minimumRawTailMessages';
    positiveInteger(limits[key], `limits.${key}`, allowZero);
    if (limits[key] > DEFAULT_TRANSCRIPT_COMPACTION_LIMITS[key]) {
      throw new TranscriptCompactionError(
        'compaction_limit_exceeded',
        `limits.${key} cannot exceed the v1 hard ceiling ${DEFAULT_TRANSCRIPT_COMPACTION_LIMITS[key]}.`,
      );
    }
  }
  if (limits.totalHookTimeoutMs < limits.perHookTimeoutMs) {
    throw new TranscriptCompactionError(
      'compaction_input_invalid',
      'The total hook timeout cannot be shorter than the per-hook timeout.',
    );
  }
  return Object.freeze(limits);
}

function validatePreviousCheckpoint(
  checkpoint: {
    id: string;
    schemaVersion?: string;
    authority?: string;
    sessionId?: string;
    segmentDigest?: string;
    coverageDigest: string;
    outputDigest?: string;
    fromSequence: number;
    throughSequence: number;
    throughMessageId?: string;
  },
  sessionId: string,
): void {
  if (
    (checkpoint.schemaVersion && checkpoint.schemaVersion !== TRANSCRIPT_COMPACTION_SCHEMA_VERSION) ||
    (checkpoint.authority && checkpoint.authority !== TRANSCRIPT_COMPACTION_AUTHORITY) ||
    (checkpoint.sessionId && checkpoint.sessionId !== sessionId) ||
    (checkpoint.segmentDigest && !DIGEST_PATTERN.test(checkpoint.segmentDigest)) ||
    !DIGEST_PATTERN.test(checkpoint.coverageDigest) ||
    (checkpoint.outputDigest && !DIGEST_PATTERN.test(checkpoint.outputDigest))
  ) {
    throw new TranscriptCompactionError(
      'compaction_chain_invalid',
      'The previous compaction checkpoint is incompatible or belongs to another session.',
    );
  }
  positiveInteger(checkpoint.fromSequence, 'previousCheckpoint.fromSequence');
  positiveInteger(checkpoint.throughSequence, 'previousCheckpoint.throughSequence');
  if (checkpoint.fromSequence > checkpoint.throughSequence) {
    throw new TranscriptCompactionError(
      'compaction_chain_invalid',
      'The previous checkpoint has inverted sequence bounds.',
    );
  }
}

function validateAndFreezeMessages(
  inputMessages: readonly TranscriptMessage[],
  boundary: TranscriptCompactionBoundary,
  previousCheckpoint: { throughSequence: number; throughMessageId?: string } | null,
  limits: TranscriptCompactionLimits,
): {
  sourceMessages: readonly TranscriptMessage[];
  sourceCanonicalJson: string;
  fromSequence: number;
} {
  const fromSequence = previousCheckpoint
    ? previousCheckpoint.throughSequence + 1
    : 1;
  if (inputMessages.length === 0) {
    throw new TranscriptCompactionError(
      'compaction_input_invalid',
      'A compaction segment requires at least one transcript message.',
    );
  }
  if (inputMessages.length > limits.maxSourceMessages) {
    throw new TranscriptCompactionError(
      'compaction_limit_exceeded',
      `The compaction segment exceeds ${limits.maxSourceMessages} messages.`,
    );
  }

  const sourceCanonicalJson = canonicalCompactionJson(inputMessages);
  if (utf8Bytes(sourceCanonicalJson) > limits.maxSourceBytes) {
    throw new TranscriptCompactionError(
      'compaction_limit_exceeded',
      `The compaction segment exceeds ${limits.maxSourceBytes} UTF-8 bytes.`,
    );
  }
  const sourceMessages = deepFreeze(
    canonicalClone(inputMessages) as TranscriptMessage[],
  ) as readonly TranscriptMessage[];
  const seenIds = new Set<string>();
  for (let index = 0; index < sourceMessages.length; index += 1) {
    const message = sourceMessages[index]!;
    validateText(message.id, `messages[${index}].id`);
    validateText(message.sessionId, `messages[${index}].sessionId`);
    validateText(message.runId, `messages[${index}].runId`);
    validateText(message.content, `messages[${index}].content`);
    validateText(message.createdAt, `messages[${index}].createdAt`);
    if (message.sessionId !== boundary.sessionId) {
      throw new TranscriptCompactionError(
        'compaction_boundary_invalid',
        'Every source message must belong to the compacted session.',
      );
    }
    if (seenIds.has(message.id)) {
      throw new TranscriptCompactionError(
        'compaction_input_invalid',
        `Transcript message id '${message.id}' is duplicated.`,
      );
    }
    seenIds.add(message.id);
    const expectedSequence = fromSequence + index;
    if (message.sequence !== expectedSequence) {
      throw new TranscriptCompactionError(
        'compaction_chain_invalid',
        `Expected transcript sequence ${expectedSequence}, received ${message.sequence}.`,
      );
    }
    const expectedParent =
      index === 0
        ? previousCheckpoint?.throughMessageId ?? null
        : sourceMessages[index - 1]!.id;
    if (message.parentMessageId !== expectedParent) {
      throw new TranscriptCompactionError(
        'compaction_chain_invalid',
        `Transcript message ${message.id} does not link to the expected parent.`,
      );
    }
    if (!['user', 'assistant', 'system'].includes(message.role)) {
      throw new TranscriptCompactionError(
        'compaction_input_invalid',
        `Transcript message ${message.id} has an unsupported role.`,
      );
    }
  }
  return { sourceMessages, sourceCanonicalJson, fromSequence };
}

function validateBoundary(
  boundary: TranscriptCompactionBoundary,
  messages: readonly TranscriptMessage[],
  fromSequence: number,
  limits: TranscriptCompactionLimits,
): void {
  validateText(boundary.sessionId, 'boundary.sessionId');
  positiveInteger(boundary.transcriptHeadSequence, 'boundary.transcriptHeadSequence');
  positiveInteger(boundary.throughSequence, 'boundary.throughSequence');
  validateText(boundary.throughMessageId, 'boundary.throughMessageId');
  validateText(boundary.throughRunId, 'boundary.throughRunId');
  if (
    !TERMINAL_RUN_STATUSES.has(boundary.throughRunStatus) ||
    boundary.isRunTranscriptTail !== true
  ) {
    throw new TranscriptCompactionError(
      'compaction_boundary_invalid',
      'Compaction must end at the transcript tail of a terminal run.',
    );
  }
  const last = messages.at(-1)!;
  if (
    last.sequence !== boundary.throughSequence ||
    last.id !== boundary.throughMessageId ||
    last.runId !== boundary.throughRunId ||
    boundary.throughSequence !== fromSequence + messages.length - 1
  ) {
    throw new TranscriptCompactionError(
      'compaction_boundary_invalid',
      'The source segment does not end at the declared terminal-run boundary.',
    );
  }
  if (
    boundary.transcriptHeadSequence < boundary.throughSequence ||
    boundary.transcriptHeadSequence - boundary.throughSequence <
      limits.minimumRawTailMessages
  ) {
    throw new TranscriptCompactionError(
      'compaction_boundary_invalid',
      `At least ${limits.minimumRawTailMessages} newer raw messages must remain outside the checkpoint.`,
    );
  }
}

function normalizeCitations(
  value: unknown,
  label: string,
  sourceOrder: Map<string, number>,
  limits: TranscriptCompactionLimits,
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TranscriptCompactionError(
      'compaction_hook_output_invalid',
      `${label} requires at least one source-message citation.`,
    );
  }
  if (value.length > limits.maxCitationsPerOutput) {
    throw new TranscriptCompactionError(
      'compaction_limit_exceeded',
      `${label} exceeds ${limits.maxCitationsPerOutput} citations.`,
    );
  }
  const citations = new Set<string>();
  for (const citation of value) {
    const id = validateText(citation, `${label} citation`);
    if (!sourceOrder.has(id)) {
      throw new TranscriptCompactionError(
        'compaction_hook_output_invalid',
        `${label} cites message '${id}' outside the exact compaction segment.`,
      );
    }
    citations.add(id);
  }
  return [...citations].sort(
    (left, right) => sourceOrder.get(left)! - sourceOrder.get(right)!,
  );
}

function normalizeHookOutput(
  hook: PreCompactionMemoryHook,
  output: unknown,
  sourceOrder: Map<string, number>,
  limits: TranscriptCompactionLimits,
): TranscriptCompactionHookResult {
  assertPlainRecord(output, `Hook ${hook.id} output`);
  assertAllowedKeys(output, ['summaryFragments', 'memories'], `Hook ${hook.id} output`);
  if (!Array.isArray(output.summaryFragments)) {
    throw new TranscriptCompactionError(
      'compaction_hook_output_invalid',
      `Hook ${hook.id} must return summaryFragments.`,
    );
  }
  const summaryKeys = new Set<string>();
  const summaryFragments = output.summaryFragments.map((raw, index) => {
    assertPlainRecord(raw, `Hook ${hook.id} summary fragment ${index}`);
    assertAllowedKeys(
      raw,
      ['key', 'content', 'sourceMessageIds'],
      `Hook ${hook.id} summary fragment ${index}`,
    );
    const key = validateIdentifier(raw.key, `Hook ${hook.id} summary key`);
    if (summaryKeys.has(key)) {
      throw new TranscriptCompactionError(
        'compaction_hook_output_invalid',
        `Hook ${hook.id} returned duplicate summary key '${key}'.`,
      );
    }
    summaryKeys.add(key);
    const content = validateText(raw.content, `Hook ${hook.id} summary content`);
    return {
      hookId: hook.id,
      hookVersion: hook.version,
      key,
      content,
      sourceMessageIds: normalizeCitations(
        raw.sourceMessageIds,
        `Hook ${hook.id} summary '${key}'`,
        sourceOrder,
        limits,
      ),
    };
  });
  summaryFragments.sort((left, right) => left.key.localeCompare(right.key, 'en'));

  const rawMemories = output.memories ?? [];
  if (!Array.isArray(rawMemories)) {
    throw new TranscriptCompactionError(
      'compaction_hook_output_invalid',
      `Hook ${hook.id} memories must be an array.`,
    );
  }
  const memoryKeys = new Set<string>();
  const memories = rawMemories.map((raw, index) => {
    assertPlainRecord(raw, `Hook ${hook.id} memory ${index}`);
    assertAllowedKeys(
      raw,
      ['key', 'kind', 'content', 'sourceMessageIds'],
      `Hook ${hook.id} memory ${index}`,
    );
    const key = validateIdentifier(raw.key, `Hook ${hook.id} memory key`);
    if (memoryKeys.has(key)) {
      throw new TranscriptCompactionError(
        'compaction_hook_output_invalid',
        `Hook ${hook.id} returned duplicate memory key '${key}'.`,
      );
    }
    memoryKeys.add(key);
    if (typeof raw.kind !== 'string' || !MEMORY_KINDS.has(raw.kind)) {
      throw new TranscriptCompactionError(
        'compaction_hook_output_invalid',
        `Hook ${hook.id} memory '${key}' has an unsupported kind.`,
      );
    }
    const content = validateText(raw.content, `Hook ${hook.id} memory content`);
    if (utf8Bytes(content) > limits.maxMemoryCandidateBytes) {
      throw new TranscriptCompactionError(
        'compaction_limit_exceeded',
        `Hook ${hook.id} memory '${key}' exceeds ${limits.maxMemoryCandidateBytes} UTF-8 bytes.`,
      );
    }
    return {
      hookId: hook.id,
      hookVersion: hook.version,
      key,
      kind: raw.kind as PreCompactionMemoryCandidate['kind'],
      content,
      sourceMessageIds: normalizeCitations(
        raw.sourceMessageIds,
        `Hook ${hook.id} memory '${key}'`,
        sourceOrder,
        limits,
      ),
      authority: TRANSCRIPT_COMPACTION_AUTHORITY,
    };
  });
  memories.sort((left, right) => left.key.localeCompare(right.key, 'en'));
  return { hookId: hook.id, hookVersion: hook.version, summaryFragments, memories };
}

async function runHook(
  hook: PreCompactionMemoryHook,
  input: Readonly<PreCompactionHookInput>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<PreCompactionHookOutput> {
  if (parentSignal?.aborted) {
    throw new TranscriptCompactionError(
      'compaction_aborted',
      'Transcript compaction was aborted.',
    );
  }
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  let timer: NodeJS.Timeout | undefined;
  let rejectBoundary!: (error: TranscriptCompactionError) => void;
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject;
    timer = setTimeout(() => {
      controller.abort(new Error(`Hook ${hook.id} timed out.`));
      reject(
        new TranscriptCompactionError(
          'compaction_hook_timed_out',
          `Pre-compaction hook ${hook.id} exceeded ${timeoutMs} ms.`,
        ),
      );
    }, timeoutMs);
  });
  const onAbort = () => {
    rejectBoundary(
      new TranscriptCompactionError(
        'compaction_aborted',
        'Transcript compaction was aborted.',
      ),
    );
  };
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  const hookPromise = Promise.resolve().then(() =>
    hook.run({ ...input, signal: controller.signal }),
  );
  // A timed-out hook may ignore its AbortSignal. Always observe its eventual
  // rejection so it cannot become an unhandled process error.
  void hookPromise.catch(() => undefined);
  try {
    return await Promise.race([hookPromise, boundary]);
  } catch (error) {
    if (error instanceof TranscriptCompactionError) throw error;
    throw new TranscriptCompactionError(
      'compaction_hook_failed',
      `Pre-compaction hook ${hook.id} failed.`,
      { cause: error },
    );
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

export async function createTranscriptCompaction(
  input: CreateTranscriptCompactionInput,
): Promise<TranscriptCompactionCheckpoint> {
  if (input.signal?.aborted) {
    throw new TranscriptCompactionError(
      'compaction_aborted',
      'Transcript compaction was aborted.',
    );
  }
  const limits = resolveLimits(input.limits);
  const policyRevision = validateText(input.policyRevision, 'policyRevision');
  if (!DIGEST_PATTERN.test(policyRevision)) {
    throw new TranscriptCompactionError(
      'compaction_input_invalid',
      'policyRevision must be a sha256 digest.',
    );
  }
  const generator: TranscriptCompactionGenerator = {
    id: validateIdentifier(input.generator.id, 'generator.id'),
    version: validateIdentifier(input.generator.version, 'generator.version'),
    kind: input.generator.kind,
  };
  if (generator.kind !== 'local-deterministic') {
    throw new TranscriptCompactionError(
      'compaction_input_invalid',
      'Compaction v1 accepts only local deterministic generators.',
    );
  }
  const previousCheckpoint = input.previousCheckpoint ?? null;
  if (previousCheckpoint) {
    validatePreviousCheckpoint(previousCheckpoint, input.boundary.sessionId);
  }
  const originalCanonicalJson = canonicalCompactionJson(input.messages);
  const { sourceMessages, sourceCanonicalJson, fromSequence } =
    validateAndFreezeMessages(
      input.messages,
      input.boundary,
      previousCheckpoint,
      limits,
    );
  validateBoundary(input.boundary, sourceMessages, fromSequence, limits);

  if (input.hooks.length === 0) {
    throw new TranscriptCompactionError(
      'compaction_input_invalid',
      'At least one local deterministic pre-compaction hook is required.',
    );
  }
  if (input.hooks.length > limits.maxHooks) {
    throw new TranscriptCompactionError(
      'compaction_limit_exceeded',
      `Compaction v1 permits at most ${limits.maxHooks} hooks.`,
    );
  }
  const hooks = [...input.hooks].map((hook) => ({
    ...hook,
    id: validateIdentifier(hook.id, 'hook.id'),
    version: validateIdentifier(hook.version, `hook ${hook.id} version`),
  }));
  hooks.sort(
    (left, right) =>
      left.id.localeCompare(right.id, 'en') ||
      left.version.localeCompare(right.version, 'en'),
  );
  for (let index = 1; index < hooks.length; index += 1) {
    if (hooks[index - 1]!.id === hooks[index]!.id) {
      throw new TranscriptCompactionError(
        'compaction_input_invalid',
        `Pre-compaction hook id '${hooks[index]!.id}' is duplicated.`,
      );
    }
  }

  const segmentDigest = sha256('codewave-transcript-segment-v1', sourceMessages);
  const coverageDigest = sha256('codewave-transcript-coverage-v1', {
    previousCoverageDigest: previousCheckpoint?.coverageDigest ?? null,
    segmentDigest,
    fromSequence,
    throughSequence: input.boundary.throughSequence,
  });
  const sourceOrder = new Map(
    sourceMessages.map((message, index) => [message.id, index]),
  );
  const safePrevious = previousCheckpoint
    ? (deepFreeze(canonicalClone(previousCheckpoint)) as TranscriptCompactionCheckpoint)
    : null;
  const hookInput = deepFreeze({
    sessionId: input.boundary.sessionId,
    fromSequence,
    throughSequence: input.boundary.throughSequence,
    previousCheckpoint: safePrevious,
    messages: sourceMessages,
    limits,
    signal: new AbortController().signal,
  }) as unknown as Readonly<PreCompactionHookInput>;
  const hookResults: TranscriptCompactionHookResult[] = [];
  const startedAt = Date.now();
  for (const hook of hooks) {
    const remainingMs = limits.totalHookTimeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new TranscriptCompactionError(
        'compaction_hook_timed_out',
        `The pre-compaction hook set exceeded ${limits.totalHookTimeoutMs} ms.`,
      );
    }
    const output = await runHook(
      hook,
      hookInput,
      input.signal,
      Math.min(limits.perHookTimeoutMs, remainingMs),
    );
    hookResults.push(normalizeHookOutput(hook, output, sourceOrder, limits));
  }

  if (canonicalCompactionJson(input.messages) !== originalCanonicalJson) {
    throw new TranscriptCompactionError(
      'compaction_hook_failed',
      'A pre-compaction hook attempted to mutate the source transcript.',
    );
  }
  if (sourceCanonicalJson !== canonicalCompactionJson(sourceMessages)) {
    throw new TranscriptCompactionError(
      'compaction_hook_failed',
      'The immutable hook transcript view changed during compaction.',
    );
  }

  const summaryFragments = hookResults.flatMap((result) => result.summaryFragments);
  if (summaryFragments.length === 0) {
    throw new TranscriptCompactionError(
      'compaction_hook_output_invalid',
      'The hook set did not produce a cited derived summary.',
    );
  }
  const summaryText = summaryFragments
    .map((fragment) => fragment.content)
    .join('\n\n');
  if (utf8Bytes(summaryText) > limits.maxSummaryBytes) {
    throw new TranscriptCompactionError(
      'compaction_limit_exceeded',
      `The derived summary exceeds ${limits.maxSummaryBytes} UTF-8 bytes.`,
    );
  }
  const pendingMemories = hookResults.flatMap((result) => result.memories);
  if (pendingMemories.length > limits.maxMemoryCandidates) {
    throw new TranscriptCompactionError(
      'compaction_limit_exceeded',
      `The hook set produced more than ${limits.maxMemoryCandidates} memory candidates.`,
    );
  }
  const derivedBytes = utf8Bytes(
    canonicalCompactionJson({ summaryFragments, memories: pendingMemories }),
  );
  if (derivedBytes > limits.maxDerivedOutputBytes) {
    throw new TranscriptCompactionError(
      'compaction_limit_exceeded',
      `Derived hook output exceeds ${limits.maxDerivedOutputBytes} UTF-8 bytes.`,
    );
  }
  const outputDigest = sha256('codewave-transcript-derived-output-v1', hookResults);
  const id = `transcript-compaction:${sha256(
    'codewave-transcript-compaction-id-v1',
    {
      sessionId: input.boundary.sessionId,
      previousCheckpointId: previousCheckpoint?.id ?? null,
      fromSequence,
      throughSequence: input.boundary.throughSequence,
      throughMessageId: input.boundary.throughMessageId,
      throughRunId: input.boundary.throughRunId,
      segmentDigest,
      coverageDigest,
      outputDigest,
      policyRevision,
      generator,
    },
  ).slice('sha256:'.length)}`;
  const memories: TranscriptCompactionMemory[] = pendingMemories.map((memory) => ({
    ...memory,
    id: `transcript-memory:${sha256('codewave-transcript-memory-id-v1', {
      checkpointId: id,
      ...memory,
    }).slice('sha256:'.length)}`,
  }));

  return deepFreeze({
    schemaVersion: TRANSCRIPT_COMPACTION_SCHEMA_VERSION,
    id,
    sessionId: input.boundary.sessionId,
    previousCheckpointId: previousCheckpoint?.id ?? null,
    fromSequence,
    throughSequence: input.boundary.throughSequence,
    throughMessageId: input.boundary.throughMessageId,
    throughRunId: input.boundary.throughRunId,
    sourceMessageCount: sourceMessages.length,
    segmentDigest,
    coverageDigest,
    outputDigest,
    policyRevision,
    generator,
    authority: TRANSCRIPT_COMPACTION_AUTHORITY,
    summaryText,
    summaryFragments,
    memories,
    hookResults,
    createdAt:
      input.createdAt ??
      sourceMessages.at(-1)?.createdAt ??
      new Date().toISOString(),
  }) as TranscriptCompactionCheckpoint;
}

export function createDeterministicTranscriptSummaryHook(options?: {
  maxExcerptCharacters?: number;
}): PreCompactionMemoryHook {
  const maxExcerptCharacters = Math.max(
    32,
    Math.min(Math.trunc(options?.maxExcerptCharacters ?? 240), 1_024),
  );
  return {
    id: 'codewave.extractive-transcript',
    version: '1',
    run({ messages }) {
      const content = messages
        .map((message) => {
          const normalized = message.content.replace(/\s+/gu, ' ').trim();
          const excerpt =
            normalized.length > maxExcerptCharacters
              ? `${normalized.slice(0, maxExcerptCharacters - 1)}…`
              : normalized;
          return `[${message.sequence} · ${message.role}] ${excerpt}`;
        })
        .join('\n');
      return {
        summaryFragments: [
          {
            key: 'extractive-segment',
            content,
            sourceMessageIds: messages.map((message) => message.id),
          },
        ],
        memories: [],
      };
    },
  };
}
