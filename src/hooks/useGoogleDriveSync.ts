import { useRef, useState } from "react";
import {
  attachmentFileName,
  buildSyncPreview,
  createNotesFolder as createRemoteNotesFolder,
  deleteRemoteNote,
  fetchAttachmentBytes,
  fetchRemoteAttachments,
  fetchRemoteNotes,
  isNotFoundError,
  putRemoteAttachment,
  putRemoteNote,
  renameRemoteFile,
  verifyDriveAccess,
  type RemoteAttachment,
  type RemoteNote,
} from "../services/googleDriveSync";
import {
  EMPTY_SYNC_STATE,
  loadDriveSettings,
  loadSyncState,
  saveDriveSettings,
  saveSyncState,
} from "../services/noteStorage";
import { getAttachmentBlob, saveAttachmentBlob, deleteAttachmentBlob } from "../services/attachmentBlobs";
import { requestDriveAccessToken } from "../services/googleAuth";
import type {
  Attachment,
  GoogleDriveSettings,
  Note,
  NoteSyncState,
  SyncPreviewItem,
} from "../types/note";

const TOKEN_KEY = "my-note.drive.token.session";

export function useGoogleDriveSync(onReplaceNotes: (notes: Note[]) => void) {
  const [initialData] = useState(() => {
    try {
      return { settings: loadDriveSettings(), syncState: loadSyncState(), error: null };
    } catch (cause) {
      return {
        settings: { clientId: "", folderId: "" },
        syncState: EMPTY_SYNC_STATE,
        error: errorMessage(cause),
      };
    }
  });
  const [settings, setSettings] = useState<GoogleDriveSettings>(initialData.settings);
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

  // Always-fresh token holder: async flows (and silent refreshes) read/write
  // through here so a refresh mid-sync applies to every later request.
  const tokenRef = useRef(token);
  tokenRef.current = token;

  async function refreshAccessToken(): Promise<string> {
    if (!settings.clientId.trim()) {
      throw new Error("Google session expired. Enter your Client ID and click “Sign in with Google” again.");
    }
    const fresh = await requestDriveAccessToken(settings.clientId);
    try {
      if (fresh) window.sessionStorage.setItem(TOKEN_KEY, fresh);
      else window.sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage failure is non-fatal; the in-memory token still works.
    }
    tokenRef.current = fresh;
    setToken(fresh);
    return fresh;
  }

  // Runs a Drive call. No stored token (e.g. after a browser restart) or a
  // 401 triggers a silent Google re-auth before giving up.
  async function withAutoRefresh<T>(work: (activeToken: string) => Promise<T>): Promise<T> {
    if (!tokenRef.current) {
      setNotice("Signing you in with Google…");
      try {
        await refreshAccessToken();
      } catch {
        setNotice(null);
        throw new Error("Sign in with Google first (Settings tab), then retry.");
      }
      setNotice(null);
    }
    try {
      return await work(tokenRef.current);
    } catch (cause) {
      if (!isAuthError(cause)) throw cause;
      setNotice("Google session expired — refreshing sign-in…");
      const fresh = await refreshAccessToken();
      setNotice(null);
      return await work(fresh);
    }
  }

  function togglePreviewExcluded(id: string): void {
    setPreview((current) => current.map((item) => item.id === id ? { ...item, excluded: !item.excluded } : item));
  }

  function selectAllPreview(select: boolean): void {
    setPreview((current) => current.map((item) => ({ ...item, excluded: !select })));
  }

  function saveSettings(nextSettings: GoogleDriveSettings): void {
    try {
      const targetChanged = repositoryKey(settings) !== repositoryKey(nextSettings);
      if (targetChanged) {
        const resetState: NoteSyncState = { ...EMPTY_SYNC_STATE, repositoryKey: repositoryKey(nextSettings) };
        saveSyncState(resetState);
        setSyncState(resetState);
      }
      saveDriveSettings(nextSettings);
      setSettings(nextSettings);
      setPreview([]);
      setError(null);
    } catch {
      setError("Google Drive settings could not be saved in this browser.");
    }
  }

  function saveToken(nextToken: string): void {
    const cleaned = nextToken.trim();
    tokenRef.current = cleaned;
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

  function recordLocalOnlyDeletion(note: Note): void {
    const synced = { ...syncState.synced };
    const baseline = synced[note.id];
    const nextWithKey: NoteSyncState = {
      synced,
      deleted: {
        ...syncState.deleted,
        [note.id]: {
          sha: baseline?.sha ?? "",
          path: baseline?.path ?? "",
          baseline: baseline?.note ?? note,
          keepRemote: true,
        },
      },
      attachments: { ...syncState.attachments },
      repositoryKey: repositoryKey(settings),
    };
    saveSyncState(nextWithKey);
    setSyncState(nextWithKey);
  }

  function recordDeletions(notes: Note[]): void {
    if (notes.length === 0) return;
    const synced = { ...syncState.synced };
    const deleted = { ...syncState.deleted };
    for (const note of notes) {
      const baseline = synced[note.id];
      // Always leave a tombstone so the deletion shows up in the sync preview,
      // even when this device has no baseline (never uploaded, state was reset,
      // or the note first synced elsewhere).
      deleted[note.id] = {
        sha: baseline?.sha ?? "",
        path: baseline?.path ?? "",
        baseline: baseline?.note ?? note,
      };
      if (baseline) delete synced[note.id];
    }
    const nextWithKey: NoteSyncState = {
      synced,
      deleted,
      attachments: { ...syncState.attachments },
      repositoryKey: repositoryKey(settings),
    };
    saveSyncState(nextWithKey);
    setSyncState(nextWithKey);
  }

  async function preparePreview(notes: Note[]): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const [remote, remoteFiles] = await withAutoRefresh((activeToken) =>
        Promise.all([fetchRemoteNotes(activeToken, settings), fetchRemoteAttachments(activeToken, settings)]),
      );
      setRemoteNotes(remote);
      const relevantState = syncState.repositoryKey === repositoryKey(settings) ? syncState : EMPTY_SYNC_STATE;
      const built = buildSyncPreview(notes, remote, relevantState, settings);
      const filesByNote = new Map<string, number>();
      for (const file of remoteFiles) {
        filesByNote.set(file.noteId, (filesByNote.get(file.noteId) ?? 0) + 1);
      }
      for (const item of built) {
        if (item.action === "upload" && (item.localNote?.attachments.length ?? 0) > 0) {
          const count = item.localNote?.attachments.length ?? 0;
          item.reason += ` ${count} attached file${count === 1 ? "" : "s"} will upload too.`;
        } else if (item.action === "download") {
          const count = filesByNote.get(item.id) ?? 0;
          if (count > 0) item.reason += ` ${count} attached file${count === 1 ? "" : "s"} will download too.`;
        }
      }
      setPreview(built);
    } catch (cause) {
      setRemoteNotes([]);
      setPreview([]);
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createNotesFolder(folderName = "My Note Sync"): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    setPreview([]);
    try {
      const cleanName = folderName.trim() || "My Note Sync";
      const id = await withAutoRefresh((activeToken) => createRemoteNotesFolder(activeToken, settings, cleanName));
      setNotice(`Folder “${cleanName}” ready in Google Drive. Your notes are unchanged; check for changes to sync. (id ${id})`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await withAutoRefresh((activeToken) => verifyDriveAccess(activeToken, settings));
      setNotice(`Google Drive access confirmed for folder ${settings.folderId}.`);
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

  function displayAttachmentName(remoteName: string, fallback: string): string {
    const separator = remoteName.indexOf("__");
    const base = separator >= 0 ? remoteName.slice(separator + 2) : remoteName;
    return base.trim() || fallback;
  }

  async function pushAttachments(note: Note, remoteList: RemoteAttachment[]): Promise<void> {
    const baseline = syncStateForRun.synced[note.id]?.note.attachments ?? [];
    const baselineById = new Map(baseline.map((entry) => [entry.id, entry]));
    const currentById = new Map(note.attachments.map((entry) => [entry.id, entry]));
    const known = { ...syncStateForRun.attachments };
    // Adopt remote files that match by (note, attachment) id but were never recorded.
    for (const remote of remoteList) {
      if (remote.noteId !== note.id || known[remote.attachmentId]) continue;
      if (currentById.has(remote.attachmentId) || baselineById.has(remote.attachmentId)) {
        known[remote.attachmentId] = { sha: remote.fileId, name: remote.name, noteId: note.id, path: remote.name };
      }
    }
    const presentRemotely = new Set(remoteList.map((remote) => `${remote.noteId}|${remote.attachmentId}`));
    let changed = false;
    for (const meta of note.attachments) {
      const previous = baselineById.get(meta.id);
      const remote = known[meta.id];
      const expectedName = attachmentFileName(note.title, meta.name, meta.id);
      const remoteVanished = !!remote && !presentRemotely.has(`${note.id}|${meta.id}`);
      const needsBytes = !previous || previous.updatedAt !== meta.updatedAt || !remote || remoteVanished;
      if (needsBytes) {
        const blob = await getAttachmentBlob(meta.id);
        if (!blob) continue; // Bytes missing locally; keep meta and retry next sync.
        const fileId = await withAutoRefresh((activeToken) =>
          putRemoteAttachment(activeToken, settings, note.id, note.title, meta, blob, meta.updatedAt, remoteVanished ? undefined : remote?.sha),
        );
        known[meta.id] = { sha: fileId, name: expectedName, noteId: note.id, path: expectedName };
        changed = true;
      } else if (remote && remote.name !== expectedName) {
        try {
          await withAutoRefresh((activeToken) => renameRemoteFile(activeToken, remote.sha, expectedName));
          known[meta.id] = { ...remote, name: expectedName, path: expectedName };
        } catch (cause) {
          if (!isNotFoundError(cause)) throw cause;
          // File vanished mid-sync: re-upload bytes if we still have them.
          const blob = await getAttachmentBlob(meta.id);
          if (!blob) {
            delete known[meta.id];
          } else {
            const fileId = await withAutoRefresh((activeToken) =>
              putRemoteAttachment(activeToken, settings, note.id, note.title, meta, blob, meta.updatedAt, undefined),
            );
            known[meta.id] = { sha: fileId, name: expectedName, noteId: note.id, path: expectedName };
          }
        }
        changed = true;
      }
    }
    for (const previous of baseline) {
      if (!currentById.has(previous.id) && known[previous.id]) {
        const recorded = known[previous.id];
        await withAutoRefresh((activeToken) => deleteRemoteNote(activeToken, settings, recorded.sha, previous.name));
        delete known[previous.id];
        changed = true;
      }
    }
    if (changed) {
      persistSyncState({ ...syncStateForRun, attachments: known });
    }
  }

  async function pullAttachments(note: Note, remoteList: RemoteAttachment[]): Promise<Note> {
    const relevant = remoteList.filter((remote) => remote.noteId === note.id);
    const remoteById = new Map(relevant.map((remote) => [remote.attachmentId, remote]));
    const merged = [...note.attachments];
    const known = { ...syncStateForRun.attachments };
    let changed = false;
    for (const remote of relevant) {
      const local = merged.find((entry) => entry.id === remote.attachmentId);
      const recorded = known[remote.attachmentId];
      if (local && local.updatedAt === remote.updatedAt && recorded?.sha === remote.fileId) continue;
      let blob: Blob;
      try {
        blob = await withAutoRefresh((activeToken) => fetchAttachmentBytes(activeToken, remote.fileId));
      } catch (cause) {
        if (!isNotFoundError(cause)) throw cause;
        // File vanished after listing: forget it instead of failing the sync.
        if (known[remote.attachmentId]) {
          delete known[remote.attachmentId];
          changed = true;
        }
        continue;
      }
      await saveAttachmentBlob(remote.attachmentId, blob);
      const meta: Attachment = {
        id: remote.attachmentId,
        name: displayAttachmentName(remote.name, remote.attachmentId),
        mimeType: remote.mimeType,
        size: blob.size,
        updatedAt: remote.updatedAt,
      };
      if (local) {
        merged[merged.indexOf(local)] = meta;
      } else {
        merged.push(meta);
      }
      known[remote.attachmentId] = { sha: remote.fileId, name: remote.name, noteId: note.id, path: remote.name };
      changed = true;
    }
    for (const local of [...merged]) {
      if (!remoteById.has(local.id) && known[local.id]) {
        await deleteAttachmentBlob(local.id);
        merged.splice(merged.indexOf(local), 1);
        delete known[local.id];
        changed = true;
      }
    }
    if (changed) {
      persistSyncState({ ...syncStateForRun, attachments: known });
      return { ...note, attachments: merged };
    }
    return note;
  }

  async function removeRemoteAttachments(noteId: string, remoteList: RemoteAttachment[]): Promise<void> {
    const known = { ...syncStateForRun.attachments };
    let changed = false;
    for (const remote of remoteList) {
      if (remote.noteId !== noteId) continue;
      await withAutoRefresh((activeToken) => deleteRemoteNote(activeToken, settings, remote.fileId, remote.name));
      if (known[remote.attachmentId]) {
        delete known[remote.attachmentId];
        changed = true;
      }
    }
    const baseline = syncStateForRun.synced[noteId]?.note.attachments ?? [];
    for (const entry of baseline) {
      await deleteAttachmentBlob(entry.id).catch(() => undefined);
    }
    if (changed) {
      persistSyncState({ ...syncStateForRun, attachments: known });
    }
  }

  function resolveChoice(item: SyncPreviewItem): SyncPreviewItem["action"] | "skip" {
    if (item.action !== "conflict") return item.action;
    if (item.conflictChoice === "local") return syncStateForRun.deleted[item.id] ? "delete" : "upload";
    if (item.conflictChoice === "remote") return "download";
    return "skip";
  }

  async function executeItems(
    notes: Note[],
    mode: "all" | "upload" | "download",
    items: SyncPreviewItem[],
    remoteAttachments: RemoteAttachment[],
    knownRemote: RemoteNote[],
  ): Promise<{ updatedNotes: Note[]; applied: number; downloaded: number }> {
    let updatedNotes = [...notes];
    let applied = 0;
    let downloaded = 0;
    const selectedDownloads = items.filter((item) => !item.excluded && resolveChoice(item) === "download");
    if (selectedDownloads.length > 0) {
      const latestRemote = await withAutoRefresh((activeToken) => fetchRemoteNotes(activeToken, settings));
      for (const item of selectedDownloads) {
        if (latestRemote.find((remote) => remote.note.id === item.id)?.id !== item.remoteSha) {
          throw new Error(`The Google Drive copy of "${item.title}" changed. Check for changes again.`);
        }
      }
    }
    for (const item of items) {
      const choice = resolveChoice(item);
      if (choice === "skip" || item.excluded) continue;
      if (choice === "current" && !item.needsBaseline) continue;
      // Directional sync: Upload pushes local changes out, Sync pulls Drive changes in.
      if (mode === "upload" && choice !== "upload" && choice !== "delete" && choice !== "current") continue;
      if (mode === "download" && choice !== "download" && choice !== "current") continue;

      if (choice === "upload" && item.localNote) {
        const fileId = await withAutoRefresh((activeToken) => putRemoteNote(activeToken, settings, item.localNote as Note, item.path, item.remoteSha));
        persistSyncState({
          ...syncStateForRun,
          synced: {
            ...syncStateForRun.synced,
            [item.id]: { note: item.localNote, sha: fileId, path: item.path },
          },
          deleted: omit(syncStateForRun.deleted, item.id),
        });
        await pushAttachments(item.localNote, remoteAttachments);
        applied += 1;
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
          applied += 1;
        } else if (syncStateForRun.deleted[item.id]) {
          persistSyncState({
            ...syncStateForRun,
            deleted: omit(syncStateForRun.deleted, item.id),
            synced: omit(syncStateForRun.synced, item.id),
          });
        }
      } else if (choice === "download" && item.remoteNote && item.remoteSha) {
        const remote = knownRemote.find((candidate) => candidate.note.id === item.id);
        if (!remote) throw new Error(`The Google Drive copy of "${item.title}" is no longer available. Try again.`);
        const withFiles = await pullAttachments(item.remoteNote, remoteAttachments);
        updatedNotes = [...updatedNotes.filter((note) => note.id !== item.id), withFiles];
        onReplaceNotes(updatedNotes);
        persistSyncState({
          ...syncStateForRun,
          synced: {
            ...syncStateForRun.synced,
            [item.id]: { note: withFiles, sha: item.remoteSha, path: item.path },
          },
          deleted: omit(syncStateForRun.deleted, item.id),
        });
        applied += 1;
        downloaded += 1;
      } else if (choice === "delete" && item.remoteSha) {
        await withAutoRefresh((activeToken) => deleteRemoteNote(activeToken, settings, item.remoteSha as string, item.title));
        await removeRemoteAttachments(item.id, remoteAttachments);
        persistSyncState({
          ...syncStateForRun,
          synced: omit(syncStateForRun.synced, item.id),
          deleted: omit(syncStateForRun.deleted, item.id),
        });
        applied += 1;
      }
    }
    return { updatedNotes, applied, downloaded };
  }

  async function applyPreview(notes: Note[], mode: "all" | "upload" | "download" = "all"): Promise<void> {
    setBusy(true);
    setError(null);
    let updatedNotes = [...notes];
    let completedAny = false;
    try {
      const needsFiles = preview.some((item) =>
        item.action === "upload" || item.action === "download" || item.action === "delete" ||
        (item.action === "conflict" && item.conflictChoice !== "skip"),
      );
      const remoteAttachments = needsFiles
        ? await withAutoRefresh((activeToken) => fetchRemoteAttachments(activeToken, settings))
        : [];
      const result = await executeItems(notes, mode, preview, remoteAttachments, remoteNotes);
      updatedNotes = result.updatedNotes;
      completedAny = result.applied > 0;
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

  async function quickSync(notes: Note[], mode: "upload" | "download"): Promise<{ applied: number; conflicts: number; driveFiles: number; downloaded: number }> {
    setBusy(true);
    setError(null);
    setNotice(null);
    setPreview([]);
    try {
      const [remote, remoteFiles] = await withAutoRefresh((activeToken) =>
        Promise.all([fetchRemoteNotes(activeToken, settings), fetchRemoteAttachments(activeToken, settings)]),
      );
      setRemoteNotes(remote);
      const relevantState = syncState.repositoryKey === repositoryKey(settings) ? syncState : EMPTY_SYNC_STATE;
      const full = buildSyncPreview(notes, remote, relevantState, settings);
      // Local deletions always win on Upload, even when this device kept no baseline.
      // On Sync (download direction) a Drive file missing locally is restored instead —
      // including local-only deletes: an explicit Sync press means "bring it back".
      const directed = full.map((item) => {
        const tombstone = syncStateForRun.deleted[item.id];
        if (item.action === "conflict" && mode === "upload" && tombstone) {
          return { ...item, conflictChoice: "local" as const };
        }
        if (mode === "download" && tombstone && item.remoteNote && item.remoteSha) {
          return { ...item, action: "download" as const };
        }
        return item;
      });
      const auto = directed.filter((item) => {
        const choice = item.action === "conflict"
          ? item.conflictChoice === "local"
            ? (syncStateForRun.deleted[item.id] ? "delete" : "upload")
            : item.conflictChoice === "remote" ? "download" : "skip"
          : item.action;
        if (mode === "upload") {
          return choice === "upload" || choice === "delete" || (choice === "current" && !!item.needsBaseline);
        }
        return choice === "download" || (choice === "current" && !!item.needsBaseline);
      });
      const autoDeleteIds = new Set(
        mode === "upload" ? directed.filter((item) => item.action === "conflict" && item.conflictChoice === "local").map((item) => item.id) : [],
      );
      const { updatedNotes, applied, downloaded } = await executeItems(notes, mode, auto, remoteFiles, remote);
      if (applied > 0) onReplaceNotes(updatedNotes);
      setLastSyncedAt(new Date().toISOString());
      const remainingConflicts = full.filter((item) => item.action === "conflict" && !autoDeleteIds.has(item.id));
      setPreview(remainingConflicts);
      const conflictCount = remainingConflicts.length;
      if (mode === "download") {
        if (remote.length === 0) {
          setNotice("No Markdown files found in this Drive folder. Check the Folder ID in Settings.");
        } else if (downloaded > 0 && conflictCount === 0) {
          setNotice(`Downloaded ${downloaded} of ${remote.length} Drive files.`);
        } else if (downloaded > 0) {
          setNotice(`Downloaded ${downloaded} of ${remote.length} Drive files. ${conflictCount} conflict${conflictCount === 1 ? "" : "s"} need${conflictCount === 1 ? "s" : ""} your choice below.`);
        } else if (conflictCount > 0) {
          setNotice(`${remote.length} Drive files checked — nothing new to download. ${conflictCount} conflict${conflictCount === 1 ? "" : "s"} need${conflictCount === 1 ? "s" : ""} your choice below.`);
        } else {
          setNotice(`Checked ${remote.length} Drive file${remote.length === 1 ? "" : "s"}. Everything is already in sync.`);
        }
      } else {
        const direction = "uploaded to Drive";
        if (conflictCount > 0) {
          setNotice(`${applied} change${applied === 1 ? "" : "s"} ${direction}. ${conflictCount} conflict${conflictCount === 1 ? "" : "s"} need${conflictCount === 1 ? "s" : ""} your choice below.`);
        } else if (applied === 0) {
          setNotice("Everything is already in sync.");
        } else {
          setNotice(`${applied} change${applied === 1 ? "" : "s"} ${direction}.`);
        }
      }
      return { applied, conflicts: conflictCount, driveFiles: remote.length, downloaded };
    } catch (cause) {
      setPreview([]);
      setError(errorMessage(cause));
      return { applied: 0, conflicts: 0, driveFiles: 0, downloaded: 0 };
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
    recordLocalOnlyDeletion,
    recordDeletions,
    preparePreview,
    createNotesFolder,
    testConnection,
    updateConflictChoice,
    togglePreviewExcluded,
    selectAllPreview,
    invalidatePreview,
    applyPreview,
    quickSync,
    isSyncedNote,
  };
}

function omit<T>(record: Record<string, T>, id: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));
}

function isAuthError(cause: unknown): boolean {
  return cause instanceof Error && cause.message.startsWith("Google rejected the token");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected Google Drive sync error occurred.";
}

function repositoryKey(settings: GoogleDriveSettings): string {
  return `drive@${settings.folderId}`;
}