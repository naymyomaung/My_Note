import { useState } from "react";
import { isNoteType, NOTE_TYPES, type NoteType } from "../types/note";

interface NewNoteDialogProps {
  existingTags: string[];
  onClose: () => void;
  onConfirm: (title: string, tags: string[], type: NoteType) => void;
}

const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  md: "Markdown (.md)",
  txt: "Text (.txt)",
  csharp: "C# (.cs)",
  sql: "SQL (.sql)",
  json: "JSON (.json)",
  xml: "XML (.xml)",
};

export default function NewNoteDialog({ existingTags, onClose, onConfirm }: NewNoteDialogProps) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<NoteType>("md");
  const [checked, setChecked] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [customTags, setCustomTags] = useState<string[]>([]);

  const allTags = [...customTags, ...existingTags.filter((tag) => !customTags.some((t) => t.toLowerCase() === tag.toLowerCase()))];

  function toggle(tag: string): void {
    setChecked((current) => current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]);
  }

  function addNewTag(): void {
    const cleaned = newTag.trim().replace(/\s+/g, " ").slice(0, 24);
    if (!cleaned) return;
    const match = allTags.find((tag) => tag.toLowerCase() === cleaned.toLowerCase());
    const finalName = match ?? cleaned;
    if (!match) setCustomTags((current) => [...current, cleaned]);
    if (!checked.includes(finalName)) setChecked((current) => [...current, finalName]);
    setNewTag("");
  }

  function confirm(): void {
    onConfirm(title.trim() || "Untitled", checked, type);
  }

  return (
    <div className="dialog-backdrop tag-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="confirm-dialog tag-dialog" role="dialog" aria-modal="true" aria-labelledby="new-note-title">
        <h2 id="new-note-title">New note</h2>
        <p>Give it a title and pick tags — or leave empty and style it later.</p>

        <label className="form-field">
          <span>Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") confirm(); }}
            placeholder="Untitled"
            autoFocus
            maxLength={160}
          />
        </label>

        <label className="form-field">
          <span>Type</span>
          <select
            className="dropdown-select"
            value={type}
            onChange={(event) => {
              if (isNoteType(event.target.value)) setType(event.target.value);
            }}
            aria-label="Note type"
          >
            {NOTE_TYPES.map((noteType) => (
              <option key={noteType} value={noteType}>{NOTE_TYPE_LABELS[noteType]}</option>
            ))}
          </select>
        </label>

        <div className="form-field">
          <span>Tags {checked.length > 0 && `(${checked.length} selected)`}</span>
          <div className="tag-pick-box">
            <div className="tag-drop-new">
              <input
                value={newTag}
                onChange={(event) => setNewTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addNewTag();
                  }
                }}
                placeholder="+ Type a new tag, Enter to add"
                maxLength={24}
                aria-label="Create a new tag"
              />
              <button type="button" className="secondary-button tag-add-button" onClick={addNewTag}>Add</button>
            </div>
            {allTags.length === 0 ? (
              <p className="tag-drop-empty">No tags yet — type one above and press Add.</p>
            ) : (
              <div className="tag-chip-wrap">
                {allTags.map((tag) => {
                  const active = checked.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`tag-chip${active ? " selected" : ""}`}
                      onClick={() => toggle(tag)}
                      aria-pressed={active}
                    >
                      <span aria-hidden="true">{active ? "✓ " : "+ "}</span>#{tag}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="dialog-actions tag-dialog-actions">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={confirm}>Create note</button>
        </div>
      </section>
    </div>
  );
}
