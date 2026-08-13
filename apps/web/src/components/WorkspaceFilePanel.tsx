import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from './EmptyState';
import { PromptModal } from './PromptModal';
import { FileTextIcon, FolderIcon } from './icons';
import { daemonFetch } from '../lib/daemon-api';

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

type WorkspaceFilePreview = {
  workspacePath: string;
  relativePath: string;
  name: string;
  content: string;
  encoding: 'utf-8';
  byteLength: number;
  contentByteLength: number;
  truncated: boolean;
  maxPreviewBytes: number;
  version: string;
};

type WorkspaceFileMutation = {
  workspacePath: string;
  relativePath: string;
  name: string;
  byteLength: number;
  version: string;
};

type WorkspaceFileDraft = {
  workspacePath: string;
  entry: WorkspaceEntryRecord;
  preview: WorkspaceFilePreview;
  content: string;
  updatedAt: number;
};

const WORKSPACE_FILE_DRAFT_PREFIX = 'codewave.workspace-file-draft.v1:';
const MAX_WORKSPACE_FILE_DRAFTS = 10;
const workspaceFileDraftFallback = new Map<string, WorkspaceFileDraft>();

function draftStorageKey(workspacePath: string, relativePath: string): string {
  return `${WORKSPACE_FILE_DRAFT_PREFIX}${encodeURIComponent(workspacePath)}:${encodeURIComponent(relativePath)}`;
}

function persistWorkspaceDraft(draft: WorkspaceFileDraft): void {
  const key = draftStorageKey(draft.workspacePath, draft.entry.relativePath);
  try {
    window.sessionStorage.setItem(
      key,
      JSON.stringify(draft),
    );
    workspaceFileDraftFallback.delete(key);
  } catch {
    // The bounded in-memory fallback protects switches in hardened/private contexts.
    workspaceFileDraftFallback.delete(key);
    workspaceFileDraftFallback.set(key, draft);
    while (workspaceFileDraftFallback.size > MAX_WORKSPACE_FILE_DRAFTS) {
      const oldestKey = workspaceFileDraftFallback.keys().next().value as string | undefined;
      if (!oldestKey) break;
      workspaceFileDraftFallback.delete(oldestKey);
    }
  }
}

function removeWorkspaceDraft(workspacePath: string, relativePath: string): void {
  const key = draftStorageKey(workspacePath, relativePath);
  workspaceFileDraftFallback.delete(key);
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

function readLatestWorkspaceDraft(workspacePath: string): WorkspaceFileDraft | null {
  let latest: WorkspaceFileDraft | null = null;
  for (const draft of workspaceFileDraftFallback.values()) {
    if (
      draft.workspacePath === workspacePath &&
      (!latest || draft.updatedAt > latest.updatedAt)
    ) {
      latest = draft;
    }
  }
  try {
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (!key?.startsWith(WORKSPACE_FILE_DRAFT_PREFIX)) continue;
      const rawDraft = window.sessionStorage.getItem(key);
      if (!rawDraft) continue;
      const draft = JSON.parse(rawDraft) as WorkspaceFileDraft;
      if (
        draft.workspacePath === workspacePath &&
        draft.entry?.kind === 'file' &&
        draft.preview?.relativePath === draft.entry.relativePath &&
        typeof draft.content === 'string' &&
        (!latest || draft.updatedAt > latest.updatedAt)
      ) {
        latest = draft;
      }
    }
  } catch {
    // Return the bounded in-memory copy when browser storage is unavailable.
  }
  return latest;
}

class WorkspaceRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly currentVersion?: string,
  ) {
    super(message);
    this.name = 'WorkspaceRequestError';
  }
}

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
  const requestHeaders = new Headers(options.headers);
  const method = String(options.method ?? 'GET').toUpperCase();
  if (
    ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) &&
    !requestHeaders.has('Idempotency-Key')
  ) {
    requestHeaders.set(
      'Idempotency-Key',
      globalThis.crypto?.randomUUID?.() ??
        `codewave-file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  }
  const response = await daemonFetch(path, { ...options, headers: requestHeaders }, {
    negotiateBeforeRequest: false,
  });
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => ({ error: response.statusText }))) as {
      error?: string;
      code?: string;
      currentVersion?: string;
    };
    throw new WorkspaceRequestError(
      payload.error || response.statusText || 'Request failed.',
      response.status,
      payload.code,
      payload.currentVersion,
    );
  }

  return (await response.json()) as T;
}

export function WorkspaceFilePanel({ workspacePath }: WorkspaceFilePanelProps) {
  const [relativePath, setRelativePath] = useState('');
  const [entries, setEntries] = useState<WorkspaceEntryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<WorkspaceEntryRecord | null>(null);
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const listRequestId = useRef(0);
  const previewRequestId = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);

  const normalizedWorkspacePath = useMemo(
    () => workspacePath.trim(),
    [workspacePath],
  );

  async function loadEntries(nextRelativePath = relativePath): Promise<void> {
    const requestId = ++listRequestId.current;
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
      if (!response || !Array.isArray(response.entries)) {
        throw new Error('Workspace response did not include an entries list.');
      }
      if (requestId !== listRequestId.current) return;
      setRelativePath(
        typeof response.relativePath === 'string'
          ? response.relativePath
          : normalizedRelativePath,
      );
      setEntries(response.entries);
    } catch (loadError) {
      if (requestId !== listRequestId.current) return;
      const message =
        loadError instanceof Error ? loadError.message : String(loadError);
      setError(formatErrorMessage(message, 'load', 'entry'));
    } finally {
      if (requestId === listRequestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    previewRequestId.current += 1;
    const draft = readLatestWorkspaceDraft(normalizedWorkspacePath);
    setSelectedFile(draft?.entry ?? null);
    setPreview(draft?.preview ?? null);
    setEditContent(draft?.content ?? '');
    setPreviewError(null);
    setEditing(Boolean(draft));
    setDraftRestored(Boolean(draft));
    setSaveConflict(false);
    void loadEntries('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedWorkspacePath]);

  useEffect(() => {
    if (!error && !previewError) return;
    window.requestAnimationFrame(() => errorRef.current?.focus());
  }, [error, previewError]);

  const isDirty = Boolean(editing && preview && editContent !== preview.content);
  const editByteLength = useMemo(
    () => new TextEncoder().encode(editContent).byteLength,
    [editContent],
  );

  useEffect(() => {
    if (!selectedFile || !preview) return;
    if (isDirty) {
      persistWorkspaceDraft({
        workspacePath: preview.workspacePath,
        entry: selectedFile,
        preview,
        content: editContent,
        updatedAt: Date.now(),
      });
      return;
    }
    removeWorkspaceDraft(preview.workspacePath, selectedFile.relativePath);
  }, [editContent, isDirty, preview, selectedFile]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDirty]);

  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    subtitle?: string;
    placeholder: string;
    defaultValue: string;
    confirmLabel: string;
    mode?: 'prompt' | 'confirm';
    destructive?: boolean;
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

  async function loadFilePreview(entry: WorkspaceEntryRecord): Promise<void> {
    const requestId = ++previewRequestId.current;
    setSelectedFile(entry);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    setEditing(false);
    setDraftRestored(false);
    setSaveConflict(false);
    try {
      const params = new URLSearchParams({
        workspacePath: normalizedWorkspacePath,
        targetPath: entry.relativePath,
      });
      const response = await requestWorkspaceJson<WorkspaceFilePreview>(
        `/api/workspace/files?${params.toString()}`,
      );
      if (requestId !== previewRequestId.current) return;
      setPreview(response);
      setEditContent(response.content);
      window.requestAnimationFrame(() => previewHeadingRef.current?.focus());
    } catch (previewFailure) {
      if (requestId !== previewRequestId.current) return;
      const failure = previewFailure as WorkspaceRequestError;
      if (failure.code === 'workspace_file_binary') {
        setPreviewError(
          'Binary file preview is unavailable. CodeWave did not decode or alter this file.',
        );
      } else if (failure.code === 'workspace_entry_not_found') {
        setPreviewError('This file no longer exists. Refresh the folder to update the list.');
      } else {
        setPreviewError(failure.message || 'The file preview could not be loaded.');
      }
    } finally {
      if (requestId === previewRequestId.current) setPreviewLoading(false);
    }
  }

  async function executeCreateFile(name: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const created = await requestWorkspaceJson<WorkspaceFileMutation>(
        '/api/workspace/files',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspacePath: normalizedWorkspacePath,
            parentPath: relativePath,
            name,
            content: '',
          }),
        },
      );
      await loadEntries(relativePath);
      await loadFilePreview({
        name: created.name,
        relativePath: created.relativePath,
        kind: 'file',
      });
    } catch (createFailure) {
      const failure = createFailure as WorkspaceRequestError;
      setError(
        failure.code === 'workspace_entry_exists'
          ? `File already exists: ${name}`
          : failure.message || `Could not create file: ${name}`,
      );
      setLoading(false);
    }
  }

  function createFile() {
    setModalConfig({
      isOpen: true,
      title: 'Create New File',
      placeholder: 'e.g. notes.md',
      defaultValue: '',
      confirmLabel: 'Create File',
      onConfirm: (name) => void executeCreateFile(name),
    });
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
      if (selectedFile?.relativePath === entry.relativePath) {
        const nextRelativePath = [getParentPath(entry.relativePath), nextName]
          .filter(Boolean)
          .join('/');
        await loadFilePreview({ ...entry, name: nextName, relativePath: nextRelativePath });
      }
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

  async function executeDeleteEntry(entry: WorkspaceEntryRecord) {
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
      if (selectedFile?.relativePath === entry.relativePath) {
        previewRequestId.current += 1;
        setSelectedFile(null);
        setPreview(null);
        setPreviewError(null);
        setEditing(false);
      }
      await loadEntries(relativePath);
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : String(deleteError);
      setError(formatErrorMessage(message, 'delete', entry.kind, entry.name));
      setLoading(false);
    }
  }

  function deleteEntry(entry: WorkspaceEntryRecord) {
    const label = entry.kind === 'folder' ? 'folder' : 'file';
    setModalConfig({
      isOpen: true,
      mode: 'confirm',
      destructive: true,
      title: `Delete ${label} “${entry.name}”?`,
      subtitle:
        entry.kind === 'folder'
          ? 'This permanently deletes the folder and every item inside it. This action cannot be undone.'
          : 'This permanently deletes the file. This action cannot be undone.',
      placeholder: '',
      defaultValue: entry.relativePath,
      confirmLabel: `Delete ${label}`,
      onConfirm: () => void executeDeleteEntry(entry),
    });
  }

  async function saveFile(): Promise<void> {
    if (!selectedFile || !preview || !isDirty || editByteLength > 1_048_576) return;
    setSaving(true);
    setPreviewError(null);
    setSaveConflict(false);
    try {
      const updated = await requestWorkspaceJson<WorkspaceFileMutation>(
        '/api/workspace/files',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspacePath: normalizedWorkspacePath,
            targetPath: selectedFile.relativePath,
            content: editContent,
            expectedVersion: preview.version,
          }),
        },
      );
      setPreview({
        ...preview,
        content: editContent,
        contentByteLength: updated.byteLength,
        byteLength: updated.byteLength,
        version: updated.version,
        truncated: false,
      });
      removeWorkspaceDraft(preview.workspacePath, selectedFile.relativePath);
      setEditing(false);
      setDraftRestored(false);
      window.requestAnimationFrame(() => editButtonRef.current?.focus());
    } catch (saveFailure) {
      const failure = saveFailure as WorkspaceRequestError;
      if (failure.code === 'workspace_file_version_conflict') {
        setSaveConflict(true);
        setPreviewError(
          'Save conflict: this file changed on disk after you opened it. Reload the latest version before saving again.',
        );
      } else {
        setPreviewError(failure.message || 'The file could not be saved.');
      }
    } finally {
      setSaving(false);
    }
  }

  function forceClosePreview(): void {
    if (selectedFile && preview) {
      removeWorkspaceDraft(preview.workspacePath, selectedFile.relativePath);
    }
    previewRequestId.current += 1;
    setSelectedFile(null);
    setPreview(null);
    setPreviewError(null);
    setEditing(false);
    setDraftRestored(false);
  }

  function closePreview(): void {
    if (!isDirty) {
      forceClosePreview();
      return;
    }
    setModalConfig({
      isOpen: true,
      mode: 'confirm',
      title: 'Discard unsaved changes?',
      subtitle: `Your edits to ${selectedFile?.name ?? 'this file'} have not been saved.`,
      placeholder: '',
      defaultValue: selectedFile?.relativePath ?? '',
      confirmLabel: 'Discard changes',
      onConfirm: forceClosePreview,
    });
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
            onClick={createFile}
            disabled={loading}
          >
            New file
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              if (isDirty) {
                setPreviewError('Save or cancel your edits before refreshing this file.');
                return;
              }
              void loadEntries(relativePath);
              if (selectedFile) void loadFilePreview(selectedFile);
            }}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      <p className="workspace-file-help">
        Create, preview, edit, rename, and delete files without leaving the workspace.
      </p>

      {error ? (
        <div ref={errorRef} className="workspace-file-error" role="alert" tabIndex={-1}>
          {error}
        </div>
      ) : null}

      {selectedFile ? (
        <section className="workspace-file-preview" aria-busy={previewLoading}>
          <header className="workspace-file-preview-header">
            <div>
              <span className="eyebrow">File preview</span>
              <h4 ref={previewHeadingRef} tabIndex={-1}>{selectedFile.name}</h4>
            </div>
            <button type="button" className="secondary-button" onClick={closePreview}>
              Back to files
            </button>
          </header>

          {previewLoading ? (
            <div className="workspace-file-preview-state" role="status">
              Loading file preview…
            </div>
          ) : null}

          {previewError ? (
            <div ref={errorRef} className="workspace-file-error" role="alert" tabIndex={-1}>
              {previewError}
              {saveConflict ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void loadFilePreview(selectedFile)}
                >
                  Reload latest
                </button>
              ) : null}
            </div>
          ) : null}

          {preview ? (
            <>
              <div className="workspace-file-preview-meta">
                <span>{preview.byteLength.toLocaleString()} bytes</span>
                <span>UTF-8</span>
                {preview.truncated ? <strong>Preview truncated</strong> : null}
                {isDirty ? <strong>Unsaved changes</strong> : null}
                {draftRestored && isDirty ? <strong>Restored unsaved draft</strong> : null}
              </div>
              {preview.truncated ? (
                <p className="workspace-file-warning">
                  Showing the first {preview.contentByteLength.toLocaleString()} of{' '}
                  {preview.byteLength.toLocaleString()} bytes. Editing is disabled so partial
                  content cannot overwrite the complete file.
                </p>
              ) : null}
              {editing ? (
                <>
                  <label className="workspace-file-editor-label" htmlFor="workspace-file-editor">
                    File contents
                  </label>
                  <textarea
                    id="workspace-file-editor"
                    className="workspace-file-editor"
                    value={editContent}
                    onChange={(event) => setEditContent(event.target.value)}
                    autoFocus
                    spellCheck={false}
                  />
                  {editByteLength > 1_048_576 ? (
                    <div className="workspace-file-error" role="alert">
                      File content exceeds the 1 MiB save limit.
                    </div>
                  ) : null}
                  <div className="workspace-file-preview-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setEditContent(preview.content);
                        setEditing(false);
                        setDraftRestored(false);
                        setPreviewError(null);
                        window.requestAnimationFrame(() => editButtonRef.current?.focus());
                      }}
                      disabled={saving}
                    >
                      Cancel editing
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void saveFile()}
                      disabled={saving || !isDirty || editByteLength > 1_048_576}
                    >
                      {saving ? 'Saving…' : 'Save file'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <pre className="workspace-file-preview-content">
                    {preview.content || 'This file is empty.'}
                  </pre>
                  <div className="workspace-file-preview-actions">
                    <button
                      ref={editButtonRef}
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setDraftRestored(false);
                        setEditing(true);
                      }}
                      disabled={preview.truncated}
                    >
                      Edit file
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => renameEntry(selectedFile)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void deleteEntry(selectedFile)}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </>
          ) : null}
        </section>
      ) : null}

      {!selectedFile && entries.length === 0 ? (
        <EmptyState
          title={loading ? 'Loading entries' : 'No files in this folder'}
          message={
            loading
              ? 'Reading workspace entries...'
              : 'Create a folder, or navigate to another path.'
          }
        />
      ) : !selectedFile ? (
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
                  } else {
                    void loadFilePreview(entry);
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
      ) : null}
      <PromptModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        subtitle={modalConfig.subtitle}
        placeholder={modalConfig.placeholder}
        defaultValue={modalConfig.defaultValue}
        confirmLabel={modalConfig.confirmLabel}
        mode={modalConfig.mode}
        destructive={modalConfig.destructive}
        onConfirm={modalConfig.onConfirm}
        onClose={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
      />
    </section>
  );
}
