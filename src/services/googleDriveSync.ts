import type {
  GoogleDriveSettings,
  Note,
  NoteSyncState,
  SyncPreviewItem,
} from "../types/note";
import { isNoteType } from "../types/note";

const API_ROOT = "https://www.googleapis.com/drive/v3";
const UPLOAD_ROOT = "https://www.googleapis.com/upload/drive/v3";
// Marker stored in a Drive file description to link attachment files to notes.
const ATTACHMENT_MARKER = "my-note-attachment ";

export interface RemoteNote {
  note: Note;
  id: string;
  path: string;
  imported?: boolean;
}

export interface DriveFile {
  id: string;
  name: string;
  parents?: string[];
  mimeType: string;
  modifiedTime?: string;
}

export function notePath(_settings: GoogleDriveSettings, id: string, title?: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    throw new Error("A note has an invalid identifier and cannot be synced safely.");
  }
  // Drive file name follows the note title so files are recognizable in Drive.
  return `${sanitizeFileName(title ?? "", id)}.md`;
}

export function attachmentFileName(noteTitle: string, attachmentName: string, fallbackId: string): string {
  const title = sanitizeFileName(noteTitle, "Untitled");
  const dot = attachmentName.lastIndexOf(".");
  const stem = dot > 0 ? attachmentName.slice(0, dot) : attachmentName;
  const ext = dot > 0 ? attachmentName.slice(dot, dot + 17) : "";
  const named = `${title}__${sanitizeFileName(stem, fallbackId)}${ext}`;
  return named.trim() || `${fallbackId}${ext}`;
}

function sanitizeFileName(value: string, fallback: string): string {
  const illegal = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|"]);
  let out = "";
  for (const ch of value.trim()) {
    const code = ch.charCodeAt(0);
    out += code < 32 || illegal.has(ch) ? "-" : ch;
  }
  const clean = out.replace(/\s+/g, " ").trim().slice(0, 100);
  return clean || fallback;
}

function validateSettings(settings: GoogleDriveSettings): void {
  if (!settings.folderId.trim()) {
    throw new Error("Enter a Google Drive folder ID before syncing.");
  }
}

async function driveRequest(
  token: string,
  url: string,
  init: RequestInit = {},
  options: { notFoundMessage?: string; allowNotFound?: boolean } = {},
): Promise<Response | null> {
  let response: Response;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  // Only default to JSON when there is a body and caller did not set a type
  // (multipart uploads and media downloads set their own Content-Type, or none).
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new Error(
      "The browser could not complete a request to Google Drive API. Check your internet connection.",
    );
  }

  if (response.status === 404 && options.allowNotFound) return null;
  if (!response.ok) {
    let detail = "";
    try {
      const result = (await response.json()) as { error?: { message?: string } };
      detail = result.error?.message ?? "";
    } catch {
      detail = response.statusText;
    }
    if (response.status === 404 && options.notFoundMessage) {
      throw new Error(options.notFoundMessage);
    }
    if (response.status === 401) {
      throw new Error("Google rejected the token (it may have expired). If automatic refresh fails, click “Re-sign in with Google”.");
    }
    if (response.status === 403) {
      throw new Error(
        `Google Drive denied access (${response.status})${detail ? `: ${detail}` : ""}. Check permissions and quota.`,
      );
    }
    throw new Error(`Google Drive request failed (${response.status})${detail ? `: ${detail}` : ""}.`);
  }
  return response;
}

export async function verifyDriveAccess(
  token: string,
  settings: GoogleDriveSettings,
): Promise<void> {
  validateSettings(settings);
  const response = await driveRequest(
    token,
    `${API_ROOT}/files/${encodeURIComponent(settings.folderId)}?fields=id,name&supportsAllDrives=true`,
    { method: "GET" },
    {
      notFoundMessage:
        "Google Drive could not find this folder or this token cannot access it. Check the folder ID and token permissions.",
    },
  );
  if (!response) throw new Error("Google Drive did not confirm folder access.");
}

