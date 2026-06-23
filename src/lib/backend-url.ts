/**
 * Single source of truth for the backend base URL.
 *
 * Resolution order (first non-empty wins):
 *   1. User override — set in Preferences, persisted to localStorage. Lets the
 *      user point the running app at any tunnel without an env var or rebuild.
 *   2. `window.electron.backendUrl` — injected by the Electron main process at
 *      launch (from `BACKEND_URL` env var or a `backend-url.txt` override file).
 *   3. `import.meta.env.VITE_AI_BACKEND_URL` — baked at Vite build time (web/dev).
 *   4. `http://127.0.0.1:8787` — local default.
 *
 * `BACKEND_BASE_URL` is resolved once at module load. Changing the override
 * therefore requires a reload (the Preferences UI triggers one) — that's also
 * the only correct way to re-establish the session + SSE stream against the new
 * host.
 */
const LS_KEY = 'editor-backend-url';

function readOverride(): string {
  try {
    return (localStorage.getItem(LS_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

/** The user's saved backend URL override, or '' if none is set. */
export function getBackendUrlOverride(): string {
  return readOverride();
}

/** Persist (empty string clears) the user's backend URL override. The caller is
 *  responsible for reloading the app so the new value takes effect. */
export function setBackendUrlOverride(url: string): void {
  const value = url.trim();
  try {
    if (value) localStorage.setItem(LS_KEY, value);
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* storage unavailable — nothing we can do */
  }
}

export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8787';

const ELECTRON_URL =
  (typeof window !== 'undefined' && window.electron?.backendUrl) || '';
const ENV_URL = import.meta.env.VITE_AI_BACKEND_URL || '';

export const BACKEND_BASE_URL: string =
  readOverride() || ELECTRON_URL || ENV_URL || DEFAULT_BACKEND_URL;
