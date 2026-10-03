import type {
  GitHubRepositorySettings,
  Note,
  NoteSyncState,
  SyncPreviewItem,
} from "../types/note";

const API_ROOT = "https://api.github.com";

export interface RemoteNote {
  note: Note;
  sha: string;
  path: string;
}

interface GitHubBranch {
  commit?: {
    sha?: string;
    commit?: {
      tree?: {
        sha?: string;
      };
    };
  };
}

interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  type: string;
  content?: string;
  encoding?: string;
}

export function notePath(settings: GitHubRepositorySettings, id: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    throw new Error("A note has an invalid identifier and cannot be synced safely.");
  }
  const directory = settings.directory
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  return `${directory ? `${directory}/` : ""}${id}.md`;
}

export async function fetchRemoteNotes(
  token: string,
  settings: GitHubRepositorySettings,
): Promise<RemoteNote[]> {
  validateSettings(settings);
  const repositoryResponse = await githubRequest(
    token,
    repositoryApiUrl(settings, ""),
    { method: "GET" },
    {
      notFoundMessage: "GitHub could not find this repository or the token cannot access it. Check the owner, repository name, and token permissions.",
    },
  );
  if (!repositoryResponse) throw new Error("GitHub did not confirm repository access.");

  const branchResponse = await githubRequest(
    token,
    repositoryApiUrl(settings, `branches/${encodeURIComponent(settings.branch)}`),
    { method: "GET" },
    {
      notFoundMessage: `GitHub could not find branch “${settings.branch}”. Check the branch name in Settings.`,
    },
  );
  if (!branchResponse) throw new Error(`GitHub did not confirm branch “${settings.branch}”.`);

  const listing = await listContentsAtPath(token, settings, settings.directory);

  const markdownFiles = listing.filter(
    (item): item is GitHubContent =>
      isGitHubContent(item) && item.type === "file" && item.name.endsWith(".md"),
  );

  return Promise.all(
    markdownFiles.map(async (file) => {
      const response = await githubRequest(
        token,
        contentsApiUrl(settings, file.path),
        { method: "GET" },
      );
      if (!response) throw new Error(`GitHub did not return the file ${file.path}.`);
      const content = (await response.json()) as GitHubContent;
      if (typeof content.content !== "string" || content.encoding !== "base64") {
        throw new Error(`GitHub did not return readable Markdown for ${file.path}.`);
      }
      return {
        ...decodeNote(content.content),
        sha: content.sha,
        path: content.path,
      };
    }),
  );
}

async function listContentsAtPath(
  token: string,
  settings: GitHubRepositorySettings,
  path: string,
): Promise<GitHubContent[]> {
  const response = await githubRequest(
    token,
    contentsApiUrl(settings, path),
    { method: "GET" },
    {
      notFoundMessage: path
        ? `The folder “${path}” does not exist on branch “${settings.branch}”. Create it in GitHub first, or clear the Notes folder setting to sync Markdown files at the repository root.`
        : `GitHub could not read the repository root on branch “${settings.branch}”. Check the branch name and Contents read permission.`,
    },
  );
  if (!response) throw new Error(`GitHub did not return a listing for “${path || "the repository root"}”.`);
  const listing: unknown = await response.json();
  if (!Array.isArray(listing) || !listing.every(isGitHubContent)) {
    throw new Error(`GitHub returned an unexpected folder listing for “${path || "the repository root"}”.`);
  }
  return listing;
}

