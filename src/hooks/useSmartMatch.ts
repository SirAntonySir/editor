/**
 * useSmartMatch — palette typing-time AI matcher.
 *
 * Watches a typed `query` and conditionally fires the backend
 * `smart_match_command` tool to surface 0..3 op/preset suggestions ranked
 * by fit to BOTH the query and the current image. Built to be **cheap**
 * during fast typing:
 *
 *   - Debounced by `RUNTIME.smartMatchDebounceMs` (250 ms) so a fast typist
 *     never triggers more than ~4 calls/second.
 *   - Skipped when the query is shorter than `RUNTIME.smartMatchMinChars`
 *     (4) — below that the deterministic synonym match almost always has
 *     a clean answer.
 *   - Skipped when `enabled` is false. The palette passes `enabled` only
 *     when its primary deterministic section is *sparse* (fewer than 3
 *     hits) — so for unambiguous queries no LLM call ever fires.
 *   - Each fire creates an AbortController; the *next* fire aborts the
 *     in-flight one so we never paint stale suggestions when a newer
 *     query has superseded the request.
 *   - Soft-fails on rate-limit, network error, abort, or missing
 *     image_context — never throws into the palette render.
 *
 * Returns a stable shape so the palette can render in three states:
 * `{ loading: true }`, `{ picks: [...] }`, or the empty default.
 */
import { useEffect, useRef, useState } from 'react';
import { backendTools, type SmartMatchPick } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { RUNTIME } from '@/config';

export interface SmartMatchState {
  /** Becomes true while an in-flight call is pending — UI can show a
   *  tiny loader on the smart-match section title. */
  loading: boolean;
  /** Ranked op/preset picks. Empty when no call has fired, when the call
   *  was aborted, when the LLM returned nothing, or on soft failure. */
  picks: SmartMatchPick[];
}

const EMPTY: SmartMatchState = { loading: false, picks: [] };

export function useSmartMatch(
  query: string,
  options: { enabled: boolean },
): SmartMatchState {
  const sessionId = useBackendState((s) => s.sessionId);
  const sseOpen = useBackendState((s) => s.sseStatus === 'open');
  // The smart-match call is permission-gated on image_context, so don't
  // even try until analyze has produced one. The store mirrors this from
  // the SSE `mcpAnalyzeComplete` flag set by the widget-mint terminal phase.
  const analyzeComplete = useBackendState((s) => s.mcpAnalyzeComplete);

  const trimmed = query.trim();
  const allow =
    options.enabled &&
    sseOpen &&
    analyzeComplete &&
    sessionId !== null &&
    trimmed.length >= RUNTIME.smartMatchMinChars;

  // Inputs that should invalidate any pending result and clear stale picks.
  // Concatenated rather than a JSON-stringify so the comparison stays cheap.
  const key = `${allow ? '1' : '0'}|${sessionId ?? ''}|${trimmed}`;

  const [state, setState] = useState<SmartMatchState>(EMPTY);
  const [lastKey, setLastKey] = useState(key);
  // Previous-prop reset (React docs canonical pattern — same one the
  // CommandPalette and ImageNode use): clear picks synchronously when the
  // gate state or query changes. This avoids a setState-inside-useEffect
  // (which the project's lint rule flags) for the gate-fail clear path.
  if (lastKey !== key) {
    setLastKey(key);
    if (state.picks.length !== 0 || state.loading) setState(EMPTY);
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    // Always cancel any prior pending timer + in-flight request before
    // evaluating the gate. The cleanup return below handles unmount.
    if (timer.current) clearTimeout(timer.current);
    if (abort.current) abort.current.abort();
    timer.current = null;
    abort.current = null;

    if (!allow) return;

    timer.current = setTimeout(() => {
      const controller = new AbortController();
      abort.current = controller;
      setState({ loading: true, picks: [] });
      void backendTools
        .smart_match_command(sessionId!, { query: trimmed }, controller.signal)
        .then((env) => {
          // If we were aborted between fire and resolve, the next-query
          // effect already replaced `state` — don't paint over it.
          if (controller.signal.aborted) return;
          if (env.ok && env.output) {
            setState({ loading: false, picks: env.output.picks });
          } else {
            // Rate-limit, permission gate, or LLM hiccup. Soft-fail to
            // empty rather than surfacing an error row in the palette.
            setState({ loading: false, picks: [] });
          }
        })
        .catch((err: unknown) => {
          // AbortError is the expected "newer query superseded us" path.
          // Anything else (network, parsing) we also swallow to keep the
          // palette useful even when smart-match is unavailable.
          if (controller.signal.aborted) return;
          console.debug('smart_match_command failed (soft)', err);
          setState({ loading: false, picks: [] });
        });
    }, RUNTIME.smartMatchDebounceMs);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (abort.current) abort.current.abort();
    };
  }, [allow, trimmed, sessionId]);

  return state;
}
