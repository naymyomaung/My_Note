import type { Note } from "../types/note";

interface NoteListProps {
  notes: Note[];
  selectedId: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onOpenSync: () => void;
  onToggleTheme: () => void;
  isDark: boolean;
  isOnline: boolean;
}

export default function NoteList({
  notes,
  selectedId,
  search,
  onSearchChange,
  onSelect,
  onCreate,
  onOpenSync,
  onToggleTheme,
  isDark,
  isOnline,
}: NoteListProps) {
  const modifierKey = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">n</div>
        <span>my notes</span>
      </div>

      <button className="new-note-button" onClick={onCreate}>
        <span aria-hidden="true">＋</span> New note
        <kbd>{modifierKey} N</kbd>
      </button>

      <label className="search-box">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search notes..."
          aria-label="Search notes"
        />
        <kbd>{modifierKey} K</kbd>
      </label>

      <div className="list-heading">
        <span>YOUR NOTES</span>
        <span className="note-count">{notes.length}</span>
      </div>

      <nav className="note-list" aria-label="Notes">
        {notes.map((note) => (
          <button
            key={note.id}
            className={`note-list-item${selectedId === note.id ? " selected" : ""}`}
            onClick={() => onSelect(note.id)}
            aria-current={selectedId === note.id ? "page" : undefined}
          >
            <span className="note-item-title">{note.title || "Untitled"}</span>
            <span className="note-item-date">{formatListDate(note.updatedAt)}</span>
          </button>
        ))}
        {notes.length === 0 && (
          <p className="empty-list">{search ? "No matching notes." : "Your notes will appear here."}</p>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="local-status"><span className={`status-dot${isOnline ? "" : " offline-dot"}`} /> {isOnline ? "Saved on this device" : "Offline · saved locally"}</div>
        <div className="sidebar-tools">
          <button className="sidebar-tool" onClick={onOpenSync} aria-label="GitHub sync and backup" title="GitHub sync and backup">
            <CloudIcon /> Sync
          </button>
          <button className="sidebar-tool theme-tool" onClick={onToggleTheme} aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"} title={isDark ? "Light mode" : "Dark mode"}>
            {isDark ? "☼" : "☾"}
          </button>
        </div>
      </div>
    </aside>
  );
}

function CloudIcon() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M5.1 13.7h7.2a3 3 0 0 0 .3-6 4 4 0 0 0-7.6-1A3.5 3.5 0 0 0 5.1 13.7Z" /></svg>;
}

function formatListDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
