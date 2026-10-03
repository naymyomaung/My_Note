import type { GoogleDriveSettings, Note, NoteSyncState } from "../types/note";

const STORAGE_KEY = "my-note.notes.v1";
const SYNC_STATE_KEY = "my-note.sync.v1";
const SETTINGS_KEY = "my-note.google-drive.settings.v1";
const THEME_KEY = "my-note.theme.v1";
const TAGS_KEY = "my-note.tags.v1";

export const EMPTY_SYNC_STATE: NoteSyncState = { synced: {}, deleted: {}, attachments: {} };

export function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the insecure-context fallback below.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function loadNotes(): Note[] {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === null) return [];

  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || !parsed.every(isNote)) {
    throw new Error("Saved notes have an invalid format.");
  }

  return parsed.map((note) => ({ ...note, tags: [...(note.tags ?? [])], attachments: [...(note.attachments ?? [])] }));
}

export function loadSyncState(): NoteSyncState {
  const stored = window.localStorage.getItem(SYNC_STATE_KEY);
  if (stored === null) return EMPTY_SYNC_STATE;
  const parsed: unknown = JSON.parse(stored);
  if (!isSyncState(parsed)) throw new Error("Saved sync state has an invalid format.");
  return { ...parsed, attachments: { ...(parsed.attachments ?? {}) } };
}

export function saveNotes(notes: Note[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

export function saveSyncState(state: NoteSyncState): void {
  window.localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
}

export function loadDriveSettings(): GoogleDriveSettings {
  const stored = window.localStorage.getItem(SETTINGS_KEY);
  if (stored === null) return { clientId: "", folderId: "" };
  const parsed: unknown = JSON.parse(stored);
  if (!isDriveSettings(parsed)) throw new Error("Saved Google Drive settings have an invalid format.");
  return parsed;
}

export function saveDriveSettings(settings: GoogleDriveSettings): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadTheme(): "light" | "dark" {
  return window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

export function loadKnownTags(): string[] {
  const stored = window.localStorage.getItem(TAGS_KEY);
  if (stored === null) return [];
  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || !parsed.every((tag) => typeof tag === "string")) {
    throw new Error("Saved tags have an invalid format.");
  }
  return [...new Set(parsed.map((tag) => tag.trim()).filter(Boolean))];
}

export function saveKnownTags(tags: string[]): void {
  window.localStorage.setItem(TAGS_KEY, JSON.stringify([...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]));
}

export function saveTheme(theme: "light" | "dark"): void {
  window.localStorage.setItem(THEME_KEY, theme);
}

function isNote(value: unknown): value is Note {
  if (typeof value !== "object" || value === null) return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.id === "string" &&
    typeof note.title === "string" &&
    typeof note.content === "string" &&
    (note.tags === undefined || (Array.isArray(note.tags) && note.tags.every((tag) => typeof tag === "string"))) &&
    (note.attachments === undefined || (Array.isArray(note.attachments) && note.attachments.every(isAttachment))) &&
    typeof note.createdAt === "string" &&
    typeof note.updatedAt === "string"
  );
}

function isAttachment(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.id === "string" &&
    typeof attachment.name === "string" &&
    typeof attachment.mimeType === "string" &&
    typeof attachment.size === "number" &&
    typeof attachment.updatedAt === "string"
  );
}

function isSyncState(value: unknown): value is NoteSyncState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    isRecord(state.synced) &&
    Object.entries(state.synced).every(([id, entry]) => isSyncedNote(entry, id)) &&
    isRecord(state.deleted) &&
    Object.entries(state.deleted).every(([id, entry]) => isDeletedNote(entry, id)) &&
    (state.attachments === undefined || (isRecord(state.attachments) &&
      Object.values(state.attachments).every(isSyncedAttachment))) &&
    (state.repositoryKey === undefined || typeof state.repositoryKey === "string")
  );
}

function isSyncedNote(value: unknown, id: string): boolean {
  if (!isRecord(value)) return false;
  return typeof value.sha === "string" &&
    typeof value.path === "string" &&
    isNote(value.note) &&
    value.note.id === id;
}

function isDeletedNote(value: unknown, id: string): boolean {
  if (!isRecord(value)) return false;
  return typeof value.sha === "string" &&
    typeof value.path === "string" &&
    isNote(value.baseline) &&
    value.baseline.id === id &&
    (value.keepRemote === undefined || typeof value.keepRemote === "boolean");
}

function isSyncedAttachment(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.sha === "string" &&
    typeof entry.name === "string" &&
    typeof entry.noteId === "string" &&
    typeof entry.path === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDriveSettings(value: unknown): value is GoogleDriveSettings {
  if (typeof value !== "object" || value === null) return false;
  const settings = value as Record<string, unknown>;
  return typeof settings.clientId === "string" && typeof settings.folderId === "string";
}