export function buildSyncPreview(
  localNotes: Note[],
  remoteNotes: RemoteNote[],
  state: NoteSyncState,
  settings: GitHubRepositorySettings,
): SyncPreviewItem[] {
  const localById = new Map(localNotes.map((note) => [note.id, note]));
  const remoteById = new Map(remoteNotes.map((remote) => [remote.note.id, remote]));
  const ids = new Set([
    ...localById.keys(),
    ...remoteById.keys(),
    ...Object.keys(state.synced),
    ...Object.keys(state.deleted),
  ]);
  const preview: SyncPreviewItem[] = [];

  for (const id of ids) {
    const local = localById.get(id);
    const remote = remoteById.get(id);
    const baseline = state.synced[id];
    const tombstone = state.deleted[id];
    const path = remote?.path ?? baseline?.path ?? tombstone?.path ?? notePath(settings, id);

    if (tombstone) {
      if (!remote) {
        preview.push(item(id, tombstone.baseline.title, "current", undefined, undefined, undefined, path, "The deleted note is already absent from GitHub.", true));
      } else if (remote.sha === tombstone.sha) {
        preview.push(item(id, tombstone.baseline.title, "delete", undefined, remote.note, remote.sha, path, "Delete this note from GitHub."));
      } else {
        preview.push(item(id, remote.note.title, "conflict", undefined, remote.note, remote.sha, path, "The GitHub note changed after it was deleted locally."));
      }
      continue;
    }

    if (local && remote) {
      if (!baseline) {
        const action = sameNote(local, remote.note) ? "current" : "conflict";
        preview.push(item(id, local.title, action, local, remote.note, remote.sha, path,
          action === "current" ? "The local and GitHub notes already match." : "The same note exists locally and on GitHub without a shared sync baseline.",
          action === "current"));
        continue;
      }
      const localChanged = !sameNote(local, baseline.note);
      const remoteChanged = !sameNote(remote.note, baseline.note);
      if (localChanged && remoteChanged && !sameNote(local, remote.note)) {
        preview.push(item(id, local.title, "conflict", local, remote.note, remote.sha, path, "Both copies changed since the last sync."));
      } else if (localChanged && !remoteChanged) {
        preview.push(item(id, local.title, "upload", local, remote.note, remote.sha, path, "Upload local changes to GitHub."));
      } else if (remoteChanged && !localChanged) {
        preview.push(item(id, remote.note.title, "download", local, remote.note, remote.sha, path, "Download GitHub changes to this device."));
      } else {
        preview.push(item(id, local.title, "current", local, remote.note, remote.sha, path, "Both copies are up to date.", remote.sha !== baseline.sha));
      }
      continue;
    }

    if (local) {
      preview.push(item(id, local.title, "upload", local, undefined, undefined, path,
        baseline ? "The GitHub copy is missing; upload the local note again." : "Upload this local note to GitHub."));
    } else if (remote) {
      preview.push(item(id, remote.note.title, "download", undefined, remote.note, remote.sha, path, "Download this GitHub note to this device."));
    } else {
      preview.push(item(id, baseline?.note.title ?? "Untitled", "current", undefined, undefined, undefined, path, "No changes to sync."));
    }
  }

  return preview.sort((a, b) => a.title.localeCompare(b.title));
}

export async function putRemoteNote(
  token: string,
  settings: GitHubRepositorySettings,
  note: Note,
  path: string,
  sha?: string,
): Promise<string> {
  const body = {
    message: `Sync note: ${note.title || "Untitled"}`,
    content: encodeBase64(encodeNote(note)),
    branch: settings.branch,
    ...(sha ? { sha } : {}),
  };
  const response = await githubRequest(
    token,
    repositoryUrl(settings, path),
    { method: "PUT", body: JSON.stringify(body) },
    {
      notFoundMessage: `GitHub could not create “${path}”. Verify the repository and branch still exist and the token has Contents: Read and write access. If “${settings.directory || "the target parent"}” is a configured folder, create that folder in the GitHub repository first, then retry.`,
    },
  );
  if (!response) throw new Error("GitHub did not return a save response.");
  const result = (await response.json()) as { content?: { sha?: string } };
  if (!result.content?.sha) throw new Error("GitHub saved the note but returned no file identifier.");
  return result.content.sha;
}

export async function deleteRemoteNote(
  token: string,
  settings: GitHubRepositorySettings,
  path: string,
  sha: string,
  title: string,
): Promise<void> {
  const response = await githubRequest(token, repositoryUrl(settings, path), {
    method: "DELETE",
    body: JSON.stringify({
      message: `Delete note: ${title || "Untitled"}`,
      sha,
      branch: settings.branch,
    }),
  });
  if (!response) throw new Error("GitHub did not return a deletion response.");
}

