export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubRepositorySettings {
  owner: string;
  repository: string;
  branch: string;
  directory: string;
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
}

export interface NoteSyncState {
  synced: Record<string, SyncedNote>;
  deleted: Record<string, DeletedNote>;
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
}
