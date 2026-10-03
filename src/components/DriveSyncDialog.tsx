import { useRef, useState } from "react";
import { readBackup, downloadBackup } from "../services/backup";
import { requestDriveAccessToken, revokeDriveAccessToken } from "../services/googleAuth";
import type { GoogleDriveSettings, Note, SyncPreviewItem } from "../types/note";

type Tab = "sync" | "settings" | "backup";

interface SyncController {
  settings: GoogleDriveSettings;
  token: string;
  isConnected: boolean;
  preview: SyncPreviewItem[];
  busy: boolean;
  error: string | null;
  notice: string | null;
  lastSyncedAt: string | null;
  saveSettings: (settings: GoogleDriveSettings) => void;
  saveToken: (token: string) => void;
  preparePreview: (notes: Note[]) => Promise<void>;
  createNotesFolder: (folderName?: string) => Promise<void>;
  testConnection: () => Promise<void>;
  updateConflictChoice: (id: string, choice: SyncPreviewItem["conflictChoice"]) => void;
  togglePreviewExcluded: (id: string) => void;
  selectAllPreview: (select: boolean) => void;
  invalidatePreview: () => void;
  applyPreview: (notes: Note[], mode?: "all" | "upload" | "download") => Promise<void>;
  quickSync: (notes: Note[], mode: "upload" | "download") => Promise<{ applied: number; conflicts: number; driveFiles: number; downloaded: number }>;
}

interface SyncDialogProps {
  notes: Note[];
  controller: SyncController;
  onClose: () => void;
  onReplaceNotes: (notes: Note[]) => void;
}

