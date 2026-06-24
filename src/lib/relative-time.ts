/** Compact relative-time label (`5s`, `12m`, `3h`) for history timestamps.
 *  `ts` is a Unix timestamp in SECONDS (backend convention); `now` is in
 *  milliseconds (Date.now()). */
export function relativeTime(ts: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - ts * 1000) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h`;
}
