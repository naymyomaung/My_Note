# My Note

A lightweight Markdown notes app. Notes are saved in the browser and remain editable without a network connection. Google Drive synchronization is optional and always starts with a reviewable preview.

## Run locally

```sh
npm install
npm run dev
```

Create a production build with `npm run build`; serve `dist/` over HTTPS (or localhost) to enable the offline service worker. The first online visit caches the app shell and its assets for later use. Note data is stored separately in browser LocalStorage.

## Architecture

- `src/types/` defines notes, drive settings, and sync state.
- `src/services/noteStorage.ts` handles local notes, sync baselines, settings, and theme persistence.
- `src/services/googleDriveSync.ts` implements Google Drive API reads, writes, deletes, and preview decisions.
- `src/services/backup.ts` validates and exports JSON backups.
- `src/hooks/` contains the local notes and Google Drive sync state flows.
- `src/components/` contains the note list, Markdown editor, and sync/settings/backup dialog.
- `public/sw.js` caches the production app shell; Google Drive API requests are never cached.

## Google Drive setup

1. In [Google Cloud Console](https://console.cloud.google.com/), enable the **Google Drive API**, then go to **APIs & Services → Credentials → Create Credentials → OAuth client ID** (type **Web application**). Under **Authorized JavaScript origins** add this app's origin (e.g. `http://localhost:5173` for local dev).
2. Copy the Client ID into the app under **Sync → Settings → Google Client ID** and save.
3. Click **Sign in with Google** and approve full Drive access (needed so the app can use a folder you created yourself). Your token is kept in this browser tab session only.
4. Create a folder in Google Drive for your notes, open it, and copy the folder ID from the URL (`.../drive/folders/FOLDER_ID`) into **Drive Folder ID**.

The token is held in `sessionStorage` for the current browser session, not in note backups or LocalStorage. This is a browser-only integration, not an OAuth client or a secure credential vault: anyone with access to the same browser profile during that session can use the token. Revoke it from your Google Account when it is no longer needed.

Each synced note is stored as a Markdown file (`<note-id>.md`) with a small My Note metadata comment at the top. The app lists Markdown files in the configured folder and skips foreign `.md` files without its metadata. Use a folder dedicated to this app.

Use **Test connection** in Settings to verify that the token can access the folder. Select **Check for changes** to review uploads, downloads, remote deletions, and conflicts. Conflicts are skipped until you select **Keep local** or **Keep Drive**. Drive deletions are not applied until they appear in the preview and you apply it. If a selected Drive copy changed after preview, the app stops and asks you to refresh the preview. Export a manual JSON backup from the Backup tab if you want a safety copy first.

## Backups and appearance

The Backup tab exports a portable JSON backup or a combined Markdown document. Importing a JSON backup can replace or merge notes; replacing first downloads a backup of current local notes. Dark mode and drive settings are saved locally.
