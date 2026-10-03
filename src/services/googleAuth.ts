const GIS_SRC = "https://accounts.google.com/gsi/client";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

interface TokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}

interface GsiOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: { access_token?: string; error?: string }) => void;
  }) => TokenClient;
  revoke: (token: string, done?: () => void) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GsiOAuth2 } };
  }
}

let gisPromise: Promise<GsiOAuth2> | null = null;

export function loadGis(): Promise<GsiOAuth2> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => {
        const oauth2 = window.google?.accounts?.oauth2;
        if (oauth2) resolve(oauth2);
        else reject(new Error("Google sign-in library loaded but did not initialize."));
      });
      existing.addEventListener("error", () => reject(new Error("Could not load Google sign-in library. Check your connection.")));
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new Error("Google sign-in library loaded but did not initialize."));
    };
    script.onerror = () => reject(new Error("Could not load Google sign-in library. Check your connection."));
    document.head.appendChild(script);
  });
  return gisPromise;
}

export async function requestDriveAccessToken(clientId: string): Promise<string> {
  const id = clientId.trim();
  if (!id) throw new Error("Enter your Google OAuth Client ID first.");
  const oauth2 = await loadGis();
  return new Promise((resolve, reject) => {
    let settled = false;
    const client = oauth2.initTokenClient({
      client_id: id,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (settled) return;
        settled = true;
        if (response.access_token) resolve(response.access_token);
        else reject(new Error(response.error ?? "Google sign-in did not return a token."));
      },
    });
    try {
      client.requestAccessToken({ prompt: "" });
    } catch (cause) {
      if (!settled) {
        settled = true;
        reject(cause instanceof Error ? cause : new Error("Google sign-in failed."));
      }
    }
    // If the popup is closed without completing, GIS may never call back.
    // Time out so the UI does not hang forever.
    window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Google sign-in timed out or was cancelled. Try again."));
      }
    }, 120_000);
  });
}

export async function revokeDriveAccessToken(token: string): Promise<void> {
  if (!token) return;
  try {
    const oauth2 = await loadGis();
    await new Promise<void>((resolve) => oauth2.revoke(token, () => resolve()));
  } catch {
    // Revocation is best-effort; token is still cleared locally.
  }
}
