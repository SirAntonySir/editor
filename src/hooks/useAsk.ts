/**
 * useAsk — palette Ask-mode hook.
 *
 * Unlike `useSmartMatch` (debounced + auto-fires while typing), Ask mode is
 * SUBMIT-driven: the user types a question, presses Enter, and one POST to
 * `ask_about_image` returns a markdown answer. Subsequent submits abort the
 * in-flight one so a newer question never paints over an older response.
 *
 * The Anthropic call lives on the Sonnet tier — better grounded narrative
 * than Haiku for free-form Q&A, much cheaper than Opus. Each turn:
 *   - Slim image_context (the same cache-friendly block smart_match uses).
 *   - Server-side editor-state summary (active widgets + active mask).
 *   - Any chips the user dropped onto Cmd+K (`attachedChips`).
 *
 * Returns a stable shape the palette renders in three states:
 *   - `{ status: 'idle' }` — no question asked yet.
 *   - `{ status: 'pending', query }` — call in flight.
 *   - `{ status: 'ready', query, markdown }` — response landed.
 *   - `{ status: 'error', query, message }` — soft-fail path.
 *
 * Backend permission gates require_image + requires_context — submit short-
 * circuits when sessionId is null, SSE is closed, or analyze hasn't run.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  backendTools,
  type AskAboutImageChip,
} from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';

export type AskState =
  | { status: 'idle' }
  | { status: 'pending'; query: string }
  | { status: 'ready'; query: string; markdown: string }
  | { status: 'error'; query: string; message: string };

const IDLE: AskState = { status: 'idle' };

export interface AskHook {
  state: AskState;
  /** Fire an ask. Aborts any in-flight call. Returns immediately — watch
   *  `state` for the response. No-op when the gates aren't satisfied. */
  submit: (query: string, attachedChips?: AskAboutImageChip[]) => void;
  /** Drop the current response so the markdown view goes back to the
   *  empty state. Does NOT cancel an in-flight request. */
  reset: () => void;
}

export function useAsk(): AskHook {
  const sessionId = useBackendState((s) => s.sessionId);
  const sseOpen = useBackendState((s) => s.sseStatus === 'open');
  // ask_about_image is permission-gated on image_context, same as smart_match.
  // The store mirrors this from the SSE `mcpAnalyzeComplete` flag.
  const analyzeComplete = useBackendState((s) => s.mcpAnalyzeComplete);

  const [state, setState] = useState<AskState>(IDLE);
  const abort = useRef<AbortController | null>(null);

  // Cancel on unmount so a closed palette doesn't leave a request hanging.
  useEffect(
    () => () => {
      if (abort.current) abort.current.abort();
    },
    [],
  );

  const submit = useCallback(
    (query: string, attachedChips?: AskAboutImageChip[]) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      if (!sessionId || !sseOpen || !analyzeComplete) {
        setState({
          status: 'error',
          query: trimmed,
          message: !sseOpen
            ? 'Disconnected from the backend.'
            : !analyzeComplete
              ? 'Analyze the image first.'
              : 'No active session.',
        });
        return;
      }
      // Cancel any prior in-flight ask. The .then below short-circuits on
      // `signal.aborted` so the stale response can't overwrite the new one.
      if (abort.current) abort.current.abort();
      const controller = new AbortController();
      abort.current = controller;

      setState({ status: 'pending', query: trimmed });
      void backendTools
        .ask_about_image(
          sessionId,
          { query: trimmed, attachedChips: attachedChips ?? [] },
          controller.signal,
        )
        .then((env) => {
          if (controller.signal.aborted) return;
          if (env.ok && env.output) {
            setState({
              status: 'ready',
              query: trimmed,
              markdown: env.output.markdown,
            });
          } else {
            setState({
              status: 'error',
              query: trimmed,
              message: env.error?.message ?? 'Ask failed.',
            });
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            status: 'error',
            query: trimmed,
            message: err instanceof Error ? err.message : 'Ask failed.',
          });
        });
    },
    [sessionId, sseOpen, analyzeComplete],
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { state, submit, reset };
}
