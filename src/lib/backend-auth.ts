/**
 * Shared-secret backend auth (opt-in).
 *
 * When a token is configured (Preferences → Backend token, or VITE_BACKEND_TOKEN
 * at build time), every request aimed at the backend carries it. Regular
 * requests use an `Authorization: Bearer` header; the SSE stream can't set
 * headers, so the subscriber appends the token as a `?token=` query param
 * separately (see sse-subscriber.ts). The backend accepts either and only
 * enforces auth when its own BACKEND_AUTH_TOKEN env var is set — so local /
 * Tailscale runs with no token keep working unchanged.
 *
 * Implementation: a single, idempotent wrapper around window.fetch installed at
 * app start. Requests are matched by BACKEND_BASE_URL prefix, so unrelated
 * fetches (ONNX/WASM, model downloads) are left untouched.
 */
import { BACKEND_BASE_URL, getBackendToken } from './backend-url';

let installed = false;

export function installBackendAuth(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const token = getBackendToken();
  if (!token) return;

  const original: typeof window.fetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url && url.startsWith(BACKEND_BASE_URL)) {
      const headers = new Headers(init?.headers);
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      init = { ...init, headers };
    }
    return original(input, init);
  }) as typeof window.fetch;
}
