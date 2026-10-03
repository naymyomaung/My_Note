import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Note } from "../types/note";

interface NoteEditorProps {
  note: Note;
  onUpdate: (updates: Pick<Note, "title" | "content">) => void;
  onDelete: () => void;
  willDeleteRemote: boolean;
}

export default function NoteEditor({ note, onUpdate, onDelete, willDeleteRemote }: NoteEditorProps) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <main className="editor">
      <div className="editor-toolbar">
        <div className="breadcrumb"><span>My notes</span><span className="breadcrumb-separator">/</span><span>{note.title || "Untitled"}</span></div>
        <div className="toolbar-actions">
          <span className="saved-label"><span className="status-dot" /> Saved</span>
          <button
            className="icon-button delete-button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete note"
            title="Delete note"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      <article className="document">
        <div className="document-meta">
          <span className="document-badge"><span aria-hidden="true">✳</span> NOTE</span>
          <span className="meta-divider" />
          <span>Edited {formatRelativeDate(note.updatedAt)}</span>
        </div>
        <input
          className="title-input"
          value={note.title}
          onChange={(event) => onUpdate({ title: event.target.value, content: note.content })}
          placeholder="Untitled"
          aria-label="Note title"
          maxLength={160}
        />
        <div className="editor-tabs" role="tablist" aria-label="Editor mode">
          <button
            className={`editor-tab${mode === "write" ? " active" : ""}`}
            onClick={() => setMode("write")}
            role="tab"
            aria-selected={mode === "write"}
          >
            <PenIcon /> Write
          </button>
          <button
            className={`editor-tab${mode === "preview" ? " active" : ""}`}
            onClick={() => setMode("preview")}
            role="tab"
            aria-selected={mode === "preview"}
          >
            <EyeIcon /> Preview
          </button>
          <span className="markdown-hint">Markdown supported</span>
        </div>
        {mode === "write" ? (
          <textarea
            className="markdown-input"
            value={note.content}
            onChange={(event) => onUpdate({ title: note.title, content: event.target.value })}
            placeholder={"Start writing...\n\nUse Markdown to format your thoughts."}
            aria-label="Note content in Markdown"
            spellCheck
          />
        ) : (
          <div className="markdown-preview">
            {note.content.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content}</ReactMarkdown>
            ) : (
              <p className="preview-empty">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </article>

      <div className="editor-footer">
        <span><strong>{note.content.trim() ? note.content.trim().split(/\s+/).length : 0}</strong> words</span>
        <span>Markdown</span>
      </div>

      {confirmDelete && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setConfirmDelete(false);
        }}>
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
            <h2 id="delete-title">Delete this note?</h2>
            <p>{willDeleteRemote
              ? "This note will be removed from this device. Its GitHub copy will be offered for deletion in your next sync preview."
              : "This note will be permanently removed from this device."}</p>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="danger-button" onClick={onDelete}>Delete note</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function TrashIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11m-9.5 0 .6 9.2c.1.8.7 1.3 1.5 1.3h3.8c.8 0 1.4-.5 1.5-1.3L14 6M8 6V4.5c0-.6.4-1 1-1h2c.6 0 1 .4 1 1V6m-3 2.5v5m3-5v5" /></svg>;
}

function PenIcon() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m3 12.8-.7 3 3-.7L15 6.4 11.6 3 3 11.6v1.2ZM10.5 4.1l3.4 3.4" /></svg>;
}

function EyeIcon() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 9s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z" /><circle cx="9" cy="9" r="1.7" /></svg>;
}
