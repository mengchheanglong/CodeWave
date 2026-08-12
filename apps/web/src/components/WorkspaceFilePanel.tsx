import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from './EmptyState';
import { PromptModal } from './PromptModal';
import { FileTextIcon, FolderIcon } from './icons';

type WorkspaceEntryKind = 'file' | 'folder';

type WorkspaceEntryRecord = {
  name: string;
  relativePath: string;
  kind: WorkspaceEntryKind;
};

type WorkspaceEntriesResponse = {
  workspacePath: string;
  relativePath: string;
  entries: WorkspaceEntryRecord[];
};

type WorkspaceFilePanelProps = {
  workspacePath: string;
};

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, '').trim();
}

function getDirectoryLabel(relativePath: string): string {
  if (!relativePath) {
    return '/';
  }

  return `/${relativePath}`;
}

function getParentPath(relativePath: string): string {
  if (!relativePath) {
    return '';
  }

  const parts = relativePath.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

type ErrorCategory = 'permission' | 'not-found' | 'conflict' | 'validation';

function categorizeError(errorMessage: string): ErrorCategory {
  const lowerMessage = errorMessage.toLowerCase();
  
  if (lowerMessage.includes('permission') || lowerMessage.includes('denied')) {
    return 'permission';
  }
  if (lowerMessage.includes('not found') || lowerMessage.includes('does not exist')) {
    return 'not-found';
  }
  if (lowerMessage.includes('already exists') || lowerMessage.includes('conflict')) {
    return 'conflict';
  }
  // Validation errors: invalid characters, empty names, etc.
  if (lowerMessage.includes('invalid') || lowerMessage.includes('empty')) {
    return 'validation';
  }
  
  // Default to validation for unknown errors
  return 'validation';
}

function formatErrorMessage(
  errorMessage: string,
  operation: 'create' | 'rename' | 'delete' | 'load',
  entryType: 'file' | 'folder' | 'entry',
  entryName?: string,
): string {
  const category = categorizeError(errorMessage);
  
  switch (category) {
    case 'permission':
      return `Permission denied: cannot ${operation} ${entryType}${entryName ? ` "${entryName}"` : ''}`;
    
    case 'not-found':
      return `${entryType.charAt(0).toUpperCase() + entryType.slice(1)} not found${entryName ? `: ${entryName}` : ''}`;
    
    case 'conflict':
      // Extract the name from "already exists" messages if present
      const existsMatch = errorMessage.match(/already exists:?\s*(.+)/i);
      const name = existsMatch?.[1]?.trim() || entryName || '';
      return `${entryType.charAt(0).toUpperCase() + entryType.slice(1)} already exists${name ? `: ${name}` : ''}`;
    
    case 'validation':
      // Try to extract the reason from the error message
      const invalidMatch = errorMessage.match(/invalid[^:]*:?\s*(.+)/i);
      const reason = invalidMatch?.[1]?.trim() || errorMessage;
      return `Invalid ${entryType} name: ${reason}`;
    
    default:
      return errorMessage;
  }
}

async function requestWorkspaceJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => ({ error: response.statusText }))) as {
      error?: string;
    };
    throw new Error(payload.error || response.statusText || 'Request failed.');
  }

  return (await response.json()) as T;
}

