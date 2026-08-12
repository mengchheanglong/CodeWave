import type { WorkbenchEvent, WorkbenchRun } from '@qwemini/protocol';

export type RunViewSummary = Pick<
  WorkbenchRun,
  'id' | 'status' | 'mode' | 'createdAt' | 'completedAt' | 'prompt'
>;

type RunViewEvent = Pick<WorkbenchEvent, 'type' | 'timestamp'> & {
  payload?: unknown;
};

export type RunViewState = {
  selectedSessionId: string | null;
  runs: RunViewSummary[];
  selectedRun: RunViewSummary | null;
  events: RunViewEvent[];
  contextChars: number;
  undoAvailable: boolean;
  undoDetail: string | null;
};

export const emptyRunViewState: RunViewState = {
  selectedSessionId: null,
  runs: [],
  selectedRun: null,
  events: [],
  contextChars: 0,
  undoAvailable: false,
  undoDetail: null,
};
