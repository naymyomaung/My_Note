# My Note

A lightweight Markdown notes app. Notes are saved in the browser and remain editable without a network connection. GitHub synchronization is optional and always starts with a reviewable preview.

## Run locally

```sh
npm install
npm run dev
```

Create a production build with `npm run build`; serve `dist/` over HTTPS (or localhost) to enable the offline service worker. The first online visit caches the app shell and its assets for later use. Note data is stored separately in browser LocalStorage.

## Architecture

- `src/types/` defines notes, repository settings, and sync state.
- `src/services/noteStorage.ts` handles local notes, sync baselines, settings, and theme persistence.
- `src/services/githubSync.ts` implements GitHub Contents API reads, writes, deletes, and preview decisions.
- `src/services/backup.ts` validates and exports JSON backups.
- `src/hooks/` contains the local notes and GitHub sync state flows.
- `src/components/` contains the note list, Markdown editor, and sync/settings/backup dialog.
- `public/sw.js` caches the production app shell; GitHub API requests are never cached.

## GitHub setup

Create a fine-grained personal access token for the one repository you intend to use. Grant **Contents: Read and write** for that repository. In the app, open **Sync → Settings**, enter the repository owner, repository name, branch, and a folder dedicated to My Note (default: `notes`), then save the token. If the folder does not exist, use **Create notes folder** to create it on the selected branch; this creates a `.gitkeep` placeholder commit and does not modify local notes. Alternatively, clear Notes folder to store Markdown files at the repository root.

The token is held in `sessionStorage` for the current browser session, not in note backups or LocalStorage. This is a browser-only integration, not an OAuth client or a secure credential vault: anyone with access to the same browser profile during that session can use the token. Revoke it from GitHub when it is no longer needed. Do not use a token with access to repositories you do not want this browser app to modify.

Each synced note is stored as a Markdown file with a small My Note metadata comment at the top. The app lists Markdown files in the configured folder and expects those files to contain its metadata. Use a folder dedicated to this app.

Select **Check for changes** to review uploads, downloads, remote deletions, and conflicts. Conflicts are skipped until you select **Keep local** or **Keep GitHub**. GitHub deletions are not applied until they appear in the preview and you apply it. A JSON backup is downloaded before applying changes. If a selected GitHub copy changed after preview, the app stops and asks you to refresh the preview.

## Backups and appearance

The Backup tab exports a portable JSON backup or a combined Markdown document. Importing a JSON backup can replace or merge notes; replacing first downloads a backup of current local notes. Dark mode and repository settings are saved locally.