export function WorkspaceFilePanel({ workspacePath }: WorkspaceFilePanelProps) {
  const [relativePath, setRelativePath] = useState('');
  const [entries, setEntries] = useState<WorkspaceEntryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedWorkspacePath = useMemo(
    () => workspacePath.trim(),
    [workspacePath],
  );

  async function loadEntries(nextRelativePath = relativePath): Promise<void> {
    const normalizedRelativePath = trimLeadingSlash(nextRelativePath);
    if (!normalizedWorkspacePath) {
      setEntries([]);
      setRelativePath('');
      setError('Set a workspace path first.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('workspacePath', normalizedWorkspacePath);
      if (normalizedRelativePath) {
        params.set('relativePath', normalizedRelativePath);
      }

      const response = await requestWorkspaceJson<WorkspaceEntriesResponse>(
        `/api/workspace/entries?${params.toString()}`,
      );
      setRelativePath(response.relativePath);
      setEntries(response.entries);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : String(loadError);
      setError(formatErrorMessage(message, 'load', 'entry'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEntries('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedWorkspacePath]);

  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    placeholder: string;
    defaultValue: string;
    confirmLabel: string;
    onConfirm: (val: string) => void;
  }>({
    isOpen: false,
    title: '',
    placeholder: '',
    defaultValue: '',
    confirmLabel: 'Save',
    onConfirm: () => {},
  });

  async function executeCreateFolder(name: string) {
    setLoading(true);
    setError(null);
    try {
      await requestWorkspaceJson<{ ok: true }>('/api/workspace/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspacePath: normalizedWorkspacePath,
          parentPath: relativePath,
          name,
        }),
      });
      await loadEntries(relativePath);
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : String(createError);
      setError(formatErrorMessage(message, 'create', 'folder', name));
      setLoading(false);
    }
  }

  function createFolder() {
    setModalConfig({
      isOpen: true,
      title: 'Create New Folder',
      placeholder: 'e.g. components',
      defaultValue: '',
      confirmLabel: 'Create Folder',
      onConfirm: (name) => {
        void executeCreateFolder(name);
      },
    });
  }

  async function executeRenameEntry(entry: WorkspaceEntryRecord, nextNameInput: string) {
    let nextName = nextNameInput.trim();
    if (entry.kind === 'file') {
      const lastDotIndex = entry.name.lastIndexOf('.');
      if (lastDotIndex > 0) {
        const extension = entry.name.substring(lastDotIndex);
        if (!nextName.includes('.')) {
          nextName = nextName + extension;
        }
      }
    }

    if (!nextName || nextName === entry.name) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await requestWorkspaceJson<{ ok: true }>('/api/workspace/entries/rename', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspacePath: normalizedWorkspacePath,
          targetPath: entry.relativePath,
          nextName,
        }),
      });
      await loadEntries(relativePath);
    } catch (renameError) {
      const message =
        renameError instanceof Error ? renameError.message : String(renameError);
      setError(formatErrorMessage(message, 'rename', entry.kind, entry.name));
      setLoading(false);
    }
  }

  function renameEntry(entry: WorkspaceEntryRecord) {
    let defaultValue = entry.name;
    if (entry.kind === 'file') {
      const lastDotIndex = entry.name.lastIndexOf('.');
      if (lastDotIndex > 0) {
        defaultValue = entry.name.substring(0, lastDotIndex);
      }
    }

    setModalConfig({
      isOpen: true,
      title: `Rename ${entry.kind === 'folder' ? 'Folder' : 'File'}`,
      placeholder: 'New name...',
      defaultValue,
      confirmLabel: 'Rename',
      onConfirm: (newName) => {
        void executeRenameEntry(entry, newName);
      },
    });
  }

  async function deleteEntry(entry: WorkspaceEntryRecord) {
    const label = entry.kind === 'folder' ? 'folder' : 'file';
    const confirmed = window.confirm(`Delete ${label} \"${entry.name}\"?`);
    if (!confirmed) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('workspacePath', normalizedWorkspacePath);
      params.set('targetPath', entry.relativePath);
      await requestWorkspaceJson<{ ok: true }>(
        `/api/workspace/entries?${params.toString()}`,
        {
          method: 'DELETE',
        },
      );
      await loadEntries(relativePath);
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : String(deleteError);
      setError(formatErrorMessage(message, 'delete', entry.kind, entry.name));
      setLoading(false);
    }
  }

  if (!normalizedWorkspacePath) {
    return (
      <EmptyState
        title="Workspace unavailable"
        message="Set a workspace path to browse and manage files."
      />
    );
  }

  return (
    <section className="workspace-file-panel">
      <div className="workspace-file-toolbar">
        <div className="workspace-file-path" title={normalizedWorkspacePath}>
          {getDirectoryLabel(relativePath)}
        </div>
        <div className="workspace-file-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void loadEntries(getParentPath(relativePath));
            }}
            disabled={loading || !relativePath}
          >
            Up
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void createFolder();
            }}
            disabled={loading}
          >
            New folder
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void loadEntries(relativePath);
            }}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      <p className="workspace-file-help">
        Manage folders and files here: create folders, rename items, and delete items.
      </p>

      {error ? <div className="workspace-file-error">{error}</div> : null}

      {entries.length === 0 ? (
        <EmptyState
          title={loading ? 'Loading entries' : 'No files in this folder'}
          message={
            loading
              ? 'Reading workspace entries...'
              : 'Create a folder, or navigate to another path.'
          }
        />
      ) : (
        <div className="workspace-file-list">
          {entries.map((entry) => (
            <div className="workspace-file-row" key={entry.relativePath}>
              <button
                type="button"
                className="workspace-file-entry"
                title={entry.relativePath}
                onClick={() => {
                  if (entry.kind === 'folder') {
                    void loadEntries(entry.relativePath);
                  }
                }}
              >
                <span className="workspace-file-kind" aria-hidden="true">
                  {entry.kind === 'folder' ? (
                    <FolderIcon size={14} />
                  ) : (
                    <FileTextIcon size={14} />
                  )}
                </span>
                <span className="workspace-file-name">{entry.name}</span>
              </button>
              <div className="workspace-file-row-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    void renameEntry(entry);
                  }}
                  disabled={loading}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    void deleteEntry(entry);
                  }}
                  disabled={loading}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <PromptModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        placeholder={modalConfig.placeholder}
        defaultValue={modalConfig.defaultValue}
        confirmLabel={modalConfig.confirmLabel}
        onConfirm={modalConfig.onConfirm}
        onClose={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
      />
    </section>
  );
}
