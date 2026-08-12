import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompareRunResponse, ProviderId, WorkbenchEvent } from '@codewave/protocol';
import type { DaemonApi } from '../lib/daemon-api';
import { buildTimelineSteps, type TimelineStep } from '../lib/run-inspector-views';
import { StepTimeline } from './StepTimeline';
import { CheckIcon, ScaleIcon, XIcon } from './icons';

const PROVIDER_OPTIONS: ProviderId[] = ['freebuff', 'opencode', 'qwen', 'gemini'];

type CompareLaneState = {
  providerId: ProviderId;
  runId: string | null;
  sessionId: string | null;
  events: WorkbenchEvent[];
  status: 'idle' | 'starting' | 'running' | 'completed' | 'failed';
  detail: string | null;
};

function buildEmptyLanes(providers: ProviderId[]): CompareLaneState[] {
  return providers.map((providerId) => ({
    providerId,
    runId: null,
    sessionId: null,
    events: [],
    status: 'idle',
    detail: null,
  }));
}

function summarizeStatus(status: CompareLaneState['status']): string {
  switch (status) {
    case 'starting':
      return 'Starting…';
    case 'running':
      return 'Running…';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return 'Ready';
  }
}

function laneSteps(lane: CompareLaneState): TimelineStep[] {
  return buildTimelineSteps(
    lane.runId
      ? { id: lane.runId, status: 'completed', mode: 'execute', createdAt: '', completedAt: null, prompt: '' }
      : null,
    lane.events,
  );
}

type ComparePanelProps = {
  open: boolean;
  prompt: string;
  workspacePath: string;
  providerRevision: string | null;
  api: DaemonApi;
  onClose: () => void;
  formatTimestamp: (timestamp: string) => string;
};

export function ComparePanel({
  open,
  prompt,
  workspacePath,
  providerRevision,
  api,
  onClose,
  formatTimestamp,
}: ComparePanelProps) {
  const [selected, setSelected] = useState<ProviderId[]>([
    'freebuff',
    'opencode',
  ]);
  const [lanes, setLanes] = useState<CompareLaneState[]>(() =>
    buildEmptyLanes(['freebuff', 'opencode']),
  );
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRefs = useRef<EventSource[]>([]);

  useEffect(() => {
    if (!open) {
      for (const source of sourceRefs.current) {
        source.close();
      }
      sourceRefs.current = [];
      setStarted(false);
      setError(null);
      setLanes(buildEmptyLanes(selected));
    }
  }, [open, selected]);

  function toggleProvider(providerId: ProviderId) {
    setSelected((current) => {
      if (current.includes(providerId)) {
        return current.length > 2 ? current.filter((id) => id !== providerId) : current;
      }
      return [...current, providerId];
    });
  }

  async function startCompare() {
    if (selected.length < 2) {
      setError('Choose at least two providers to compare.');
      return;
    }
    if (!prompt.trim()) {
      setError('Type a prompt first.');
      return;
    }
    if (!providerRevision) {
      setError('Provider policy is unavailable. Refresh the runtime and retry.');
      return;
    }

    setStarted(true);
    setError(null);
    setLanes(buildEmptyLanes(selected));

    let response: CompareRunResponse;
    try {
      response = await api.compareRun({
        prompt,
        workspacePath,
        providers: selected,
        expectedProviderRevision: providerRevision,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStarted(false);
      return;
    }

    setLanes((current) =>
      current.map((lane) => {
        const match = response.lanes.find((entry) => entry.providerId === lane.providerId);
        if (!match) {
          return lane;
        }
        return {
          ...lane,
          runId: match.runSnapshot.run.id,
          sessionId: match.sessionId,
          events: match.runSnapshot.events,
          status: 'running',
        };
      }),
    );

    for (const lane of response.lanes) {
      let streamUrl: string;
      try {
        streamUrl = await api.getRunStreamUrl(lane.runSnapshot.run.id);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Live comparison stream negotiation failed.',
        );
        setLanes((current) =>
          current.map((entry) =>
            entry.providerId === lane.providerId
              ? { ...entry, status: 'failed', detail: 'Stream unavailable' }
              : entry,
          ),
        );
        continue;
      }
      const source = new EventSource(streamUrl);
      sourceRefs.current.push(source);
      source.onmessage = (message) => {
        let event: WorkbenchEvent;
        try {
          event = JSON.parse(message.data) as WorkbenchEvent;
        } catch {
          return;
        }

        setLanes((current) =>
          current.map((entry) => {
            if (entry.providerId !== lane.providerId) {
              return entry;
            }
            const next: CompareLaneState = {
              ...entry,
              events: [...entry.events, event],
            };
            if (event.type === 'run.completed') {
              next.status = 'completed';
            } else if (event.type === 'run.failed' || event.type === 'run.cancelled') {
              next.status = 'failed';
            } else if (event.type === 'tool.started' || event.type === 'message.created') {
              next.status = 'running';
            }
            return next;
          }),
        );
      };
    }
  }

  const providerOptions = useMemo(
    () => PROVIDER_OPTIONS.filter((providerId) => providerId !== 'qwen' || selected.length > 0),
    [selected],
  );

  if (!open) {
    return null;
  }

  return (
    <div
      className="compare-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Compare providers"
    >
      <div className="compare-panel">
        <header className="compare-panel-header">
          <span className="compare-panel-title">
            <ScaleIcon size={15} />
            Compare providers
          </span>
          <button
            type="button"
            className="compare-panel-close"
            onClick={onClose}
            aria-label="Close compare"
          >
            <XIcon size={14} />
          </button>
        </header>

        {!started ? (
          <div className="compare-setup">
            <div className="compare-provider-pick">
              {providerOptions.map((providerId) => (
                <button
                  key={providerId}
                  type="button"
                  className={`compare-provider-option${
                    selected.includes(providerId) ? ' active' : ''
                  }`}
                  onClick={() => {
                    toggleProvider(providerId);
                  }}
                >
                  {providerId}
                  {selected.includes(providerId) ? (
                    <span className="compare-provider-check" aria-hidden="true">
                      <CheckIcon size={12} />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <p className="compare-prompt-preview">
              {prompt.trim() || 'Type a prompt in the composer, then compare.'}
            </p>
            {error ? <p className="compare-error">{error}</p> : null}
            <button
              type="button"
              className="compare-start"
              disabled={selected.length < 2 || !prompt.trim() || !providerRevision}
              onClick={() => {
                void startCompare();
              }}
            >
              Run on {selected.length} providers
            </button>
          </div>
        ) : (
          <div className="compare-lanes">
            {lanes.map((lane) => (
              <div key={lane.providerId} className={`compare-lane compare-lane-${lane.providerId}`}>
                <header className="compare-lane-header">
                  <span className="compare-lane-provider">{lane.providerId}</span>
                  <span className={`compare-lane-status compare-lane-status-${lane.status}`}>
                    {summarizeStatus(lane.status)}
                  </span>
                </header>
                <div className="compare-lane-transcript">
                  {lane.events.length === 0 ? (
                    <p className="compare-lane-empty">Waiting for the first event…</p>
                  ) : (
                    <StepTimeline
                      steps={laneSteps(lane)}
                      showThinking
                      expandedToolIds={new Set()}
                      onToggleTool={() => {}}
                      formatTimestamp={formatTimestamp}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
