import { BACKEND_BASE_URL, getBackendToken } from '@/lib/backend-url';

/** URL for a genfill result asset. Appends the shared-secret token as a query
 *  param when configured (same convention as the header-less SSE stream —
 *  <img>/fetch GETs can't carry the Authorization header everywhere). */
export function genfillAssetUrl(sessionId: string, assetId: string): string {
  const base = `${BACKEND_BASE_URL}/api/session/${sessionId}/assets/${assetId}`;
  const token = getBackendToken();
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
