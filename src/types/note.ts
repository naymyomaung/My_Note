export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  updatedAt: string;
}

export interface SyncedAttachment {
  sha: string;
  name: string;
  noteId: string;
  path: string;
}

export interface GoogleDriveSettings {
  clientId: string;
  folderId: string;
}

export interface SyncedNote {
  note: Note;
  sha: string;
  path: string;
}

export interface DeletedNote {
  sha: string;
  path: string;
  baseline: Note;
  keepRemote?: boolean;
}

export interface NoteSyncState {
  synced: Record<string, SyncedNote>;
  deleted: Record<string, DeletedNote>;
  attachments: Record<string, SyncedAttachment>;
  repositoryKey?: string;
}

export type SyncAction = "upload" | "download" | "delete" | "conflict" | "current";

export interface SyncPreviewItem {
  id: string;
  title: string;
  action: SyncAction;
  localNote?: Note;
  remoteNote?: Note;
  remoteSha?: string;
  path: string;
  conflictChoice: "local" | "remote" | "skip";
  reason: string;
  needsBaseline?: boolean;
  excluded?: boolean;
}
