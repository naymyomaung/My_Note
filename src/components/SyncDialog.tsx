import { useRef, useState } from "react";
import { readBackup, downloadBackup } from "../services/backup";
import type { GitHubRepositorySettings, Note, SyncPreviewItem } from "../types/note";

type Tab = "sync" | "settings" | "backup";

interface SyncController {
  settings: GitHubRepositorySettings;
  token: string;
  isConnected: boolean;
  preview: SyncPreviewItem[];
  busy: boolean;
  error: string | null;
  notice: string | null;
  lastSyncedAt: string | null;
  saveSettings: (settings: GitHubRepositorySettings) => void;
  saveToken: (token: string) => void;
  preparePreview: (notes: Note[]) => Promise<void>;
  createNotesFolder: () => Promise<void>;
  updateConflictChoice: (id: string, choice: SyncPreviewItem["conflictChoice"]) => void;
  invalidatePreview: () => void;
  applyPreview: (notes: Note[]) => Promise<void>;
}

interface SyncDialogProps {
  notes: Note[];
  controller: SyncController;
  onClose: () => void;
  onReplaceNotes: (notes: Note[]) => void;
}

export default function SyncDialog({ notes, controller, onClose, onReplaceNotes }: SyncDialogProps) {
  const [tab, setTab] = useState<Tab>("sync");
  const [settingsDraft, setSettingsDraft] = useState(controller.settings);
  const [tokenDraft, setTokenDraft] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<Note[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function importFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setBackupMessage(null);
    setBackupError(null);
    try {
      setPendingImport(await readBackup(file));
    } catch (cause) {
      setBackupError(cause instanceof Error ? cause.message : "The backup could not be imported.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function finishImport(imported: Note[], replace: boolean): void {
    try {
      if (replace) {
        downloadBackup(notes);
        onReplaceNotes(imported);
        setBackupMessage(`Replaced local notes with ${imported.length} imported notes. A backup was downloaded first.`);
      } else {
        const merged = new Map(notes.map((note) => [note.id, note]));
        for (const note of imported) merged.set(note.id, note);
        onReplaceNotes([...merged.values()]);
        setBackupMessage(`Merged ${imported.length} imported notes with your local notes.`);
      }
      setBackupError(null);
      setPendingImport(null);
    } catch (cause) {
      setBackupError(cause instanceof Error ? cause.message : "The imported notes could not be saved.");
    }
  }

  function saveSettings(): void {
    controller.saveSettings({
      owner: settingsDraft.owner.trim(),
      repository: settingsDraft.repository.trim(),
      branch: settingsDraft.branch.trim(),
      directory: settingsDraft.directory.trim().replace(/^\/+|\/+$/g, ""),
    });
  }

  const actionable = controller.preview.some((item) => (
    item.action === "upload" || item.action === "download" || item.action === "delete" ||
    (item.action === "conflict" && item.conflictChoice !== "skip") ||
    (item.action === "current" && item.needsBaseline)
  ));

  return (
    <div className="dialog-backdrop sync-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="sync-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-title">
        <header className="sync-dialog-header">
          <div>
            <span className="dialog-kicker">MY NOTE</span>
            <h2 id="sync-title">Your notes, in sync.</h2>
          </div>
          <button className="dialog-close" onClick={onClose} aria-label="Close sync settings">×</button>
        </header>

        <div className="sync-tabs" role="tablist" aria-label="Sync and backup">
          <button className={tab === "sync" ? "active" : ""} onClick={() => setTab("sync")} role="tab" aria-selected={tab === "sync"}>Sync</button>
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")} role="tab" aria-selected={tab === "settings"}>Settings</button>
          <button className={tab === "backup" ? "active" : ""} onClick={() => setTab("backup")} role="tab" aria-selected={tab === "backup"}>Backup</button>
        </div>

        {controller.error && <div className="sync-error" role="alert">{controller.error}</div>}
        {controller.notice && <div className="sync-notice" role="status">{controller.notice}</div>}

        {tab === "sync" && (
          <div className="sync-panel">
            <div className="connection-card">
              <span className={`connection-indicator${controller.isConnected ? " connected" : ""}`} />
              <div className="connection-copy">
                <strong>{controller.isConnected ? `${controller.settings.owner || "GitHub"} / ${controller.settings.repository || "Repository not set"}` : "GitHub not connected"}</strong>
                <span>{controller.isConnected ? `Branch ${controller.settings.branch} · ${controller.settings.directory || "repository root"}` : "Add a token and repository details to get started."}</span>
              </div>
              <button className="text-button" onClick={() => setTab("settings")}>{controller.isConnected ? "Edit" : "Set up"}</button>
            </div>
            <div className="sync-intro">
              <h3>Preview before you sync</h3>
              <p>Your local notes stay available offline. Review every upload, download, deletion, or conflict before applying changes. Create the configured notes folder in GitHub first, or leave Notes folder empty to use the repository root.</p>
            </div>
            <div className="sync-actions">
              <button className="secondary-button" onClick={() => void controller.preparePreview(notes)} disabled={controller.busy || !controller.isConnected}>
                {controller.busy ? "Checking…" : "Check for changes"}
              </button>
              {controller.settings.directory.trim() && (
                <button
                  className="text-button"
                  disabled={controller.busy || !controller.isConnected}
                  onClick={() => {
                    const confirmed = window.confirm(
                      `Create “${controller.settings.directory}” on branch “${controller.settings.branch}” in ${controller.settings.owner}/${controller.settings.repository}?\n\nThis creates one commit containing a .gitkeep file. It does not upload or change your notes.`,
                    );
                    if (confirmed) void controller.createNotesFolder();
                  }}
                >
                  Create notes folder
                </button>
              )}
              {controller.lastSyncedAt && <span className="last-synced">Last synced {formatDate(controller.lastSyncedAt)}</span>}
            </div>
            {controller.preview.length > 0 && (
              <div className="preview-list">
                <div className="preview-heading"><strong>Sync preview</strong><span>{controller.preview.length} notes</span></div>
                {controller.preview.map((item) => (
                  <PreviewRow key={item.id} item={item} onChoice={controller.updateConflictChoice} />
                ))}
                <div className="preview-footer">
                  <span>Nothing changes until you apply this preview.</span>
                  <button className="primary-button" onClick={() => void controller.applyPreview(notes)} disabled={controller.busy || !actionable}>
                    {controller.busy ? "Syncing…" : "Apply selected changes"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "settings" && (
          <div className="settings-panel">
            <p className="panel-description">Connect a repository dedicated to your notes. Create the configured notes folder on the selected branch before syncing, or leave it empty to use the repository root. A fine-grained token is kept in this browser tab session and is never included in note backups.</p>
            <label className="form-field">
              <span>Fine-grained GitHub token</span>
              <div className="token-input-row">
                <input
                  type={showToken ? "text" : "password"}
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.target.value)}
                  placeholder={controller.isConnected ? "Token saved for this session" : "github_pat_…"}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="text-button" onClick={() => setShowToken((value) => !value)} type="button">{showToken ? "Hide" : "Show"}</button>
              </div>
              <small>Grant access only to the selected repository, with Contents: Read and write.</small>
            </label>
            <div className="form-grid">
              <label className="form-field"><span>Owner</span><input value={settingsDraft.owner} onChange={(event) => setSettingsDraft({ ...settingsDraft, owner: event.target.value })} placeholder="your-username" autoComplete="off" /></label>
              <label className="form-field"><span>Repository</span><input value={settingsDraft.repository} onChange={(event) => setSettingsDraft({ ...settingsDraft, repository: event.target.value })} placeholder="my-notes" autoComplete="off" /></label>
            </div>
            <div className="form-grid">
              <label className="form-field"><span>Branch</span><input value={settingsDraft.branch} onChange={(event) => setSettingsDraft({ ...settingsDraft, branch: event.target.value })} placeholder="main" autoComplete="off" /></label>
              <label className="form-field"><span>Notes folder</span><input value={settingsDraft.directory} onChange={(event) => setSettingsDraft({ ...settingsDraft, directory: event.target.value })} placeholder="notes" autoComplete="off" /></label>
            </div>
            <div className="settings-note"><strong>Token safety</strong><span>This browser-only app sends your token directly to api.github.com over HTTPS. Anyone using this browser profile can access it while this tab session lasts. Revoke the token in GitHub when it is no longer needed.</span></div>
            <div className="panel-actions">
              {controller.isConnected && <button className="text-button disconnect-button" onClick={() => { controller.saveToken(""); setTokenDraft(""); }}>Remove token</button>}
              <button className="primary-button" onClick={() => { saveSettings(); if (tokenDraft.trim()) controller.saveToken(tokenDraft); setTokenDraft(""); }}>
                Save GitHub settings
              </button>
            </div>
          </div>
        )}

        {tab === "backup" && (
          <div className="backup-panel">
            <h3>Keep a copy of your notes.</h3>
            <p>Export a portable JSON backup or one combined Markdown document. Backups include note text and dates, never your GitHub token.</p>
            <div className="backup-actions">
              <button className="secondary-button" onClick={() => downloadBackup(notes)}>Download JSON backup</button>
              <button className="secondary-button" onClick={() => downloadMarkdown(notes)}>Export combined Markdown</button>
            </div>
            <div className="import-card">
              <div><strong>Import a backup</strong><span>Choose a My Note JSON backup. You can replace notes or merge them by ID.</span></div>
              <button className="text-button" onClick={() => fileInput.current?.click()}>Choose file</button>
              <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
            </div>
            {backupMessage && <p className="backup-success" role="status">{backupMessage}</p>}
            {backupError && <p className="backup-error" role="alert">{backupError}</p>}
            {pendingImport && (
              <div className="import-confirm">
                <strong>Import {pendingImport.length} notes?</strong>
                <span>Choose how these notes should be added to your library.</span>
                <div>
                  <button className="text-button" onClick={() => setPendingImport(null)}>Cancel</button>
                  <button className="secondary-button" onClick={() => finishImport(pendingImport, false)}>Merge by ID</button>
                  <button className="primary-button" onClick={() => finishImport(pendingImport, true)}>Replace all</button>
                </div>
              </div>
            )}
            <div className="settings-note"><strong>Automatic sync backup</strong><span>Before applying sync changes, your current notes are downloaded as a JSON backup.</span></div>
          </div>
        )}
      </section>
    </div>
  );
}

function PreviewRow({ item, onChoice }: { item: SyncPreviewItem; onChoice: SyncController["updateConflictChoice"] }) {
  const label = {
    upload: "Upload",
    download: "Download",
    delete: "Delete remote",
    conflict: "Conflict",
    current: "Up to date",
  }[item.action];
  return (
    <div className={`preview-row preview-${item.action}`}>
      <div className="preview-row-main">
        <span className="preview-action">{label}</span>
        <div><strong>{item.title}</strong><span>{item.reason}</span></div>
      </div>
      {item.action === "conflict" && (
        <div className="conflict-choices" role="group" aria-label={`Resolve conflict for ${item.title}`}>
          <label><input type="radio" name={`conflict-${item.id}`} checked={item.conflictChoice === "local"} onChange={() => onChoice(item.id, "local")} /> Keep local</label>
          <label><input type="radio" name={`conflict-${item.id}`} checked={item.conflictChoice === "remote"} onChange={() => onChoice(item.id, "remote")} /> Keep GitHub</label>
          <label><input type="radio" name={`conflict-${item.id}`} checked={item.conflictChoice === "skip"} onChange={() => onChoice(item.id, "skip")} /> Skip</label>
        </div>
      )}
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function downloadMarkdown(notes: Note[]): void {
  const sections = notes.map((note) =>
    `# ${note.title || "Untitled"}\n\n${note.content}\n`,
  );
  const blob = new Blob([sections.join("\n---\n\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "my-note-export.md";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
