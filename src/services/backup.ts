import type { Note } from "../types/note";

interface NoteBackup {
  format: "my-note-backup";
  version: 1;
  exportedAt: string;
  notes: Note[];
}

export function downloadBackup(notes: Note[]): void {
  const backup: NoteBackup = {
    format: "my-note-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    notes,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `my-note-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function readBackup(file: File): Promise<Note[]> {
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error("This file is not valid JSON.");
  }

  const notes =
    Array.isArray(value)
      ? value
      : isBackup(value)
        ? value.notes
        : null;
  if (!notes || !notes.every(isNote)) {
    throw new Error("This file is not a valid My Note backup.");
  }
  if (new Set(notes.map((note) => note.id)).size !== notes.length) {
    throw new Error("This backup contains duplicate note identifiers.");
  }
  return notes;
}

function isBackup(value: unknown): value is NoteBackup {
  if (typeof value !== "object" || value === null) return false;
  const backup = value as Record<string, unknown>;
  return backup.format === "my-note-backup" && backup.version === 1 && Array.isArray(backup.notes);
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