export async function createNotesFolder(
  token: string,
  settings: GitHubRepositorySettings,
): Promise<void> {
  validateSettings(settings);
  const directory = settings.directory.split("/").map((part) => part.trim()).filter(Boolean).join("/");
  if (!directory) throw new Error("Enter a Notes folder in Settings before creating it.");

  const repository = await githubRequest(token, repositoryApiUrl(settings, ""), { method: "GET" }, {
    notFoundMessage: "GitHub could not find this repository or the token cannot access it. Check the owner, repository name, and token permissions.",
  });
  if (!repository) throw new Error("GitHub did not confirm repository access.");

  const branchResponse = await githubRequest(
    token,
    repositoryApiUrl(settings, `branches/${encodeURIComponent(settings.branch)}`),
    { method: "GET" },
    { notFoundMessage: `GitHub could not find branch “${settings.branch}”. Check the branch name in Settings.` },
  );
  if (!branchResponse) throw new Error(`GitHub did not confirm branch “${settings.branch}”.`);
  const branch = (await branchResponse.json()) as GitHubBranch;
  const parentCommit = branch.commit?.sha;
  const baseTree = branch.commit?.commit?.tree?.sha;
  if (!parentCommit || !baseTree) throw new Error("GitHub returned incomplete branch information.");

  const existingFolder = await githubRequest(
    token,
    contentsApiUrl(settings, directory),
    { method: "GET" },
    { allowNotFound: true },
  );
  if (existingFolder) {
    const existingContents: unknown = await existingFolder.json();
    if (Array.isArray(existingContents)) {
      throw new Error(`“${directory}” already exists on branch “${settings.branch}”. Use Check for changes instead.`);
    }
    throw new Error(`“${directory}” already exists, but is not a folder. Choose a different Notes folder in Settings.`);
  }

  const treeResponse = await githubRequest(token, repositoryApiUrl(settings, "git/trees"), {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTree,
      tree: [{
        path: `${directory}/.gitkeep`,
        mode: "100644",
        type: "blob",
        content: "My Note sync folder.\n",
      }],
    }),
  });
  if (!treeResponse) throw new Error("GitHub did not return the new tree.");
  const tree = (await treeResponse.json()) as { sha?: string };
  if (!tree.sha) throw new Error("GitHub did not return the new tree identifier.");

  const commitResponse = await githubRequest(token, repositoryApiUrl(settings, "git/commits"), {
    method: "POST",
    body: JSON.stringify({
      message: `Create My Note folder: ${directory}`,
      tree: tree.sha,
      parents: [parentCommit],
    }),
  });
  if (!commitResponse) throw new Error("GitHub did not return the folder commit.");
  const commit = (await commitResponse.json()) as { sha?: string };
  if (!commit.sha) throw new Error("GitHub did not return the folder commit identifier.");

  const ref = `heads/${settings.branch.split("/").map(encodeURIComponent).join("/")}`;
  const refResponse = await githubRequest(
    token,
    repositoryApiUrl(settings, `git/refs/${ref}`),
    { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) },
  );
  if (!refResponse) throw new Error("GitHub did not confirm the branch update.");
}

function item(
  id: string,
  title: string,
  action: SyncPreviewItem["action"],
  localNote: Note | undefined,
  remoteNote: Note | undefined,
  remoteSha: string | undefined,
  path: string,
  reason: string,
  needsBaseline = false,
): SyncPreviewItem {
  return {
    id,
    title: title || "Untitled",
    action,
    localNote,
    remoteNote,
    remoteSha,
    path,
    conflictChoice: "skip",
    reason,
    needsBaseline,
  };
}

function sameNote(a: Note, b: Note): boolean {
  return a.title === b.title && a.content === b.content;
}

function encodeNote(note: Note): string {
  const metadata = JSON.stringify({
    id: note.id,
    title: note.title,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  });
  return `<!-- my-note\n${metadata}\n-->\n${note.content}`;
}

