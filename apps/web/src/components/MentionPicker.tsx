import { useEffect, useMemo, useState } from 'react';
import { FileTextIcon, FolderIcon } from './icons';
import { daemonFetch } from '../lib/daemon-api';

type WorkspaceEntryRecord = {
  name: string;
  relativePath: string;
  kind: 'file' | 'folder';
};

type WorkspaceEntriesResponse = {
  workspacePath: string;
  relativePath: string;
  entries: WorkspaceEntryRecord[];
};

const MAX_MENTION_DIRECTORIES = 120;
const MAX_MENTION_ENTRIES = 2_000;
const MAX_MENTION_DEPTH = 8;
const MENTION_DIRECTORY_CONCURRENCY = 4;

function trimLeadingSlash(value: string): string {
  return value.replace(/^[\\/]+/, '').trim();
}

function fuzzyScore(haystack: string, needle: string): number {
  const lowerHaystack = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  if (!lowerNeedle) {
    return 1;
  }
  if (lowerHaystack === lowerNeedle) {
    return 100;
  }
  if (lowerHaystack.startsWith(lowerNeedle)) {
    return 50;
  }
  if (lowerHaystack.includes(lowerNeedle)) {
    return 20;
  }

  let index = 0;
  let score = 0;
  for (const char of lowerNeedle) {
    const found = lowerHaystack.indexOf(char, index);
    if (found === -1) {
      return 0;
    }
    score += 1;
    index = found + 1;
  }
  return score;
}

async function requestWorkspaceDirectory(
  workspacePath: string,
  relativePath: string,
): Promise<WorkspaceEntriesResponse> {
  const params = new URLSearchParams();
  params.set('workspacePath', workspacePath);
  if (relativePath) {
    params.set('relativePath', relativePath);
  }

  const response = await daemonFetch(`/api/workspace/entries?${params.toString()}`, {}, {
    negotiateBeforeRequest: false,
  });
  if (!response.ok) {
    throw new Error(`Listing failed (${response.status}).`);
  }
  return response.json() as Promise<WorkspaceEntriesResponse>;
}

async function discoverWorkspaceEntries(
  workspacePath: string,
): Promise<WorkspaceEntryRecord[]> {
  const discovered = new Map<string, WorkspaceEntryRecord>();
  const queue: Array<{ relativePath: string; depth: number }> = [
    { relativePath: '', depth: 0 },
  ];
  let requestedDirectories = 0;

  while (
    queue.length > 0
    && requestedDirectories < MAX_MENTION_DIRECTORIES
    && discovered.size < MAX_MENTION_ENTRIES
  ) {
    const remainingDirectoryBudget = MAX_MENTION_DIRECTORIES - requestedDirectories;
    const batch = queue.splice(
      0,
      Math.min(MENTION_DIRECTORY_CONCURRENCY, remainingDirectoryBudget),
    );
    requestedDirectories += batch.length;
    const listings = await Promise.all(
      batch.map(async (directory) => {
        try {
          return {
            directory,
            payload: await requestWorkspaceDirectory(workspacePath, directory.relativePath),
          };
        } catch (error) {
          if (!directory.relativePath) {
            throw error;
          }
          return null;
        }
      }),
    );

    for (const listing of listings) {
      if (!listing) {
        continue;
      }
      const { directory, payload } = listing;
      for (const entry of payload.entries) {
        if (discovered.size >= MAX_MENTION_ENTRIES) {
          break;
        }
        discovered.set(entry.relativePath, entry);
        if (entry.kind === 'folder' && directory.depth < MAX_MENTION_DEPTH) {
          queue.push({ relativePath: entry.relativePath, depth: directory.depth + 1 });
        }
      }
    }
  }

  return [...discovered.values()];
}

type MentionPickerProps = {
  workspacePath: string;
  query: string;
  onSelect: (relativePath: string) => void;
  onClose: () => void;
};

export function MentionPicker({
  workspacePath,
  query,
  onSelect,
  onClose,
}: MentionPickerProps) {
  const [entries, setEntries] = useState<WorkspaceEntryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const normalizedWorkspacePath = useMemo(
    () => workspacePath.trim(),
    [workspacePath],
  );

  useEffect(() => {
    let cancelled = false;
    setDismissed(false);
    if (!normalizedWorkspacePath) {
      setEntries([]);
      setError('Set a workspace path to mention files.');
      return;
    }

    setLoading(true);
    setError(null);

    void discoverWorkspaceEntries(normalizedWorkspacePath)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setEntries(payload);
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedWorkspacePath]);

  const matches = useMemo(() => {
    const scored = entries
      .map((entry) => ({
        entry,
        score: fuzzyScore(entry.name, query),
      }))
      .filter((entry) => entry.score > 0);
    scored.sort((left, right) => right.score - left.score);
    return scored.slice(0, 12);
  }, [entries, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [matches]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (dismissed) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (loading || error || matches.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((prev) => (prev + 1) % matches.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((prev) => (prev - 1 + matches.length) % matches.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        if (matches[activeIndex]) {
          event.preventDefault();
          event.stopPropagation();
          setDismissed(true);
          onSelect(matches[activeIndex].entry.relativePath);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [dismissed, loading, error, matches, activeIndex, onClose, onSelect]);

  if (dismissed) {
    return null;
  }

  return (
    <div className="mention-picker" role="listbox" aria-label="Mention a file">
      {loading ? (
        <p className="mention-picker-note">Loading workspace entries…</p>
      ) : error ? (
        <p className="mention-picker-note mention-picker-error">{error}</p>
      ) : matches.length === 0 ? (
        <p className="mention-picker-note">No matching files.</p>
      ) : (
        matches.map(({ entry }, index) => (
          <button
            key={entry.relativePath}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className="mention-picker-item"
            onClick={() => {
              setDismissed(true);
              onSelect(entry.relativePath);
            }}
          >
            <span className="mention-picker-glyph" aria-hidden="true">
              {entry.kind === 'folder' ? (
                <FolderIcon size={13} />
              ) : (
                <FileTextIcon size={13} />
              )}
            </span>
            <span className="mention-picker-name">{entry.name}</span>
            <span className="mention-picker-path">{trimLeadingSlash(entry.relativePath)}</span>
          </button>
        ))
      )}
      <button type="button" className="mention-picker-dismiss" onClick={onClose}>
        Esc to dismiss
      </button>
    </div>
  );
}