export default function DriveSyncDialog({ notes, controller, onClose, onReplaceNotes }: SyncDialogProps) {
  const [tab, setTab] = useState<Tab>("sync");
  const [settingsDraft, setSettingsDraft] = useState(controller.settings);
  const [tokenDraft, setTokenDraft] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<Note[] | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [folderName, setFolderName] = useState("My Note Sync");
  const [confirmFolder, setConfirmFolder] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function runQuickSync(mode: "upload" | "download"): Promise<void> {
    setReviewing(false);
    const result = await controller.quickSync(notes, mode);
    if (result.conflicts > 0) setReviewing(true);
  }

  async function applyReview(): Promise<void> {
    await controller.applyPreview(notes, "all");
    setReviewing(false);
  }

  async function signInWithGoogle(): Promise<void> {
    const clientId = settingsDraft.clientId.trim() || controller.settings.clientId.trim();
    if (!clientId) {
      setAuthError("Enter your Google OAuth Client ID first (Google Cloud Console → APIs & Services → Credentials → OAuth client ID, type Web application).");
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      // Persist the client ID (and folder) so a reload keeps them.
      controller.saveSettings({
        clientId,
        folderId: settingsDraft.folderId.trim(),
      });
      setSettingsDraft((draft) => ({ ...draft, clientId, folderId: draft.folderId.trim() }));
      const accessToken = await requestDriveAccessToken(clientId);
      controller.saveToken(accessToken);
      setTokenDraft("");
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : "Google sign-in failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut(): Promise<void> {
    setAuthBusy(true);
    try {
      await revokeDriveAccessToken(controller.token);
    } finally {
      controller.saveToken("");
      setTokenDraft("");
      setAuthBusy(false);
    }
  }

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
      clientId: settingsDraft.clientId.trim(),
      folderId: settingsDraft.folderId.trim(),
    });
  }

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
            <div className="step">
              <span className="step-num" aria-hidden="true">1</span>
              <div className="step-body">
                <div className="connection-card">
                  <span className={`connection-indicator${controller.isConnected ? " connected" : ""}`} />
                  <div className="connection-copy">
                    <strong>{controller.isConnected ? `Google Drive · ${controller.settings.folderId || "Folder not set"}` : "Google Drive not connected"}</strong>
                    <span>{controller.isConnected ? `Folder: ${controller.settings.folderId || "not set"}` : "Go to Settings to sign in and pick a folder."}</span>
                  </div>
                  <span className={`status-pill${controller.isConnected ? " on" : ""}`}>{controller.isConnected ? "Live" : "Off"}</span>
                  <button className="text-button" onClick={() => setTab("settings")}>{controller.isConnected ? "Edit" : "Set up"}</button>
                </div>
              </div>
            </div>

            <div className="step">
              <span className="step-num" aria-hidden="true">2</span>
              <div className="step-body">
                <div className="apply-buttons quick-buttons">
                  <button className="primary-button upload-button" onClick={() => void runQuickSync("upload")} disabled={controller.busy || !controller.isConnected} title="Push local notes and deletions up to Google Drive">
                    <span className="dir-arrow" aria-hidden="true">↑</span> Upload <em>Local → Drive</em>
                  </button>
                  <button className="primary-button download-button" onClick={() => void runQuickSync("download")} disabled={controller.busy || !controller.isConnected} title="Pull Google Drive notes down to this device">
                    <span className="dir-arrow" aria-hidden="true">↓</span> Sync <em>Drive → Local</em>
                  </button>
                </div>
                <div className="step-subrow">
                  {controller.lastSyncedAt
                    ? <span className="last-synced">Last synced {formatDate(controller.lastSyncedAt)}</span>
                    : <span className="step-hint">Upload pushes notes + deletions up. Sync pulls Drive changes down.</span>}
                  <button
                    className="text-button"
                    disabled={controller.busy || !controller.isConnected}
                    onClick={() => { setFolderName("My Note Sync"); setShowFolderForm((open) => !open); }}
                  >
                    {showFolderForm ? "Hide folder form" : "Create notes folder"}
                  </button>
                </div>
                {showFolderForm && (
                  <div className="folder-form">
                    <input
                      value={folderName}
                      onChange={(event) => setFolderName(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter" && folderName.trim()) setConfirmFolder(true); }}
                      placeholder="Folder name, e.g. My Note Sync"
                      maxLength={80}
                      aria-label="New folder name"
                      disabled={controller.busy || !controller.isConnected}
                    />
                    <button
                      className="secondary-button"
                      disabled={controller.busy || !controller.isConnected || !folderName.trim()}
                      onClick={() => setConfirmFolder(true)}
                    >
                      Create
                    </button>
                  </div>
                )}
              </div>
            </div>

            {reviewing && controller.preview.length > 0 && (
              <div className="step">
                <span className="step-num" aria-hidden="true">!</span>
                <div className="step-body">
                  <div className="preview-list">
                    <div className="preview-heading"><strong>Conflicts to resolve</strong><span>{controller.preview.length}</span></div>
                    {controller.preview.map((item) => (
                      <PreviewRow key={item.id} item={item} onChoice={controller.updateConflictChoice} />
                    ))}
                  </div>
                  <div className="preview-footer apply-bar">
                    <span>Pick Keep local or Keep Drive per row, then apply.</span>
                    <div className="apply-buttons">
                      <button className="primary-button" onClick={() => void applyReview()} disabled={controller.busy}>
                        {controller.busy ? "Applying…" : "Apply choices"}
                      </button>
                      <button className="text-button" onClick={() => { controller.invalidatePreview(); setReviewing(false); }}>Dismiss</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {confirmFolder && (
          <div className="dialog-backdrop tag-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmFolder(false);
          }}>
            <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="folder-title">
              <h2 id="folder-title">Create this folder?</h2>
              <p>
                Create <strong>“{folderName.trim()}”</strong> inside your Google Drive folder{" "}
                <strong>{controller.settings.folderId || "(not set)"}</strong>? This adds one folder only —
                your notes stay untouched until you sync.
              </p>
              <div className="dialog-actions">
                <button className="secondary-button" onClick={() => setConfirmFolder(false)}>Cancel</button>
                <button
                  className="primary-button"
                  onClick={() => {
                    setConfirmFolder(false);
                    setShowFolderForm(false);
                    void controller.createNotesFolder(folderName);
                  }}
                >
                  Create folder
                </button>
              </div>
            </section>
          </div>
        )}

        {tab === "settings" && (
          <div className="settings-panel">
            <div className="step">
              <span className="step-num" aria-hidden="true">1</span>
              <div className="step-body">
                <label className="form-field"><span>Google Client ID</span><input value={settingsDraft.clientId} onChange={(event) => setSettingsDraft({ ...settingsDraft, clientId: event.target.value })} placeholder="xxxx.apps.googleusercontent.com" autoComplete="off" /></label>
                <details className="help-details">
                  <summary>Where do I get this?</summary>
                  <span>Google Cloud Console → enable the Drive API → APIs &amp; Services → Credentials → Create Credentials → OAuth client ID (Web application). Add this app's address (e.g. http://localhost:5173) under Authorized JavaScript origins.</span>
                </details>
              </div>
            </div>

            <div className="step">
              <span className="step-num" aria-hidden="true">2</span>
              <div className="step-body">
                <div className="backup-actions sign-row">
                  <button className="primary-button" onClick={() => void signInWithGoogle()} disabled={controller.busy || authBusy}>
                    {authBusy ? "Signing in…" : controller.isConnected ? "Re-sign in with Google" : "Sign in with Google"}
                  </button>
                  {controller.isConnected && <button className="text-button disconnect-button" onClick={() => void signOut()}>Sign out</button>}
                </div>
                {authError && <p className="backup-error" role="alert">{authError}</p>}
                <details className="help-details">
                  <summary>No popup? Paste a token manually</summary>
                  <div className="token-input-row">
                    <input
                      type={showToken ? "text" : "password"}
                      value={tokenDraft}
                      onChange={(event) => setTokenDraft(event.target.value)}
                      placeholder={controller.isConnected ? "Token saved for this session" : "Paste your OAuth token here"}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button className="text-button" onClick={() => setShowToken((value) => !value)} type="button">{showToken ? "Hide" : "Show"}</button>
                  </div>
                </details>
              </div>
            </div>

            <div className="step">
              <span className="step-num" aria-hidden="true">3</span>
              <div className="step-body">
                <label className="form-field"><span>Drive Folder ID</span><input value={settingsDraft.folderId} onChange={(event) => setSettingsDraft({ ...settingsDraft, folderId: event.target.value })} placeholder="1AbC... (folder ID from URL)" autoComplete="off" /></label>
                <details className="help-details">
                  <summary>How do I find it?</summary>
                  <span>Open the folder in drive.google.com — the ID is the part after /folders/ in the address bar.</span>
                </details>
              </div>
            </div>

            <div className="step">
              <span className="step-num" aria-hidden="true">4</span>
              <div className="step-body">
                <div className="panel-actions save-row">
                  <button className="primary-button" onClick={() => { saveSettings(); if (tokenDraft.trim()) controller.saveToken(tokenDraft); setTokenDraft(""); }}>
                    Save settings
                  </button>
                  <button className="secondary-button" disabled={controller.busy || !controller.isConnected || settingsDraft.folderId.trim() !== controller.settings.folderId} onClick={() => void controller.testConnection()}>
                    {controller.busy ? "Checking…" : "Test connection"}
                  </button>
                  {controller.isConnected && <button className="text-button disconnect-button" onClick={() => { controller.saveToken(""); setTokenDraft(""); }}>Remove token</button>}
                </div>
              </div>
            </div>

            <div className="settings-note"><strong>Token safety</strong><span>Your token lives in this browser tab session only — never in backups. Anyone using this browser profile can use it while the tab lasts. Revoke it in your Google Account when done.</span></div>
          </div>
        )}

        {tab === "backup" && (
          <div className="backup-panel">
            <h3>Keep a copy of your notes.</h3>
            <p>Export a portable JSON backup or one combined Markdown document. Backups include note text and dates, never your Google Drive token.</p>
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
            <div className="settings-note"><strong>Manual backups</strong><span>Export a JSON backup from the Backup tab before big syncs if you want a safety copy.</span></div>
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
          <label><input type="radio" name={`conflict-${item.id}`} checked={item.conflictChoice === "remote"} onChange={() => onChoice(item.id, "remote")} /> Keep Drive</label>
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