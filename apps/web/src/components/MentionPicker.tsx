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

  const normalizedWorkspacePath = useMemo(
    () => workspacePath.trim(),
    [workspacePath],
  );

  useEffect(() => {
    let cancelled = false;
    if (!normalizedWorkspacePath) {
      setEntries([]);
      setError('Set a workspace path to mention files.');
      return;
    }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    params.set('workspacePath', normalizedWorkspacePath);
    void daemonFetch(`/api/workspace/entries?${params.toString()}`, {}, {
      negotiateBeforeRequest: false,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Listing failed (${response.status}).`);
        }
        return response.json() as Promise<WorkspaceEntriesResponse>;
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setEntries(payload.entries);
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

  return (
    <div className="mention-picker" role="listbox" aria-label="Mention a file">
      {loading ? (
        <p className="mention-picker-note">Loading workspace entries…</p>
      ) : error ? (
        <p className="mention-picker-note mention-picker-error">{error}</p>
      ) : matches.length === 0 ? (
        <p className="mention-picker-note">No matching files.</p>
      ) : (
        matches.map(({ entry }) => (
          <button
            key={entry.relativePath}
            type="button"
            role="option"
            className="mention-picker-item"
            onClick={() => {
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