function decodeNote(encoded: string): Pick<RemoteNote, "note"> {
  const markdown = decodeBase64(encoded);
  const match = /^<!-- my-note\n([^\r\n]+)\n-->\r?\n?([\s\S]*)$/.exec(markdown);
  if (!match) throw new Error("A GitHub Markdown file is missing My Note metadata.");
  let metadata: unknown;
  try {
    metadata = JSON.parse(match[1]);
  } catch {
    throw new Error("A GitHub Markdown file has invalid My Note metadata.");
  }
  if (!isNoteMetadata(metadata)) throw new Error("A GitHub Markdown file has incomplete My Note metadata.");
  return {
    note: {
      id: metadata.id,
      title: metadata.title,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      content: match[2],
    },
  };
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function repositoryUrl(settings: GitHubRepositorySettings, path: string): string {
  const encodedPath = path.split("?")[0].split("/").map(encodeURIComponent).join("/");
  const query = path.includes("?") ? `?${path.split("?")[1]}` : "";
  return `${API_ROOT}/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repository)}/contents/${encodedPath}${query}`;
}

function repositoryApiUrl(settings: GitHubRepositorySettings, suffix: string): string {
  const base = `${API_ROOT}/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repository)}`;
  return suffix ? `${base}/${suffix}` : base;
}

function contentsApiUrl(settings: GitHubRepositorySettings, path: string): string {
  const contentsPath = path
    ? `/contents/${path.split("/").map(encodeURIComponent).join("/")}`
    : "/contents";
  return `${repositoryApiUrl(settings, "")}${contentsPath}?ref=${encodeURIComponent(settings.branch)}`;
}

interface GitHubRequestOptions {
  notFoundMessage?: string;
  allowNotFound?: boolean;
}

async function githubRequest(
  token: string,
  url: string,
  init: RequestInit,
  options: GitHubRequestOptions = {},
): Promise<Response | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new Error("Could not reach the GitHub API. Check your internet connection, VPN or firewall, then retry. Your local notes are safe.");
  }
  if (response.status === 404 && options.allowNotFound) return null;
  if (!response.ok) {
    let detail = "";
    try {
      const result = (await response.json()) as { message?: string };
      detail = result.message ?? "";
    } catch {
      detail = response.statusText;
    }
    if (response.status === 404 && options.notFoundMessage) {
      throw new Error(options.notFoundMessage);
    }
    if (response.status === 404) {
      throw new Error(`GitHub could not find this repository, branch, folder, or file${detail ? `: ${detail}` : ""}. Check the repository settings and try again.`);
    }
    if (response.status === 401) {
      throw new Error("GitHub rejected the token. Check that it is valid and has not expired, then save it again.");
    }
    if (response.status === 403) {
      throw new Error(`GitHub denied access (${response.status})${detail ? `: ${detail}` : ""}. Check Contents read and write permission and your API rate limit.`);
    }
    throw new Error(`GitHub request failed (${response.status})${detail ? `: ${detail}` : ""}.`);
  }
  return response;
}

function validateSettings(settings: GitHubRepositorySettings): void {
  if (!settings.owner.trim() || !settings.repository.trim()) {
    throw new Error("Enter a GitHub owner and repository before syncing.");
  }
  if (!settings.branch.trim()) throw new Error("Enter a GitHub branch before syncing.");
  if (settings.directory.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("The notes folder cannot contain . or .. path segments.");
  }
}

function isGitHubContent(value: unknown): value is GitHubContent {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Record<string, unknown>;
  return typeof file.name === "string" && typeof file.path === "string" && typeof file.sha === "string" && typeof file.type === "string";
}

function isNoteMetadata(value: unknown): value is Pick<Note, "id" | "title" | "createdAt" | "updatedAt"> {
  if (typeof value !== "object" || value === null) return false;
  const metadata = value as Record<string, unknown>;
  return typeof metadata.id === "string" && typeof metadata.title === "string" &&
    typeof metadata.createdAt === "string" && typeof metadata.updatedAt === "string";
}