export async function fetchRemoteNotes(
  token: string,
  settings: GoogleDriveSettings,
): Promise<RemoteNote[]> {
  validateSettings(settings);
  await verifyDriveAccess(token, settings);

  const folderId = settings.folderId.trim();
  // List everything in the folder, filter .md client-side (mime types vary).
  const query = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed=false`;
  const response = await driveRequest(
    token,
    `${API_ROOT}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,description,modifiedTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { method: "GET" },
  );
  if (!response) throw new Error("Google Drive did not return file listing.");

  const data = (await response.json()) as { files?: Array<DriveFile & { description?: string }> };
  // Attachment files live in the same folder: never treat them as notes.
  const markdownFiles = (data.files ?? []).filter(
    (f) => f.name.endsWith(".md") && !(f.description && f.description.indexOf(ATTACHMENT_MARKER) === 0),
  );

  const notes: RemoteNote[] = [];
  for (const file of markdownFiles) {
    let contentResponse;
    try {
      contentResponse = await driveRequest(
        token,
        `${API_ROOT}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,
        { method: "GET" },
        { notFoundMessage: `Google Drive could not read the file ${file.name}.` },
      );
    } catch (cause) {
      if (!isNotFoundError(cause)) throw cause;
      continue; // Deleted between listing and reading.
    }
    if (!contentResponse) throw new Error(`Google Drive did not return content for ${file.name}.`);
    const content = await contentResponse.text();
    try {
      notes.push({ ...decodeNote(content), id: file.id, path: file.name });
    } catch {
      // Plain .md file without My Note metadata: import it as a brand-new note
      // instead of ignoring it. The Drive file id keys it, so re-syncs are stable.
      const imported = importForeignNote(file, content);
      if (imported) notes.push(imported);
    }
  }
  return notes;
}

const MAX_IMPORT_CHARS = 500_000;

function importForeignNote(
  file: { id: string; name: string; modifiedTime?: string },
  content: string,
): RemoteNote | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(file.id)) return null;
  if (content.length > MAX_IMPORT_CHARS) return null;
  const stamp = file.modifiedTime && !Number.isNaN(Date.parse(file.modifiedTime))
    ? new Date(file.modifiedTime).toISOString()
    : new Date().toISOString();
  const title = file.name.replace(/\.md$/i, "").trim() || "Untitled";
  return {
    note: {
      id: file.id,
      title: title.slice(0, 160),
      content,
      type: "md",
      tags: [],
      attachments: [],
      createdAt: stamp,
      updatedAt: stamp,
    },
    id: file.id,
    path: file.name,
    imported: true,
  };
}

export function buildSyncPreview(
  localNotes: Note[],
  remoteNotes: RemoteNote[],
  state: NoteSyncState,
  settings: GoogleDriveSettings,
): SyncPreviewItem[] {
  const localById = new Map(localNotes.map((note) => [note.id, note]));
  const remoteById = new Map(remoteNotes.map((remote) => [remote.note.id, remote]));
  const ids = new Set([
    ...localById.keys(),
    ...remoteById.keys(),
    ...Object.keys(state.synced),
    ...Object.keys(state.deleted),
  ]);
  const preview: SyncPreviewItem[] = [];

  for (const id of ids) {
    const local = localById.get(id);
    const remote = remoteById.get(id);
    const baseline = state.synced[id];
    const tombstone = state.deleted[id];
    // Fresh title-based name when the note is new or was renamed locally,
    // so uploads (which PATCH the Drive file name) rename the file too.
    const titledPath =
      local && (!baseline || baseline.note.title !== local.title)
        ? notePath(settings, id, local.title)
        : undefined;
    const path = titledPath ?? remote?.path ?? baseline?.path ?? tombstone?.path ?? notePath(settings, id, local?.title);

    if (tombstone) {
      if (tombstone.keepRemote) {
        // Deleted on this device only: Upload never touches the Drive copy,
        // but an explicit Sync restores it locally on request.
        if (!remote || !tombstone.sha) continue;
        preview.push(item(id, tombstone.baseline.title, "current", undefined, remote.note, remote.id, path, "Deleted on this device — the Drive copy is kept.", false));
        continue;
      }
      if (!remote) {
        // Never reached Drive: nothing to show, drop the tombstone silently.
        if (!tombstone.sha) continue;
        preview.push(item(id, tombstone.baseline.title, "current", undefined, undefined, undefined, path, "The deleted note is already absent from Google Drive.", true));
      } else if (remote.id === tombstone.sha) {
        preview.push(item(id, tombstone.baseline.title, "delete", undefined, remote.note, remote.id, path, "Delete this note from Google Drive."));
      } else if (!tombstone.sha) {
        preview.push(item(id, remote.note.title, "conflict", undefined, remote.note, remote.id, path, "Deleted on this device, but this device has no sync record for it. Keep local deletes it from Drive; keep Drive restores it here."));
      } else {
        preview.push(item(id, remote.note.title, "conflict", undefined, remote.note, remote.id, path, "The Google Drive note changed after it was deleted locally."));
      }
      continue;
    }

    if (local && remote) {
      if (!baseline) {
        const action = sameNote(local, remote.note) ? "current" : "conflict";
        preview.push(item(id, local.title, action, local, remote.note, remote.id, path,
          action === "current" ? "The local and Google Drive notes already match." : "The same note exists locally and on Google Drive without a shared sync baseline.",
          action === "current"));
        continue;
      }
      const localChanged = !sameNote(local, baseline.note);
      const remoteChanged = !sameNote(remote.note, baseline.note);
      if (localChanged && remoteChanged && !sameNote(local, remote.note)) {
        preview.push(item(id, local.title, "conflict", local, remote.note, remote.id, path, "Both copies changed since the last sync."));
      } else if (localChanged && !remoteChanged) {
        preview.push(item(id, local.title, "upload", local, remote.note, remote.id, path, "Upload local changes to Google Drive."));
      } else if (remoteChanged && !localChanged) {
        preview.push(item(id, remote.note.title, "download", local, remote.note, remote.id, path, "Download Google Drive changes to this device."));
      } else {
        preview.push(item(id, local.title, "current", local, remote.note, remote.id, path, "Both copies are up to date.", remote.id !== baseline.sha));
      }
      continue;
    }

    if (local) {
      preview.push(item(id, local.title, "upload", local, undefined, undefined, path,
        baseline ? "The Google Drive copy is missing; upload the local note again." : "Upload this local note to Google Drive."));
    } else if (remote) {
      preview.push(item(id, remote.note.title, "download", undefined, remote.note, remote.id, path,
        remote.imported
          ? "New Markdown file in Drive — will be imported as a new local note."
          : "Download this Google Drive note to this device."));
    } else {
      preview.push(item(id, baseline?.note.title ?? "Untitled", "current", undefined, undefined, undefined, path, "No changes to sync."));
    }
  }

  disambiguateUploadPaths(preview, state);

  return preview.sort((a, b) => a.title.localeCompare(b.title));
}

// Distinct notes must never share a Drive file name: same title + re-upload
// would otherwise look like the old file was replaced. New/renamed uploads
// that collide get a short id suffix so every note owns a separate file.
// Updates always target the Drive file id, never the name.
function disambiguateUploadPaths(preview: SyncPreviewItem[], state: NoteSyncState): void {
  const ownerByName = new Map<string, string>();
  const ordered = [...preview].sort((a, b) => a.id.localeCompare(b.id));
  for (const entry of ordered) {
    const baseline = state.synced[entry.id];
    const tombstone = state.deleted[entry.id];
    const reserved = entry.remoteNote ? entry.path : (baseline?.path ?? tombstone?.path);
    if (reserved) ownerByName.set(reserved.toLowerCase(), entry.id);
  }
  for (const entry of ordered) {
    if (entry.action !== "upload" || !entry.localNote) continue;
    const wanted = entry.path.toLowerCase();
    const owner = ownerByName.get(wanted);
    if (owner === undefined || owner === entry.id) {
      ownerByName.set(wanted, entry.id);
      continue;
    }
    const dot = entry.path.lastIndexOf(".");
    const stem = dot > 0 ? entry.path.slice(0, dot) : entry.path;
    const ext = dot > 0 ? entry.path.slice(dot) : "";
    const tag = entry.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 6) || "note";
    let candidate = `${stem} (${tag})${ext}`;
    let counter = 2;
    while (ownerByName.has(candidate.toLowerCase())) {
      candidate = `${stem} (${tag} ${counter})${ext}`;
      counter += 1;
    }
    entry.path = candidate;
    entry.reason += ` Saved as “${candidate}” so it stays a separate file.`;
    ownerByName.set(candidate.toLowerCase(), entry.id);
  }
}

export async function putRemoteNote(
  token: string,
  settings: GoogleDriveSettings,
  note: Note,
  path: string,
  fileId?: string,
): Promise<string> {
  validateSettings(settings);
  const body = encodeNote(note);
  const boundary = `MyNoteDrive${Date.now().toString(36)}`;
  const metadata = fileId
    ? { name: path, mimeType: "text/markdown" }
    : { name: path, parents: [settings.folderId.trim()], mimeType: "text/markdown" };

  const fullBody =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/markdown\r\n\r\n${body}\r\n` +
    `--${boundary}--\r\n`;

  const url = fileId
    ? `${UPLOAD_ROOT}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id&supportsAllDrives=true`
    : `${UPLOAD_ROOT}/files?uploadType=multipart&fields=id&supportsAllDrives=true`;

  const response = await driveRequest(token, url, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary="${boundary}"` },
    body: fullBody,
  });

  if (!response) throw new Error("Google Drive did not return a save response.");
  const result = (await response.json()) as { id?: string };
  if (!result.id) throw new Error("Google Drive saved the note but returned no file identifier.");
  return result.id;
}

export async function deleteRemoteNote(
  token: string,
  _settings: GoogleDriveSettings,
  fileId: string,
  _title: string,
): Promise<void> {
  // Already-gone files count as deleted so one missing file can't block a sync.
  await driveRequest(
    token,
    `${API_ROOT}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    { method: "DELETE" },
    { allowNotFound: true },
  );
}

export function isNotFoundError(cause: unknown): boolean {
  return cause instanceof Error && cause.message.indexOf("(404)") !== -1;
}

export interface RemoteAttachment {
  fileId: string;
  attachmentId: string;
  noteId: string;
  name: string;
  mimeType: string;
  size: number;
  updatedAt: string;
}

function attachmentDescription(noteId: string, attachmentId: string, updatedAt: string): string {
  return `${ATTACHMENT_MARKER}${JSON.stringify({ noteId, attachmentId, updatedAt })}`;
}

export async function fetchRemoteAttachments(
  token: string,
  settings: GoogleDriveSettings,
): Promise<RemoteAttachment[]> {
  validateSettings(settings);
  const folderId = settings.folderId.trim();
  const query = `'${folderId}' in parents and trashed=false`;
  const response = await driveRequest(
    token,
    `${API_ROOT}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size,description,modifiedTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { method: "GET" },
  );
  if (!response) throw new Error("Google Drive did not return file listing.");
  const data = (await response.json()) as {
    files?: Array<DriveFile & { description?: string; size?: string }>;
  };
  const found: RemoteAttachment[] = [];
  for (const file of data.files ?? []) {
    if (!file.description || file.description.indexOf(ATTACHMENT_MARKER) !== 0) continue;
    try {
      const parsed = JSON.parse(file.description.slice(ATTACHMENT_MARKER.length)) as {
        noteId?: unknown;
        attachmentId?: unknown;
        updatedAt?: unknown;
      };
      if (typeof parsed.noteId !== "string" || typeof parsed.attachmentId !== "string" || typeof parsed.updatedAt !== "string") continue;
      found.push({
        fileId: file.id,
        attachmentId: parsed.attachmentId,
        noteId: parsed.noteId,
        name: file.name,
        mimeType: file.mimeType || "application/octet-stream",
        size: Number(file.size ?? 0) || 0,
        updatedAt: parsed.updatedAt,
      });
    } catch {
      // Skip files with unreadable markers.
    }
  }
  return found;
}

export async function putRemoteAttachment(
  token: string,
  settings: GoogleDriveSettings,
  noteId: string,
  noteTitle: string,
  attachment: { id: string; name: string; mimeType: string },
  data: Blob,
  updatedAt: string,
  fileId?: string,
): Promise<string> {
  validateSettings(settings);
  const boundary = `MyNoteFile${Date.now().toString(36)}`;
  const metadata = {
    name: attachmentFileName(noteTitle, attachment.name, attachment.id),
    ...(fileId ? {} : { parents: [settings.folderId.trim()] }),
    mimeType: attachment.mimeType || "application/octet-stream",
    description: attachmentDescription(noteId, attachment.id, updatedAt),
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
    data,
    `\r\n--${boundary}--\r\n`,
  ]);
  const url = fileId
    ? `${UPLOAD_ROOT}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id&supportsAllDrives=true`
    : `${UPLOAD_ROOT}/files?uploadType=multipart&fields=id&supportsAllDrives=true`;
  const response = await driveRequest(token, url, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary="${boundary}"` },
    body,
  });
  if (!response) throw new Error("Google Drive did not return a save response.");
  const result = (await response.json()) as { id?: string };
  if (!result.id) throw new Error("Google Drive saved the file but returned no file identifier.");
  return result.id;
}

