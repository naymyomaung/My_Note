import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Note } from "../types/note";
import { downloadNoteFile, downloadNotePng, noteFileExtension } from "../services/noteExport";

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
  tagRows: Array<{ name: string; count: number }>;
  onSelectTag: (tag: string | null) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDeleteNote: (id: string, everywhere: boolean) => void;
}

export default function NotesGrid({ notes, totalCount, filteredCount, search, onSearchChange, page, pageCount, onPage, selectedTag, onClearTag, tagRows, onSelectTag, onSelect, onCreate, onDeleteNote }: NotesGridProps) {
  const pages = pageNumbers(page, pageCount);
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);

  return (
    <main className="notes-home">
      <div className="notes-home-head">
        <div>
          <span className="dialog-kicker">MY NOTE</span>
          <h1>{search.trim() ? `Results for “${search.trim()}”` : "Your notes, your space."}</h1>
          <p>{filteredCount} of {totalCount} notes{pageCount > 1 ? ` · page ${page}/${pageCount}` : ""}</p>
        </div>
        <button className="primary-button" onClick={onCreate}>
          <span aria-hidden="true">＋</span> New note
        </button>
      </div>

      <div className="notes-filter-bar">
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
        <label className="mobile-tag-filter">
          <span>Filter by tag</span>
          <select
            className="dropdown-select"
            value={selectedTag === null ? "all" : selectedTag === "" ? "untagged" : `tag:${selectedTag}`}
            onChange={(event) => {
              const value = event.target.value;
              onSelectTag(value === "all" ? null : value === "untagged" ? "" : value.slice(4));
            }}
            aria-label="Filter notes by tag"
          >
            <option value="all">All tags</option>
            <option value="untagged">Untagged</option>
            {tagRows.map((tag) => <option key={tag.name} value={`tag:${tag.name}`}>#{tag.name} ({tag.count})</option>)}
          </select>
        </label>
        {selectedTag !== null && (
          <button
            className="tag-pill active-filter"
            onClick={onClearTag}
            title="Clear tag filter"
            aria-label={`Clear ${selectedTag === "" ? "untagged" : `${selectedTag} tag`} filter`}
          >
            <span aria-hidden="true">#</span>{selectedTag === "" ? "Untagged" : selectedTag}
            <span className="filter-clear" aria-hidden="true">×</span>
          </button>
        )}
      </div>

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
                  <NoteCardPreview note={note} />
                </button>
                <span className="note-card-foot">
                  <span>{formatGridDate(note.updatedAt)}{note.attachments.length > 0 ? ` · 📎${note.attachments.length}` : ""}</span>
                  <span className="note-card-actions">
                    <button
                      type="button"
                      className="card-icon-button card-download"
                      onClick={() => downloadNoteFile(note)}
                      title={`Download as .${noteFileExtension(note)}`}
                      aria-label={`Download ${note.title || "Untitled"} as .${noteFileExtension(note)}`}
                    ><DownloadIcon /></button>
                    <button
                      type="button"
                      className="card-icon-button card-image"
                      onClick={() => downloadNotePng(note)}
                      title="Download as image (.png)"
                      aria-label={`Download ${note.title || "Untitled"} as image`}
                    ><ImageIcon /></button>
                    <button
                      type="button"
                      className="card-icon-button card-delete"
                      onClick={() => setPendingDelete(note)}
                      title={`Delete ${note.title || "Untitled"}`}
                      aria-label={`Delete ${note.title || "Untitled"}`}
                    ><TrashIcon /></button>
                    <button
                      type="button"
                      className="card-icon-button card-open"
                      onClick={() => onSelect(note.id)}
                      title={`Open ${note.title || "Untitled"}`}
                      aria-label={`Open ${note.title || "Untitled"}`}
                    ><OpenIcon /></button>
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

function NoteCardPreview({ note }: { note: Note }) {
  const content = note.content.trim();
  if (!content) {
    return <span className="note-card-snippet">Empty note — click to start writing.</span>;
  }

  const preview = content.length > 600 ? `${content.slice(0, 600)}…` : content;
  if (note.type === "md") {
    return (
      <span className="note-card-snippet note-card-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <span className="card-preview-heading">{children}</span>,
            h2: ({ children }) => <span className="card-preview-heading">{children}</span>,
            h3: ({ children }) => <span className="card-preview-heading">{children}</span>,
            h4: ({ children }) => <span className="card-preview-heading">{children}</span>,
            h5: ({ children }) => <span className="card-preview-heading">{children}</span>,
            h6: ({ children }) => <span className="card-preview-heading">{children}</span>,
            p: ({ children }) => <span className="card-preview-paragraph">{children}</span>,
            blockquote: ({ children }) => <span className="card-preview-quote">{children}</span>,
            ul: ({ children }) => <span className="card-preview-list">{children}</span>,
            ol: ({ children }) => <span className="card-preview-list">{children}</span>,
            li: ({ children }) => <span className="card-preview-list-item">• {children}</span>,
            pre: ({ children }) => <span className="card-preview-code">{children}</span>,
            code: ({ children, className }) => className
              ? <code className="card-preview-block-code">{children}</code>
              : <span className="card-preview-inline-code">{children}</span>,
            a: ({ children }) => <span className="card-preview-link">{children}</span>,
            img: ({ alt }) => <span className="card-preview-image">Image: {alt || "attachment"}</span>,
            hr: () => <span className="card-preview-divider" />,
            table: ({ children }) => <span className="card-preview-table">{children}</span>,
            thead: ({ children }) => <span>{children}</span>,
            tbody: ({ children }) => <span>{children}</span>,
            tr: ({ children }) => <span className="card-preview-table-row">{children}</span>,
            th: ({ children }) => <span className="card-preview-table-cell">{children}</span>,
            td: ({ children }) => <span className="card-preview-table-cell">{children}</span>,
          }}
        >
          {preview}
        </ReactMarkdown>
      </span>
    );
  }

  if (note.type === "csharp" || note.type === "sql" || note.type === "json" || note.type === "xml") {
    return <span className="note-card-snippet card-preview-code note-card-code-preview"><code>{preview}</code></span>;
  }
  return <span className="note-card-snippet">{preview}</span>;
}

function formatGridDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12m-5-5 5 5 5-5" />
      <path d="M5 17v3h14v-3" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m21 15-5-5L5 20" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 5h6v6m0-6-9 9" />
      <path d="M18 13v6H5V6h6" />
    </svg>
  );
}
