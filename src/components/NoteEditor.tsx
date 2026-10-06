import { isValidElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import powershell from "react-syntax-highlighter/dist/esm/languages/prism/powershell";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import ini from "react-syntax-highlighter/dist/esm/languages/prism/ini";

SyntaxHighlighter.registerLanguage("csharp", csharp);
SyntaxHighlighter.registerLanguage("sql", sql);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("powershell", powershell);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("diff", diff);
SyntaxHighlighter.registerLanguage("markup", markup);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("java", java);
SyntaxHighlighter.registerLanguage("c", c);
SyntaxHighlighter.registerLanguage("cpp", cpp);
SyntaxHighlighter.registerLanguage("ini", ini);
import { deleteAttachmentBlob, getAttachmentBlob, saveAttachmentBlob } from "../services/attachmentBlobs";
import { randomId } from "../services/noteStorage";
import { downloadNoteFile, downloadNotePng, noteFileExtension } from "../services/noteExport";
import { isNoteType, NOTE_TYPES, type Attachment, type Note, type NoteType } from "../types/note";

interface NoteEditorProps {
  note: Note;
  onUpdate: (updates: Partial<Pick<Note, "title" | "content" | "type" | "tags" | "attachments">>) => void;
  onDelete: (everywhere: boolean) => void;
  onBack: () => void;
  willDeleteRemote: boolean;
}

export function NoteContentPreview({ note }: { note: Note }) {
  if (!note.content.trim()) return <p className="preview-empty">Nothing to preview yet.</p>;
  if (note.type === "md") {
    return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: PreBlock, code: CodeSpan, a: MarkdownLink }}>{note.content}</ReactMarkdown>;
  }
  if (note.type === "txt") return <pre className="plain-text-preview">{note.content}</pre>;
  const language = NOTE_TYPE_LANGUAGES[note.type];
  return language
    ? <CodeBlock language={language.label} prismLanguage={language.prism} code={note.content} />
    : <pre className="plain-text-preview">{note.content}</pre>;
}

