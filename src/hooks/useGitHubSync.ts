import { useState } from "react";
import {
  buildSyncPreview,
  createNotesFolder as createRemoteNotesFolder,
  deleteRemoteNote,
  fetchRemoteNotes,
  putRemoteNote,
  verifyGitHubAccess,
  type RemoteNote,
} from "../services/githubSync";
import {
  EMPTY_SYNC_STATE,
  loadRepositorySettings,
  loadSyncState,
  saveRepositorySettings,
  saveSyncState,
} from "../services/noteStorage";
import { downloadBackup } from "../services/backup";
import type {
  GitHubRepositorySettings,
  Note,
  NoteSyncState,
  SyncPreviewItem,
} from "../types/note";

const TOKEN_KEY = "my-note.github.token.session";

export function useGitHubSync(onReplaceNotes: (notes: Note[]) => void) {
  const [initialData] = useState(() => {
    try {
      return { settings: loadRepositorySettings(), syncState: loadSyncState(), error: null };
    } catch (cause) {
      return {
        settings: { owner: "", repository: "", branch: "main", directory: "notes" },
        syncState: EMPTY_SYNC_STATE,
        error: errorMessage(cause),
      };
    }
  });
  const [settings, setSettings] = useState<GitHubRepositorySettings>(initialData.settings);
  const [syncState, setSyncState] = useState<NoteSyncState>(initialData.syncState);
  const [token, setToken] = useState(() => {
    try {
      return window.sessionStorage.getItem(TOKEN_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [remoteNotes, setRemoteNotes] = useState<RemoteNote[]>([]);
  const [preview, setPreview] = useState<SyncPreviewItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialData.error);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  function saveSettings(nextSettings: GitHubRepositorySettings): void {
    try {
      const targetChanged = repositoryKey(settings) !== repositoryKey(nextSettings);
      if (targetChanged) {
        const resetState: NoteSyncState = { ...EMPTY_SYNC_STATE, repositoryKey: repositoryKey(nextSettings) };
        saveSyncState(resetState);
        setSyncState(resetState);
      }
      saveRepositorySettings(nextSettings);
      setSettings(nextSettings);
      setPreview([]);
      setError(null);
    } catch {
      setError("GitHub settings could not be saved in this browser.");
    }
  }

  function saveToken(nextToken: string): void {
    const cleaned = nextToken.trim();
    try {
      if (cleaned) window.sessionStorage.setItem(TOKEN_KEY, cleaned);
      else window.sessionStorage.removeItem(TOKEN_KEY);
      setToken(cleaned);
      setError(null);
    } catch {
      setError("The browser could not store your token for this session.");
    }
  }

  function recordDeletion(note: Note): void {
    recordDeletions([note]);
  }

  function recordDeletions(notes: Note[]): void {
    if (notes.length === 0) return;
    const synced = { ...syncState.synced };
    const deleted = { ...syncState.deleted };
    for (const note of notes) {
      const baseline = synced[note.id];
      if (baseline) {
        deleted[note.id] = { sha: baseline.sha, path: baseline.path, baseline: baseline.note };
        delete synced[note.id];
      }
    }
    const nextWithKey: NoteSyncState = {
      synced,
      deleted,
      repositoryKey: repositoryKey(settings),
    };
    saveSyncState(nextWithKey);
    setSyncState(nextWithKey);
  }

  async function preparePreview(notes: Note[]): Promise<void> {
    if (!token) {
      setError("Add a fine-grained GitHub token in Settings before syncing.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const remote = await fetchRemoteNotes(token, settings);
      setRemoteNotes(remote);
      const relevantState = syncState.repositoryKey === repositoryKey(settings) ? syncState : EMPTY_SYNC_STATE;
      setPreview(buildSyncPreview(notes, remote, relevantState, settings));
    } catch (cause) {
      setRemoteNotes([]);
      setPreview([]);
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createNotesFolder(): Promise<void> {
    if (!token) {
      setError("Add a fine-grained GitHub token in Settings before creating the folder.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    setPreview([]);
    try {
      await createRemoteNotesFolder(token, settings);
      setNotice(`Created “${settings.directory}” on branch “${settings.branch}”. Your notes are unchanged; check for changes to sync.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(): Promise<void> {
    if (!token) {
      setError("Save your fine-grained GitHub token in Settings before testing the connection.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await verifyGitHubAccess(token, settings);
      setNotice(`GitHub access confirmed for ${settings.owner}/${settings.repository} on branch “${settings.branch}”.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function updateConflictChoice(id: string, choice: SyncPreviewItem["conflictChoice"]): void {
    setPreview((current) => current.map((item) => item.id === id ? { ...item, conflictChoice: choice } : item));
  }

  function invalidatePreview(): void {
    setPreview([]);
  }

  async function applyPreview(notes: Note[]): Promise<void> {
    if (!token) {
      setError("Your session token is missing. Add it again in Settings.");
      return;
    }
    setBusy(true);
    setError(null);
    let updatedNotes = [...notes];
    let completedAny = false;
    try {
      const selectedDownloads = preview.filter((item) =>
        item.action === "download" ||
        (item.action === "conflict" && item.conflictChoice === "remote"),
      );
      if (selectedDownloads.length > 0) {
        const latestRemote = await fetchRemoteNotes(token, settings);
        for (const item of selectedDownloads) {
          if (latestRemote.find((remote) => remote.note.id === item.id)?.sha !== item.remoteSha) {
            throw new Error(`The GitHub copy of “${item.title}” changed after this preview. Check for changes again.`);
          }
        }
      }
      if (preview.some((item) =>
        item.action === "upload" || item.action === "download" || item.action === "delete" ||
        (item.action === "conflict" && item.conflictChoice !== "skip"),
      )) {
        downloadBackup(notes);
      }
      for (const item of preview) {
        const choice = item.action === "conflict"
          ? item.conflictChoice === "local"
            ? syncStateForRun.deleted[item.id] ? "delete" : "upload"
            : item.conflictChoice === "remote" ? "download" : "skip"
          : item.action;
        if (choice === "skip") continue;
        if (choice === "current" && !item.needsBaseline) continue;

        if (choice === "upload" && item.localNote) {
          const sha = await putRemoteNote(token, settings, item.localNote, item.path, item.remoteSha);
          persistSyncState({
            ...syncStateForRun,
            synced: {
              ...syncStateForRun.synced,
              [item.id]: { note: item.localNote, sha, path: item.path },
            },
            deleted: omit(syncStateForRun.deleted, item.id),
          });
          completedAny = true;
        } else if (choice === "current") {
          if (item.remoteNote && item.remoteSha && item.localNote) {
            persistSyncState({
              ...syncStateForRun,
              synced: {
                ...syncStateForRun.synced,
                [item.id]: { note: item.remoteNote, sha: item.remoteSha, path: item.path },
              },
              deleted: omit(syncStateForRun.deleted, item.id),
            });
            completedAny = true;
          } else if (syncStateForRun.deleted[item.id]) {
            persistSyncState({
              ...syncStateForRun,
              deleted: omit(syncStateForRun.deleted, item.id),
              synced: omit(syncStateForRun.synced, item.id),
            });
          }
        } else if (choice === "download" && item.remoteNote && item.remoteSha) {
          const remote = remoteNotes.find((candidate) => candidate.note.id === item.id);
          if (!remote) throw new Error(`The GitHub copy of “${item.title}” is no longer in the sync preview. Refresh the preview.`);
          updatedNotes = [...updatedNotes.filter((note) => note.id !== item.id), item.remoteNote];
          onReplaceNotes(updatedNotes);
          persistSyncState({
            ...syncStateForRun,
            synced: {
              ...syncStateForRun.synced,
              [item.id]: { note: item.remoteNote, sha: item.remoteSha, path: item.path },
            },
            deleted: omit(syncStateForRun.deleted, item.id),
          });
          completedAny = true;
        } else if (choice === "delete" && item.remoteSha) {
          await deleteRemoteNote(token, settings, item.path, item.remoteSha, item.title);
          persistSyncState({
            ...syncStateForRun,
            synced: omit(syncStateForRun.synced, item.id),
            deleted: omit(syncStateForRun.deleted, item.id),
          });
          completedAny = true;
        }
      }
      if (completedAny) onReplaceNotes(updatedNotes);
      setLastSyncedAt(new Date().toISOString());
      setPreview([]);
      await preparePreview(updatedNotes);
    } catch (cause) {
      if (completedAny) onReplaceNotes(updatedNotes);
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  let syncStateForRun = syncState.repositoryKey === repositoryKey(settings)
    ? syncState
    : { ...EMPTY_SYNC_STATE, repositoryKey: repositoryKey(settings) };

  function persistSyncState(nextState: NoteSyncState): void {
    const targetState = { ...nextState, repositoryKey: repositoryKey(settings) };
    saveSyncState(targetState);
    syncStateForRun = targetState;
    setSyncState(targetState);
  }

  function isSyncedNote(id: string): boolean {
    return syncState.repositoryKey === repositoryKey(settings) && Boolean(syncState.synced[id]);
  }

  return {
    settings,
    token,
    isConnected: Boolean(token),
    preview,
    busy,
    error,
    notice,
    lastSyncedAt,
    saveSettings,
    saveToken,
    recordDeletion,
    recordDeletions,
    preparePreview,
    createNotesFolder,
    testConnection,
    updateConflictChoice,
    invalidatePreview,
    applyPreview,
    isSyncedNote,
  };
}

function omit<T>(record: Record<string, T>, id: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected GitHub sync error occurred.";
}

function repositoryKey(settings: GitHubRepositorySettings): string {
  return `${settings.owner.toLowerCase()}/${settings.repository.toLowerCase()}@${settings.branch}:${settings.directory}`;
}
