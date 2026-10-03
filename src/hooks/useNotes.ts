import { useEffect, useState } from "react";
import { loadNotes, saveNotes } from "../services/noteStorage";
import type { Note } from "../types/note";

interface NotesState {
  notes: Note[];
  error: string | null;
  loadFailed: boolean;
}

export function useNotes() {
  const [state, setState] = useState<NotesState>(() => {
    try {
      return { notes: loadNotes(), error: null, loadFailed: false };
    } catch {
      return {
        notes: [],
        error: "Your saved notes could not be read. They have not been overwritten.",
        loadFailed: true,
      };
    }
  });

  useEffect(() => {
    if (state.error || state.loadFailed) return;
    try {
      saveNotes(state.notes);
    } catch {
      setState((current) => ({
        ...current,
        error: "Changes could not be saved to this browser. Check available storage.",
      }));
    }
  }, [state.notes, state.error]);

  function createNote(initial?: { title?: string; tags?: string[] }): string {
    const now = new Date().toISOString();
    const note: Note = {
      id: crypto.randomUUID(),
      title: initial?.title?.trim() || "Untitled",
      content: "",
      tags: [...(initial?.tags ?? [])],
      attachments: [],
      createdAt: now,
      updatedAt: now,
    };
    setState((current) => ({
      ...current,
      error: current.loadFailed ? current.error : null,
      notes: [note, ...current.notes],
    }));
    return note.id;
  }

  function updateNote(id: string, updates: Pick<Note, "title" | "content" | "tags" | "attachments">): void {
    setState((current) => ({
      ...current,
      error: current.loadFailed ? current.error : null,
      notes: current.notes.map((note) =>
        note.id === id
          ? { ...note, ...updates, updatedAt: new Date().toISOString() }
          : note,
      ),
    }));
  }

  function deleteNote(id: string): void {
    setState((current) => ({
      ...current,
      error: current.loadFailed ? current.error : null,
      notes: current.notes.filter((note) => note.id !== id),
    }));
  }

  function replaceNotes(notes: Note[]): void {
    setState((current) => ({ ...current, error: current.loadFailed ? current.error : null, notes }));
  }

  return { notes: state.notes, error: state.error, createNote, updateNote, deleteNote, replaceNotes };
}
