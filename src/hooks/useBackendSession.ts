import { useEffect, useRef } from 'react';
import { useAiSession } from '@/hooks/useImageContext';
import { useBackendState, getPersistedSessionId } from '@/store/backend-state-slice';
import { openSseSubscription, type SseHandle } from '@/lib/sse-subscriber';
import { maskStore, type Mask } from '@/core/mask-store';
import { maskPngBase64ToBytes } from '@/lib/sam/sam-client';
import { deletePrefix, getEditorState } from '@/core/pixel-source-store';
import { restorePixelSources } from '@/core/restore-pixel-sources';
import { useEditorStore } from '@/store';
import type { PersistedEditorState } from '@/core/editor-state-persistence';

const BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

/**
 * Probe whether a backend session is still alive. Returns true if the
 * GET /api/state/{sid} endpoint responds with a 2xx status.
 */
async function probeSession(sid: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE_URL}/api/state/${sid}`);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Re-fetch mask bytes for any mask in `masksIndex` that wasn't already
 * populated via SSE (e.g. because the live event was dropped during the
 * SSE handshake window). Hits the new GET /api/state/{sid}/masks/{mid}
 * endpoint which returns the full MaskRecord including png_b64.
 */
async function rehydrateMaskBytes(
  sessionId: string,
  masksIndex: Array<{ id: string; width: number; height: number; source: string; label: string | null }>,
): Promise<void> {
  for (const m of masksIndex) {
    // Already populated by a live SSE event — skip.
    if (maskStore.get(m.id)) continue;
    try {
      const resp = await fetch(`${BASE_URL}/api/state/${sessionId}/masks/${m.id}`);
      if (!resp.ok) continue;
      const body = (await resp.json()) as { png_b64?: string };
      if (!body.png_b64) continue;
      const { data, width, height } = await maskPngBase64ToBytes(body.png_b64);
      const mask: Mask = {
        id: m.id,
        layerId: 'ai-proposed',
        label: m.label ?? undefined,
        width,
        height,
        data,
        source: (m.source === 'sam_box' ? 'ai-proposed' : (m.source as Mask['source'])),
        createdAt: Date.now(),
      };
      maskStore.injectWithId(mask);
    } catch (err) {
      console.warn('[backend-session] mask rehydrate failed for', m.id, err);
    }
  }
}

/**
 * Boots the BackendStateSlice + SSE subscription whenever the AiSession
 * has a session id. Calls analyze_image to populate context + autonomous
 * suggestions. Lives in EditorProvider; one instance per app.
 *
 * On boot, if there is no live AiSession yet, the hook checks localStorage
 * for a previously-persisted sessionId and probes the backend. If the session
 * is still alive it reattaches the SSE subscription without requiring a new
 * image upload. This preserves widgets, op_graph, image_context, and masks
 * across page reloads as long as the backend process is still running.
 */
export function useBackendSession(): void {
  const sessionId = useAiSession((s) => s.sessionId);
  const setSessionId = useBackendState((s) => s.setSessionId);
  const setSnapshot = useBackendState((s) => s.setSnapshot);
  const reset = useBackendState((s) => s.reset);
  const subscriptionRef = useRef<SseHandle | null>(null);

  useEffect(() => {
    // ── Case 1: a live AiSession already exists (normal upload flow) ──────────
    if (sessionId) {
      setSessionId(sessionId);
      let cancelled = false;

      (async () => {
        try {
          // 1. Open SSE and WAIT for the connection to establish — events
          //    emitted before the subscription opens are dropped (EventBus
          //    doesn't buffer for late subscribers).
          const handle = openSseSubscription(sessionId);
          subscriptionRef.current = handle;
          await handle.opened;

          if (cancelled) return;

          // 2. Pre-fetch the initial snapshot so SSE deltas (incl. streamed
          //    `context.updated` partials during a later analyze run) have
          //    something to merge into. The reducer's `!s.snapshot`
          //    early-out otherwise drops them.
          try {
            const initialResp = await fetch(`${BASE_URL}/api/state/${sessionId}`);
            if (cancelled) return;
            if (initialResp.ok) {
              const snap = await initialResp.json();
              setSnapshot(snap);
              // Rehydrate any mask bytes from a restored session; harmless
              // when masks_index is empty (the fresh-upload case).
              void rehydrateMaskBytes(sessionId, snap.masks_index ?? []);
            }
          } catch (err) {
            console.warn('[backend-session] initial snapshot fetch failed:', err);
          }

          // Analyze is intentionally NOT triggered here. The user opts in
          // via the "Analyze with AI" CTA which calls `useAiSession.runAnalyse()`.
          // Keeping analyze out of the session-bootstrap path lets the
          // toolrail adjustments work the moment SSE opens — no AI gate
          // for plain non-AI editing.
        } catch (err) {
          console.warn('[backend-session] boot failed:', err);
        }
      })();

      return () => {
        cancelled = true;
        subscriptionRef.current?.close();
        subscriptionRef.current = null;
      };
    }

    // ── Case 2: no live AiSession — attempt localStorage reattach ─────────────
    // When the user reloads the page, useAiSession.sessionId is null (in-memory
    // state is gone) but the backend session may still be alive. Check
    // localStorage for a previously-persisted sessionId and probe the backend.
    // If alive, reattach the SSE subscription without requiring a new upload.
    // If dead (404) or localStorage is empty, we cannot reattach; just reset.
    const storeSessionId = useBackendState.getState().sessionId;
    if (storeSessionId) {
      // Already in-store from a previous set in this render cycle — nothing to do.
      return;
    }

    let cancelled = false;

    (async () => {
      const persisted = getPersistedSessionId();
      if (!persisted) {
        // No persisted session — clean slate.
        reset();
        return;
      }

      const alive = await probeSession(persisted);
      if (cancelled) return;

      if (!alive) {
        // Backend has restarted or session evicted — start fresh.
        console.info('[backend-session] persisted session', persisted, 'is gone; starting fresh');
        await deletePrefix(persisted);
        reset();
        return;
      }

      // Session is alive — reattach.
      console.info('[backend-session] reattaching to persisted session', persisted);
      setSessionId(persisted);

      try {
        const handle = openSseSubscription(persisted);
        subscriptionRef.current = handle;
        await handle.opened;
        if (cancelled) return;

        // Rehydrate snapshot so the inspector/widgets are populated from existing state.
        const snapshotResp = await fetch(`${BASE_URL}/api/state/${persisted}`);
        if (cancelled) return;
        if (snapshotResp.ok) {
          const snap = await snapshotResp.json();
          setSnapshot(snap);
          void rehydrateMaskBytes(persisted, snap.masks_index ?? []);
          // Restore frontend layer metadata BEFORE restoring bitmaps — the
          // bitmap helper iterates `useEditorStore.layers`, which is empty
          // on reload until we repopulate it from IDB.
          const persistedState = await getEditorState<PersistedEditorState>(persisted);
          if (persistedState) {
            useEditorStore.setState({
              layers: persistedState.layers,
              activeLayerId: persistedState.activeLayerId,
              pixelVersion: persistedState.pixelVersion,
              documentMeta: persistedState.documentMeta,
            });
          }
          void restorePixelSources(persisted);
        }
      } catch (err) {
        console.warn('[backend-session] reattach failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
    };
  }, [sessionId, setSessionId, setSnapshot, reset]);
}
