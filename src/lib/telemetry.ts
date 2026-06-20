// Lightweight fire-and-forget UI telemetry for the admin cockpit. We
// post events to the backend's /api/telemetry endpoint and never await
// the response — telemetry must never block the UI. Failures are
// swallowed; this is research instrumentation, not a contract.
//
// Use sparingly. Each call is one HTTP round-trip, so debounce or
// throttle when wiring continuous gestures (panel resize, scroll). For
// discrete actions (tab opens, dropdown opens) one call per action is
// fine.

import { useBackendState } from '@/store/backend-state-slice';

const BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

export function track(name: string, props: Record<string, unknown> = {}): void {
  // Read sessionId at call time — telemetry may fire before SSE opens
  // or after a session ends; both cases drop silently.
  const sessionId = useBackendState.getState().sessionId;
  if (!sessionId) return;
  // navigator.sendBeacon survives page unload, the most likely loss
  // window for UI telemetry. Falls back to fetch in environments where
  // it's unavailable.
  const body = JSON.stringify({ name, props });
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(`${BASE_URL}/api/telemetry/${sessionId}/event`, blob);
      return;
    }
  } catch {
    // sendBeacon throws on some Safari versions when payload is too large.
    // Fall through to fetch.
  }
  void fetch(`${BASE_URL}/api/telemetry/${sessionId}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Silently drop — telemetry must not crash the editor.
  });
}