export async function fetchAttachmentBytes(token: string, fileId: string): Promise<Blob> {
  const response = await driveRequest(
    token,
    `${API_ROOT}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { method: "GET" },
  );
  if (!response) throw new Error("Google Drive did not return the file content.");
  return await response.blob();
}

export async function renameRemoteFile(token: string, fileId: string, name: string): Promise<void> {
  const response = await driveRequest(
    token,
    `${API_ROOT}/files/${encodeURIComponent(fileId)}?fields=id&supportsAllDrives=true`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
  if (!response) throw new Error("Google Drive did not confirm the rename.");
}

export async function createNotesFolder(
  token: string,
  settings: GoogleDriveSettings,
  folderName = "My Note Sync",
): Promise<string> {
  const parentId = settings.folderId.trim() || "root";
  const escaped = folderName.replace(/'/g, "\\'");
  const query = `'${parentId.replace(/'/g, "\\'")}' in parents and mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false`;
  const existing = await driveRequest(
    token,
    `${API_ROOT}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { method: "GET" },
    { allowNotFound: true },
  );
  if (existing) {
    const data = (await existing.json()) as { files?: DriveFile[] };
    if (data.files?.length) return data.files[0].id;
  }

  const metadata: Record<string, unknown> = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId !== "root") metadata.parents = [parentId];

  const createResponse = await driveRequest(token, `${API_ROOT}/files?fields=id&supportsAllDrives=true`, {
    method: "POST",
    body: JSON.stringify(metadata),
  });
  if (!createResponse) throw new Error("Google Drive did not return the new folder.");
  const result = (await createResponse.json()) as { id?: string };
  if (!result.id) throw new Error("Google Drive did not return the folder identifier.");
  return result.id;
}

function item(
  id: string,
  title: string,
  action: SyncPreviewItem["action"],
  localNote: Note | undefined,
  remoteNote: Note | undefined,
  remoteSha: string | undefined,
  path: string,
  reason: string,
  needsBaseline = false,
): SyncPreviewItem {
  return {
    id,
    title: title || "Untitled",
    action,
    localNote,
    remoteNote,
    remoteSha,
    path,
    conflictChoice: "skip",
    reason,
    needsBaseline,
  };
}

function sameNote(a: Note, b: Note): boolean {
  return a.title === b.title && a.content === b.content && a.type === b.type &&
    JSON.stringify([...a.tags].sort()) === JSON.stringify([...b.tags].sort()) &&
    JSON.stringify([...a.attachments].sort((x, y) => x.id.localeCompare(y.id))) ===
      JSON.stringify([...b.attachments].sort((x, y) => x.id.localeCompare(y.id)));
}

function encodeNote(note: Note): string {
  const metadata = JSON.stringify({
    id: note.id,
    title: note.title,
    type: note.type,
    tags: note.tags,
    attachments: note.attachments,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  });
  return `<!-- my-note\n${metadata}\n-->\n${note.content}`;
}

function decodeNote(encoded: string): Pick<RemoteNote, "note"> {
  const match = /^<!-- my-note\n([^\r\n]+)\n-->\r?\n?([\s\S]*)$/.exec(encoded);
  if (!match) throw new Error("A Google Drive Markdown file is missing My Note metadata.");
  let metadata: unknown;
  try {
    metadata = JSON.parse(match[1]);
  } catch {
    throw new Error("A Google Drive Markdown file has invalid My Note metadata.");
  }
  if (!isNoteMetadata(metadata)) throw new Error("A Google Drive Markdown file has incomplete My Note metadata.");
  const tags = Array.isArray(metadata.tags) && metadata.tags.every((tag): tag is string => typeof tag === "string")
    ? metadata.tags
    : [];
  const attachments = Array.isArray(metadata.attachments) && metadata.attachments.every(isAttachmentMetadata)
    ? metadata.attachments.map((entry) => ({
      id: entry.id,
      name: entry.name,
      mimeType: entry.mimeType,
      size: entry.size,
      updatedAt: entry.updatedAt,
    }))
    : [];
  return {
    note: {
      id: metadata.id,
      title: metadata.title,
      type: metadata.type ?? "md",
      tags,
      attachments,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      content: match[2],
    },
  };
}

function isAttachmentMetadata(value: unknown): value is { id: string; name: string; mimeType: string; size: number; updatedAt: string } {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string" && typeof entry.name === "string" &&
    typeof entry.mimeType === "string" && typeof entry.size === "number" &&
    typeof entry.updatedAt === "string";
}

function isNoteMetadata(value: unknown): value is Pick<Note, "id" | "title" | "createdAt" | "updatedAt"> & {
  type?: Note["type"];
  tags?: unknown;
  attachments?: unknown;
} {
  if (typeof value !== "object" || value === null) return false;
  const metadata = value as Record<string, unknown>;
  return typeof metadata.id === "string" && typeof metadata.title === "string" &&
    typeof metadata.createdAt === "string" && typeof metadata.updatedAt === "string" &&
    (metadata.type === undefined || isNoteType(metadata.type));
}
