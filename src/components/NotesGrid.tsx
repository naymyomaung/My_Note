import { useState } from "react";
import type { Note } from "../types/note";
import { downloadNoteFile, downloadNotePng } from "../services/noteExport";

interface NotesGridProps {
  notes: Note[];
  totalCount: number;
  filteredCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  selectedTag: string | null;
  onClearTag: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDeleteNote: (id: string, everywhere: boolean) => void;
}

export default function NotesGrid({ notes, totalCount, filteredCount, search, onSearchChange, page, pageCount, onPage, selectedTag, onClearTag, onSelect, onCreate, onDeleteNote }: NotesGridProps) {
  const pages = pageNumbers(page, pageCount);
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);

  return (
    <main className="notes-home">
      <div className="notes-home-head">
        <div>
          <span className="dialog-kicker">MY NOTE</span>
          <h1>{search.trim() ? `Results for “${search.trim()}”` : "Your notes, your space."}</h1>
          <p>{filteredCount} of {totalCount} notes{pageCount > 1 ? ` · page ${page}/${pageCount}` : ""}</p>
          {selectedTag !== null && (
            <button className="tag-pill active-filter" onClick={onClearTag} title="Clear tag filter">
              #{selectedTag === "" ? "Untagged" : selectedTag} <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
        <button className="primary-button" onClick={onCreate}>
          <span aria-hidden="true">＋</span> New note
        </button>
      </div>

      <label className="search-box notes-search">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search notes by title, text, or tag..."
          aria-label="Search notes"
        />
      </label>

      {notes.length > 0 ? (
        <>
          <div className="notes-grid">            {notes.map((note) => (
              <div key={note.id} className="note-card">
                <button className="note-card-main" onClick={() => onSelect(note.id)} aria-label={`Open ${note.title || "Untitled"}`}>
                  <span className="note-card-pin" aria-hidden="true" />
                  <strong className="note-card-title">{note.title || "Untitled"}</strong>
                  {note.tags.length > 0 && (
                    <span className="note-card-tags">
                      {note.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="tag-mini">#{tag}</span>
                      ))}
                      {note.tags.length > 3 && <span className="tag-mini">+{note.tags.length - 3}</span>}
                    </span>
                  )}
                  <span className="note-card-snippet">{snippet(note.content)}</span>
                </button>
                <span className="note-card-foot">
                  <span>{formatGridDate(note.updatedAt)}{note.attachments.length > 0 ? ` · 📎${note.attachments.length}` : ""}</span>
                  <span className="note-card-actions">
                    <button
                      type="button"
                      className="card-icon-button card-download"
                      onClick={() => downloadNoteFile(note)}
                      title="Download as Markdown (.md)"
                      aria-label={`Download ${note.title || "Untitled"} as Markdown`}
                    >M↓</button>
                    <button
                      type="button"
                      className="card-icon-button card-image"
                      onClick={() => downloadNotePng(note)}
                      title="Download as image (.png)"
                      aria-label={`Download ${note.title || "Untitled"} as image`}
                    >🖼</button>
                    <button
                      type="button"
                      className="card-icon-button card-delete"
                      onClick={() => setPendingDelete(note)}
                      title={`Delete ${note.title || "Untitled"}`}
                      aria-label={`Delete ${note.title || "Untitled"}`}
                    >🗑</button>
                    <button
                      type="button"
                      className="note-card-open"
                      onClick={() => onSelect(note.id)}
                    >Open ↗</button>
                  </span>
                </span>
              </div>
            ))}
          </div>
          {pageCount > 1 && (
            <nav className="pagination" aria-label="Notes pages">
              <button className="page-button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">← Prev</button>
              {pages.map((entry, index) => entry === "…"
                ? <span key={`gap-${index}`} className="page-gap" aria-hidden="true">…</span>
                : (
                  <button
                    key={entry}
                    className={`page-button${entry === page ? " active" : ""}`}
                    onClick={() => onPage(entry)}
                    aria-current={entry === page ? "page" : undefined}
                    aria-label={`Page ${entry}`}
                  >{entry}</button>
                ))}
              <button className="page-button" onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label="Next page">Next →</button>
            </nav>
          )}
        </>
      ) : (
        <div className="notes-empty">
          <strong>No matching notes.</strong>
          <span>Try a different search or tag, or start a fresh page.</span>
          <button className="secondary-button" onClick={onCreate}>Create a note</button>
        </div>
      )}

      {pendingDelete && (
        <div className="dialog-backdrop tag-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPendingDelete(null);
        }}>
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="grid-delete-title">
            <h2 id="grid-delete-title">Delete this note?</h2>
            <p>
              <strong>“{pendingDelete.title || "Untitled"}”</strong> will be removed from this device.
              Its Drive copy stays unless you choose everywhere.
            </p>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button
                className="secondary-button"
                onClick={() => { onDeleteNote(pendingDelete.id, false); setPendingDelete(null); }}
              >
                Local only
              </button>
              <button
                className="danger-button"
                onClick={() => { onDeleteNote(pendingDelete.id, true); setPendingDelete(null); }}
              >
                Delete everywhere
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function pageNumbers(page: number, pageCount: number): Array<number | "…"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const siblings = new Set([1, 2, page - 1, page, page + 1, pageCount - 1, pageCount]);
  const ordered = [...siblings].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  for (let index = 0; index < ordered.length; index++) {
    if (index > 0 && ordered[index] - ordered[index - 1] > 1) out.push("…");
    out.push(ordered[index]);
  }
  return out;
}

function snippet(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (!flat) return "Empty note — click to start writing.";
  return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat;
}

function formatGridDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}
