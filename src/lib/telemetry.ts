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
import { BACKEND_BASE_URL as BASE_URL } from '@/lib/backend-url';

export function track(name: string, props: Record<string, unknown> = {}): void {
  // Read sessionId at call time — telemetry may fire before SSE opens
  // or after a session ends; both cases drop silently.
  const sessionId = useBackendState.getState().sessionId;
  if (!sessionId) return;
  // fetch + keepalive survives page unload (the main loss window for UI
  // telemetry) just like sendBeacon would — but unlike sendBeacon it lets us
  // omit credentials. sendBeacon always sends credentials-include, which a
  // cross-origin (tunneled) backend with allow_credentials=false rejects at
  // the CORS preflight. Telemetry events are tiny, well under keepalive's 64KB.
  void fetch(`${BASE_URL}/api/telemetry/${sessionId}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, props }),
    keepalive: true,
    credentials: 'omit',
  }).catch(() => {
    // Silently drop — telemetry must not crash the editor.
  });
}
