import type { GitHubRepositorySettings, Note, NoteSyncState } from "../types/note";

const STORAGE_KEY = "my-note.notes.v1";
const SYNC_STATE_KEY = "my-note.sync.v1";
const SETTINGS_KEY = "my-note.github.settings.v1";
const THEME_KEY = "my-note.theme.v1";

export const EMPTY_SYNC_STATE: NoteSyncState = { synced: {}, deleted: {} };

export function loadNotes(): Note[] {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === null) return [];

  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || !parsed.every(isNote)) {
    throw new Error("Saved notes have an invalid format.");
  }

  return parsed;
}

export function saveNotes(notes: Note[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

export function loadSyncState(): NoteSyncState {
  const stored = window.localStorage.getItem(SYNC_STATE_KEY);
  if (stored === null) return EMPTY_SYNC_STATE;
  const parsed: unknown = JSON.parse(stored);
  if (!isSyncState(parsed)) throw new Error("Saved sync state has an invalid format.");
  return parsed;
}

export function saveSyncState(state: NoteSyncState): void {
  window.localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
}

export function loadRepositorySettings(): GitHubRepositorySettings {
  const stored = window.localStorage.getItem(SETTINGS_KEY);
  if (stored === null) return { owner: "", repository: "", branch: "main", directory: "notes" };
  const parsed: unknown = JSON.parse(stored);
  if (!isRepositorySettings(parsed)) throw new Error("Saved GitHub settings have an invalid format.");
  return parsed;
}

export function saveRepositorySettings(settings: GitHubRepositorySettings): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadTheme(): "light" | "dark" {
  return window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
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
    typeof note.createdAt === "string" &&
    typeof note.updatedAt === "string"
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
    value.baseline.id === id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRepositorySettings(value: unknown): value is GitHubRepositorySettings {
  if (typeof value !== "object" || value === null) return false;
  const settings = value as Record<string, unknown>;
  return (
    typeof settings.owner === "string" &&
    typeof settings.repository === "string" &&
    typeof settings.branch === "string" &&
    typeof settings.directory === "string"
  );
}
