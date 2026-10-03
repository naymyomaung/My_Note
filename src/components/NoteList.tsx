import { useState } from "react";

export interface TagRow {
  name: string;
  count: number;
}

interface SidebarProps {
  search: string;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onOpenSync: () => void;
  onToggleSidebar: () => void;
  tagRows: TagRow[];
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
  onCreateTag: (tag: string) => void;
  onRenameTag: (oldName: string, newName: string) => void;
  onDeleteTag: (tag: string) => void;
  isOnline: boolean;
}

export default function NoteList({
  search,
  onSearchChange,
  onCreate,
  onOpenSync,
  onToggleSidebar,
  tagRows,
  selectedTag,
  onSelectTag,
  onCreateTag,
  onRenameTag,
  onDeleteTag,
  isOnline,
}: SidebarProps) {
  const [showTagDialog, setShowTagDialog] = useState(false);
  const [renameTag, setRenameTag] = useState<string | null>(null);
  const [pendingDeleteTag, setPendingDeleteTag] = useState<string | null>(null);
  const pendingDeleteCount = pendingDeleteTag !== null
    ? tagRows.find((row) => row.name === pendingDeleteTag)?.count ?? 0
    : 0;

  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-logo" src={`${import.meta.env.BASE_URL}logo.jfif`} alt="My Note logo" />
        <span>my notes</span>
        <button className="sidebar-close" onClick={onToggleSidebar} aria-label="Close menu" title="Close menu">×</button>
        <button className="sidebar-hide" onClick={onToggleSidebar} aria-label="Hide sidebar" title="Hide sidebar">◀</button>
      </div>

      <button className="new-note-button" onClick={onCreate} title="New note (Ctrl/⌘ N)">
        <span aria-hidden="true">＋</span> New note
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
      </label>

      <div className="tag-new-row">
        <button className="tag-new-button" onClick={() => setShowTagDialog(true)} title="New tag folder" aria-label="New tag folder"><span aria-hidden="true">＋</span> New tag</button>
      </div>

      <nav className="tag-list" aria-label="Tag folders">
        <button
          className={`tag-row${selectedTag === null ? " selected" : ""}`}
          onClick={() => onSelectTag(null)}
        >
          <span className="tag-row-icon" aria-hidden="true">✳</span>
          <span className="tag-row-name">All notes</span>
        </button>
        {tagRows.map((row) => (
          <div
            key={row.name}
            className={`tag-row${selectedTag === row.name ? " selected" : ""}`}
          >
            <button
              className="tag-row-main"
              onClick={() => onSelectTag(selectedTag === row.name ? null : row.name)}
              aria-pressed={selectedTag === row.name}
              title={`Show ${row.name} notes`}
            >
              <span className="tag-row-icon" aria-hidden="true">#</span>
              <span className="tag-row-name">{row.name}</span>
              <span className="tag-count">{row.count}</span>
            </button>
            <button
              className="tag-row-delete tag-row-rename"
              onClick={() => setRenameTag(row.name)}
              title={`Rename tag ${row.name}`}
              aria-label={`Rename tag ${row.name}`}
            >✎</button>
            <button
              className="tag-row-delete"
              onClick={() => setPendingDeleteTag(row.name)}
              title={`Delete tag ${row.name}`}
              aria-label={`Delete tag ${row.name}`}
            >×</button>
          </div>
        ))}
        {tagRows.length === 0 && (
          <p className="empty-list">No tags yet. Create one, then add it to a note.</p>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="local-status"><span className={`status-dot${isOnline ? "" : " offline-dot"}`} /> {isOnline ? "Saved on this device" : "Offline · saved locally"}</div>
        <div className="sidebar-tools">
          <button className="sidebar-tool" onClick={onOpenSync} aria-label="Google Drive sync and backup" title="Google Drive sync and backup">
            <CloudIcon /> Sync
          </button>
        </div>
      </div>

      {showTagDialog && (
        <TagDialog
          existing={tagRows.map((row) => row.name)}
          onClose={() => setShowTagDialog(false)}
          onCreate={(name) => { onCreateTag(name); setShowTagDialog(false); }}
        />
      )}

      {renameTag !== null && (
        <TagDialog
          existing={tagRows.map((row) => row.name).filter((name) => name.toLowerCase() !== renameTag.toLowerCase())}
          initialName={renameTag}
          title="Rename tag"
          description={`Rename “${renameTag}” everywhere — sidebar, notes, and next Drive sync.`}
          submitLabel="Rename tag"
          onClose={() => setRenameTag(null)}
          onCreate={(name) => { onRenameTag(renameTag, name); setRenameTag(null); }}
        />
      )}

      {pendingDeleteTag !== null && (
        <div className="dialog-backdrop tag-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPendingDeleteTag(null);
        }}>
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="tag-delete-title">
            <h2 id="tag-delete-title">Delete this tag?</h2>
            <p>
              <strong>“{pendingDeleteTag}”</strong>
              {pendingDeleteCount > 0
                ? ` will be removed from ${pendingDeleteCount} note${pendingDeleteCount === 1 ? "" : "s"}.`
                : " has no notes."} Notes themselves stay — press Upload to push the removal to Drive.
            </p>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setPendingDeleteTag(null)}>Cancel</button>
              <button
                className="danger-button"
                onClick={() => { onDeleteTag(pendingDeleteTag); setPendingDeleteTag(null); }}
              >
                Delete tag
              </button>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}

function TagDialog({ existing, initialName = "", title = "New tag folder", description = "Name a tag to group notes. Add it to notes from the editor — clicking a tag filters the cards.", submitLabel = "Create tag", onClose, onCreate }: {
  existing: string[];
  initialName?: string;
  title?: string;
  description?: string;
  submitLabel?: string;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);

  function submit(): void {
    const cleaned = name.trim().replace(/\s+/g, " ").slice(0, 24);
    if (!cleaned) {
      setError("Give the tag a name first.");
      return;
    }
    if (existing.some((tag) => tag.toLowerCase() === cleaned.toLowerCase())) {
      setError(`“${cleaned}” already exists — pick another name.`);
      return;
    }
    onCreate(cleaned);
  }

  return (
    <div className="dialog-backdrop tag-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="confirm-dialog tag-dialog" role="dialog" aria-modal="true" aria-labelledby="tag-title">
        <h2 id="tag-title">{title}</h2>
        <p>{description}</p>
        <label className="form-field">
          <span>Tag name</span>
          <input
            value={name}
            onChange={(event) => { setName(event.target.value); setError(null); }}
            onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
            placeholder="e.g. work, ideas, recipes"
            autoFocus
            maxLength={24}
          />
        </label>
        {error && <p className="backup-error" role="alert">{error}</p>}
        <div className="dialog-actions tag-dialog-actions">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={submit}>{submitLabel}</button>
        </div>
      </section>
    </div>
  );
}

function CloudIcon() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M5.1 13.7h7.2a3 3 0 0 0 .3-6 4 4 0 0 0-7.6-1A3.5 3.5 0 0 0 5.1 13.7Z" /></svg>;
}
