import type {
  TranscriptWindow,
  WorkbenchEvent,
  WorkbenchRun,
} from '@codewave/protocol';

export type RunViewSummary = Pick<
  WorkbenchRun,
  'id' | 'status' | 'mode' | 'createdAt' | 'completedAt' | 'prompt'
> & {
  providerConfigurationRevision?: string;
};

type RunViewEvent = Pick<
  WorkbenchEvent,
  'id' | 'sequence' | 'type' | 'timestamp'
> & {
  payload?: unknown;
};

export type RunViewState = {
  selectedSessionId: string | null;
  runs: RunViewSummary[];
  selectedRun: RunViewSummary | null;
  events: RunViewEvent[];
  transcript: TranscriptWindow | null;
  contextChars: number;
  undoAvailable: boolean;
  undoDetail: string | null;
};

export const emptyRunViewState: RunViewState = {
  selectedSessionId: null,
  runs: [],
  selectedRun: null,
  events: [],
  transcript: null,
  contextChars: 0,
  undoAvailable: false,
  undoDetail: null,
};