export default function NoteEditor({ note, onUpdate, onDelete, onBack, willDeleteRemote }: NoteEditorProps) {
  const [mode, setMode] = useState<"write" | "split" | "preview">("split");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageExportError, setImageExportError] = useState<string | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      if (confirmDelete) setConfirmDelete(false);
      else onBack();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, onBack]);

  function updateContent(content: string): void {
    onUpdate({ title: note.title, content, tags: note.tags, attachments: note.attachments });
  }

  async function handleDownloadImage(): Promise<void> {
    setImageExportError(null);
    try {
      await downloadNotePng(note);
    } catch (error) {
      setImageExportError(error instanceof Error ? error.message : "Could not download the note preview image.");
    }
  }

  function wrapSelection(before: string, after: string, placeholder: string): void {
    const el = textAreaRef.current;
    if (!el) {
      updateContent(`${note.content}${before}${placeholder}${after}`);
      return;
    }
    const { selectionStart: start, selectionEnd: end, value } = el;
    const selected = value.slice(start, end);
    const insert = selected || placeholder;
    updateContent(value.slice(0, start) + before + insert + after + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      if (selected) {
        el.setSelectionRange(start + before.length, start + before.length + selected.length);
      } else {
        el.setSelectionRange(start + before.length, start + before.length + placeholder.length);
      }
    });
  }

  function prefixLines(prefix: string): void {
    const el = textAreaRef.current;
    if (!el) {
      updateContent(`${prefix}${note.content}`);
      return;
    }
    const { selectionStart: start, selectionEnd: end, value } = el;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = value.indexOf("\n", end);
    const targetEnd = lineEnd === -1 ? value.length : lineEnd;
    const block = value.slice(lineStart, targetEnd);
    const prefixed = block.split("\n").map((line) => `${prefix}${line}`).join("\n");
    updateContent(value.slice(0, lineStart) + prefixed + value.slice(targetEnd));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, end + prefix.length * prefixed.split("\n").length);
    });
  }

  function insertBlock(snippet: string): void {
    const el = textAreaRef.current;
    if (!el) {
      updateContent(`${note.content.replace(/\s+$/, "")}\n\n${snippet}\n`);
      return;
    }
    const { selectionStart: start, selectionEnd: end, value } = el;
    const next = `${value.slice(0, start)}\n\n${snippet}\n${value.slice(end)}`.replace(/\n{3,}/g, "\n\n");
    updateContent(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + 2 + snippet.length + 1;
      el.setSelectionRange(cursor, cursor);
    });
  }

  const TABLE_TEMPLATE = "| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |";

  const CODE_BLOCK_TYPES = [
    { label: "C#", fence: "csharp", sample: "// C# code here" },
    { label: "SQL", fence: "sql", sample: "-- SQL query here" },
    { label: "JSON", fence: "json", sample: '{ "key": "value" }' },
    { label: "JavaScript", fence: "javascript", sample: "// JavaScript here" },
    { label: "TypeScript", fence: "typescript", sample: "// TypeScript here" },
    { label: "Python", fence: "python", sample: "# Python here" },
    { label: "Java", fence: "java", sample: "// Java here" },
    { label: "Bash", fence: "bash", sample: "# Bash here" },
    { label: "PowerShell", fence: "powershell", sample: "# PowerShell here" },
    { label: "YAML", fence: "yaml", sample: "# YAML here" },
    { label: "Markdown", fence: "markdown", sample: "# Markdown here" },
    { label: "TXT (plain)", fence: "", sample: "plain text here" },
  ];
  const [codeDropOpen, setCodeDropOpen] = useState(false);

  function insertCodeBlock(fence: string, sample: string): void {
    insertBlock(`\`\`\`${fence}\n${sample}\n\`\`\``);
    setCodeDropOpen(false);
  }

  return (
    <main className="editor">
      <div className="editor-toolbar">
        <div className="toolbar-row toolbar-main">
          <div className="breadcrumb">
            <button className="back-button" onClick={onBack} aria-label="Back to all notes" title="Back to all notes (Esc)">←</button>
            <span>My notes</span>
          </div>
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
              className={`editor-tab${mode === "split" ? " active" : ""}`}
              onClick={() => setMode("split")}
              role="tab"
              aria-selected={mode === "split"}
            >
              <SplitIcon /> Split
            </button>
            <button
              className={`editor-tab${mode === "preview" ? " active" : ""}`}
              onClick={() => setMode("preview")}
              role="tab"
              aria-selected={mode === "preview"}
            >
              <EyeIcon /> Preview
            </button>
          </div>
          <div className="toolbar-actions">
            <span className="saved-label"><span className="status-dot" /> Saved</span>
            <button
              className="icon-button"
              onClick={() => downloadNoteFile(note)}
              aria-label={`Download note as .${noteFileExtension(note)}`}
              title={`Download as .${noteFileExtension(note)}`}
            >
              <MdIcon />
            </button>
            <button
              className="icon-button"
              onClick={() => void handleDownloadImage()}
              aria-label="Download note as image"
              title="Download as image (.png)"
            >
              <ImageIcon />
            </button>
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
        {imageExportError && <p className="backup-error" role="alert">{imageExportError}</p>}
        <div className="toolbar-row title-tag-row">
          <input
            className="title-input toolbar-title"
            value={note.title}
            onChange={(event) => onUpdate({ title: event.target.value })}
            placeholder="Untitled"
            aria-label="Note title"
            maxLength={160}
          />
          <label className="note-type-field">
            <span>Type</span>
            <select
              className="dropdown-select"
              value={note.type}
              onChange={(event) => {
                if (isNoteType(event.target.value)) onUpdate({ type: event.target.value });
              }}
              aria-label="Note type"
            >
              {NOTE_TYPES.map((noteType) => (
                <option key={noteType} value={noteType}>{NOTE_TYPE_LABELS[noteType]}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <article className={`document${mode === "split" ? " document-wide" : ""}`}>
        {mode === "split" ? (
          <div className="studio-grid">
            <div className="studio-left">
              {note.type === "md" && <div className="md-toolbar" role="toolbar" aria-label="Markdown formatting">
                <button type="button" title="Heading 1" onClick={() => prefixLines("# ")}>H1</button>
                <button type="button" title="Heading 2" onClick={() => prefixLines("## ")}>H2</button>
                <button type="button" title="Bold" onClick={() => wrapSelection("**", "**", "bold")}><strong>B</strong></button>
                <button type="button" title="Italic" onClick={() => wrapSelection("*", "*", "italic")}><em>I</em></button>
                <button type="button" title="Inline code" onClick={() => wrapSelection("`", "`", "code")}>{"<>"}</button>
                <button type="button" title="Quote" onClick={() => prefixLines("> ")}>❝</button>
                <button type="button" title="Link" onClick={() => wrapSelection("[", "](https://)", "text")}>🔗</button>
                <button type="button" title="Image" onClick={() => insertBlock("![alt](https://)")}>🖼</button>
                <button type="button" title="Bullet list" onClick={() => prefixLines("- ")}>•≡</button>
                <button type="button" title="Checklist" onClick={() => prefixLines("- [ ] ")}>☑</button>
                <span className="md-code-wrap">
                  <button type="button" title="Code block — pick a language" onClick={() => setCodeDropOpen((open) => !open)} aria-expanded={codeDropOpen} aria-haspopup="menu">{"{ }"} ▾</button>
                  {codeDropOpen && (
                    <>
                      <span className="md-code-scrim" role="presentation" onMouseDown={() => setCodeDropOpen(false)} />
                      <span className="md-code-panel" role="menu" aria-label="Code block language">
                        {CODE_BLOCK_TYPES.map((entry) => (
                          <button
                            key={entry.label}
                            type="button"
                            role="menuitem"
                            onClick={() => insertCodeBlock(entry.fence, entry.sample)}
                          >
                            <span className="code-block-lang">{entry.label}</span>
                            <span className="md-code-fence">{entry.fence ? `\`\`\`${entry.fence}` : "```"}</span>
                          </button>
                        ))}
                      </span>
                    </>
                  )}
                </span>
                <button type="button" title="Table" onClick={() => insertBlock(TABLE_TEMPLATE)}>⊞</button>
                <button type="button" title="Divider" onClick={() => insertBlock("---")}>―</button>
              </div>}
              <textarea
                ref={textAreaRef}
                className="markdown-input studio-input"
                value={note.content}
                onChange={(event) => updateContent(event.target.value)}
                placeholder={note.type === "md" ? "Start writing…" : `Write ${NOTE_TYPE_LABELS[note.type].split(" ")[0]} content…`}
                aria-label={`Note content (${note.type})`}
                spellCheck={note.type === "md" || note.type === "txt"}
              />
            </div>
            <div className="studio-right">
              <div className="markdown-preview studio-preview">
                <NoteContentPreview note={note} />
              </div>
              <AttachmentsBlock
                note={note}
                onChange={(attachments) => onUpdate({ attachments })}
              />
            </div>
          </div>
        ) : (
          <>
            {mode !== "preview" && (
              note.type === "md" && <div className="md-toolbar" role="toolbar" aria-label="Markdown formatting">
                <button type="button" title="Heading 1" onClick={() => prefixLines("# ")}>H1</button>
                <button type="button" title="Heading 2" onClick={() => prefixLines("## ")}>H2</button>
                <button type="button" title="Bold" onClick={() => wrapSelection("**", "**", "bold")}><strong>B</strong></button>
                <button type="button" title="Italic" onClick={() => wrapSelection("*", "*", "italic")}><em>I</em></button>
                <button type="button" title="Inline code" onClick={() => wrapSelection("`", "`", "code")}>{"<>"}</button>
                <button type="button" title="Quote" onClick={() => prefixLines("> ")}>❝</button>
                <button type="button" title="Link" onClick={() => wrapSelection("[", "](https://)", "text")}>🔗</button>
                <button type="button" title="Image" onClick={() => insertBlock("![alt](https://)")}>🖼</button>
                <button type="button" title="Bullet list" onClick={() => prefixLines("- ")}>•≡</button>
                <button type="button" title="Checklist" onClick={() => prefixLines("- [ ] ")}>☑</button>
                <span className="md-code-wrap">
                  <button type="button" title="Code block — pick a language" onClick={() => setCodeDropOpen((open) => !open)} aria-expanded={codeDropOpen} aria-haspopup="menu">{"{ }"} ▾</button>
                  {codeDropOpen && (
                    <>
                      <span className="md-code-scrim" role="presentation" onMouseDown={() => setCodeDropOpen(false)} />
                      <span className="md-code-panel" role="menu" aria-label="Code block language">
                        {CODE_BLOCK_TYPES.map((entry) => (
                          <button
                            key={entry.label}
                            type="button"
                            role="menuitem"
                            onClick={() => insertCodeBlock(entry.fence, entry.sample)}
                          >
                            <span className="code-block-lang">{entry.label}</span>
                            <span className="md-code-fence">{entry.fence ? `\`\`\`${entry.fence}` : "```"}</span>
                          </button>
                        ))}
                      </span>
                    </>
                  )}
                </span>
                <button type="button" title="Table" onClick={() => insertBlock(TABLE_TEMPLATE)}>⊞</button>
                <button type="button" title="Divider" onClick={() => insertBlock("---")}>―</button>
              </div>
            )}
            {mode === "write" ? (
              <textarea
                ref={textAreaRef}
                className="markdown-input"
                value={note.content}
                onChange={(event) => updateContent(event.target.value)}
                placeholder={note.type === "md" ? "Start writing...\n\nUse Markdown to format your thoughts." : `Write ${NOTE_TYPE_LABELS[note.type].split(" ")[0]} content…`}
                aria-label={`Note content (${note.type})`}
                spellCheck={note.type === "md" || note.type === "txt"}
              />
            ) : (
              <div className="markdown-preview">
                <NoteContentPreview note={note} />
              </div>
            )}
            <AttachmentsBlock
              note={note}
              onChange={(attachments) => onUpdate({ attachments })}
            />
          </>
        )}
      </article>

      <div className="editor-footer">
        <span><strong>{note.content.trim() ? note.content.trim().split(/\s+/).length : 0}</strong> words</span>
        <span>Edited {formatRelativeDate(note.updatedAt)}</span>
        <span>{NOTE_TYPE_LABELS[note.type]}</span>
      </div>

      {confirmDelete && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setConfirmDelete(false);
        }}>
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
            <h2 id="delete-title">Delete this note?</h2>
            <p>{willDeleteRemote
              ? "Remove it from this device only, or delete its Google Drive copy too?"
              : "This note will be permanently removed from this device."}</p>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="secondary-button" onClick={() => onDelete(false)}>Local only</button>
              <button className="danger-button" onClick={() => onDelete(true)}>Delete everywhere</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

const ATTACH_ACCEPT = ".cs,.sql,.txt,.json,.md,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg";
const MAX_ATTACH_BYTES = 15 * 1024 * 1024;

function AttachmentsBlock({ note, onChange }: { note: Note; onChange: (attachments: Attachment[]) => void }) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [attachError, setAttachError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const attachment of note.attachments) {
        if (!attachment.mimeType.startsWith("image/")) continue;
        try {
          const blob = await getAttachmentBlob(attachment.id);
          if (blob && !cancelled) {
            const url = URL.createObjectURL(blob);
            urls.push(url);
            next[attachment.id] = url;
          }
        } catch {
          // Thumbnail is optional; the file row still renders.
        }
      }
      if (!cancelled) setThumbs(next);
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [note.attachments]);

  async function pickFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    setAttachError(null);
    setBusy(true);
    try {
      const additions: Attachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > MAX_ATTACH_BYTES) {
          setAttachError(`"${file.name}" is over 15 MB and was skipped.`);
          continue;
        }
        const id = randomId();
        await saveAttachmentBlob(id, file);
        additions.push({
          id,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          updatedAt: new Date().toISOString(),
        });
      }
      if (additions.length === 0) return;
      const replaced = note.attachments.filter((current) =>
        additions.some((next) => next.name.toLowerCase() === current.name.toLowerCase()),
      );
      for (const old of replaced) {
        await deleteAttachmentBlob(old.id).catch(() => undefined);
      }
      const remaining = note.attachments.filter((current) => !replaced.includes(current));
      onChange([...remaining, ...additions]);
    } catch {
      setAttachError("Files could not be attached in this browser.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function downloadFile(attachment: Attachment): Promise<void> {
    try {
      const blob = await getAttachmentBlob(attachment.id);
      if (!blob) {
        setAttachError(`"${attachment.name}" has no local bytes yet — sync it down first.`);
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      setAttachError(`"${attachment.name}" could not be opened.`);
    }
  }

  async function removeFile(attachment: Attachment): Promise<void> {
    await deleteAttachmentBlob(attachment.id).catch(() => undefined);
    onChange(note.attachments.filter((entry) => entry.id !== attachment.id));
  }

  return (
    <div className="attachments">
      <div className="attachments-head">
        <span>ATTACHMENTS{note.attachments.length > 0 ? ` (${note.attachments.length})` : ""}</span>
        <button className="secondary-button attach-button" onClick={() => fileInput.current?.click()} disabled={busy}>
          {busy ? "Adding…" : "+ Attach files"}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          hidden
          onChange={(event) => void pickFiles(event.target.files)}
        />
      </div>
      <p className="attachments-hint">C#, SQL, TXT, JSON, Markdown and images. Files ride along with ↑ Upload and ↓ Sync.</p>
      {attachError && <p className="backup-error" role="alert">{attachError}</p>}
      {note.attachments.length > 0 && (
        <div className="attachment-list">
          {note.attachments.map((attachment) => (
            <div key={attachment.id} className="attachment-item">
              {thumbs[attachment.id] ? (
                <img src={thumbs[attachment.id]} alt="" className="attachment-thumb" />
              ) : (
                <span className="attachment-icon" aria-hidden="true">{iconFor(attachment.name)}</span>
              )}
              <div className="attachment-meta">
                <strong>{attachment.name}</strong>
                <span>{formatBytes(attachment.size)}</span>
              </div>
              <button className="attachment-action" onClick={() => void downloadFile(attachment)} title={`Download ${attachment.name}`} aria-label={`Download ${attachment.name}`}>⤓</button>
              <button className="attachment-action attachment-remove" onClick={() => void removeFile(attachment)} title={`Remove ${attachment.name}`} aria-label={`Remove ${attachment.name}`}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function iconFor(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "cs") return "#";
  if (ext === "sql") return "▤";
  if (ext === "json") return "{}";
  if (ext === "md") return "M↓";
  if (ext === "txt") return "≡";
  return "❏";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const CODE_ALIASES: Record<string, string> = {
  "c#": "csharp",
  cs: "csharp",
  js: "javascript",
  ts: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  sh: "bash",
  shell: "bash",
  ps1: "powershell",
  yml: "yaml",
  py: "python",
  rb: "ruby",
  kt: "kotlin",
};

const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  md: "Markdown (.md)",
  txt: "Text (.txt)",
  csharp: "C# (.cs)",
  sql: "SQL (.sql)",
  json: "JSON (.json)",
  xml: "XML (.xml)",
};

const NOTE_TYPE_LANGUAGES: Partial<Record<NoteType, { label: string; prism: string }>> = {
  csharp: { label: "C#", prism: "csharp" },
  sql: { label: "SQL", prism: "sql" },
  json: { label: "JSON", prism: "json" },
  xml: { label: "XML", prism: "markup" },
};

const SUPPORTED_LANGUAGES = new Set([
  "csharp", "sql", "json", "javascript", "typescript", "jsx", "tsx", "python",
  "java", "c", "cpp", "css", "markup", "bash", "powershell", "yaml",
  "markdown", "diff", "ini",
]);

const LANGUAGE_LABELS: Record<string, string> = {
  csharp: "C#",
  javascript: "JS",
  typescript: "TS",
  markup: "HTML",
};

const brutalistCodeStyle: Record<string, CSSProperties> = {
  'code[class*="language-"]': {
    color: "#f2ede0",
    background: "none",
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: "12px",
    lineHeight: 1.7,
    textShadow: "none",
  },
  'pre[class*="language-"]': {
    color: "#f2ede0",
    background: "none",
    margin: 0,
    padding: "14px 16px 16px",
    overflow: "auto",
  },
  comment: { color: "#8a8676", fontStyle: "italic" },
  prolog: { color: "#8a8676" },
  doctype: { color: "#8a8676" },
  cdata: { color: "#8a8676" },
  punctuation: { color: "#b8b2a2" },
  keyword: { color: "#ff90e8", fontWeight: 700 },
  tag: { color: "#ff90e8" },
  important: { color: "#ff90e8", fontWeight: 700 },
  bold: { fontWeight: 700 },
  string: { color: "#7ee2a8" },
  char: { color: "#7ee2a8" },
  "attr-value": { color: "#7ee2a8" },
  regex: { color: "#7ee2a8" },
  function: { color: "#7df9ff" },
  "class-name": { color: "#ffd02f" },
  number: { color: "#ffd02f" },
  boolean: { color: "#ffd02f" },
  constant: { color: "#ffd02f" },
  operator: { color: "#ff90e8" },
  property: { color: "#7df9ff" },
  selector: { color: "#7ee2a8" },
  "attr-name": { color: "#7df9ff" },
  variable: { color: "#f2ede0" },
  builtin: { color: "#7df9ff" },
  inserted: { color: "#7ee2a8" },
  deleted: { color: "#ff5c5c" },
  italic: { fontStyle: "italic" },
  entity: { color: "#ffd02f" },
  url: { color: "#7df9ff" },
};

function PreBlock({ children }: { children?: ReactNode }) {
  const child = Array.isArray(children) ? children[0] : children;
  if (isValidElement(child) && child.type === CodeBlock) return <>{children}</>;
  return <pre className="plain-pre">{children}</pre>;
}

function CodeSpan({ className, children }: { className?: string; children?: ReactNode }) {
  const match = /language-([\w#+-]+)/.exec(className ?? "");
  const requested = (match?.[1] ?? "").toLowerCase();
  const language = CODE_ALIASES[requested] ?? requested;
  const text = (Array.isArray(children) ? children.join("") : String(children ?? "")).replace(/\n$/, "");
  if (language && SUPPORTED_LANGUAGES.has(language)) {
    return <CodeBlock language={LANGUAGE_LABELS[language] ?? requested.toUpperCase()} prismLanguage={language} code={text} />;
  }
  return <code className={className}>{children}</code>;
}

function CodeBlock({ language, prismLanguage, code }: { language: string; prismLanguage: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const area = document.createElement("textarea");
      area.value = code;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-block-lang">{language}</span>
        <button type="button" className="code-copy-button" onClick={() => void copy()}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter language={prismLanguage} style={brutalistCodeStyle} customStyle={{ margin: 0, background: "transparent" }}>
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
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

function MdIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.5h14v9H3zM7 8v5m0-2.5h4M11 8v5" /></svg>;
}

function ImageIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="11" rx="1.5" /><circle cx="7.5" cy="9" r="1.4" /><path d="m4.5 14 3.5-3.5 2.5 2.5 2-2 3 3" /></svg>;
}

function TrashIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11m-9.5 0 .6 9.2c.1.8.7 1.3 1.5 1.3h3.8c.8 0 1.4-.5 1.5-1.3L14 6M8 6V4.5c0-.6.4-1 1-1h2c.6 0 1 .4 1 1V6m-3 2.5v5m3-5v5" /></svg>;
}

function PenIcon() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m3 12.8-.7 3 3-.7L15 6.4 11.6 3 3 11.6v1.2ZM10.5 4.1l3.4 3.4" /></svg>;
}

function SplitIcon() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><rect x="2.5" y="3.5" width="13" height="11" rx="1.5" /><path d="M9 3.5v11" /></svg>;
}

function EyeIcon() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 9s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z" /><circle cx="9" cy="9" r="1.7" /></svg>;
}
