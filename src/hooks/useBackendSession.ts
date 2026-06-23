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

import { BACKEND_BASE_URL as BASE_URL } from '@/lib/backend-url';

type ProbeResult = 'alive' | 'gone' | 'unreachable';

/**
 * Probe a persisted backend session. Distinguishes three cases so the caller
 * never destroys a session over a transient outage:
 *   - 'alive'       — 2xx, reattach.
 *   - 'gone'        — 404, the backend authoritatively says the session no
 *                     longer exists; safe to wipe local state and start fresh.
 *   - 'unreachable' — network error or 5xx (backend down / restarting / blip);
 *                     we CANNOT tell if the session is gone, so the caller must
 *                     keep localStorage + IndexedDB intact and try again later.
 *
 * The old version collapsed 'gone' and 'unreachable' into a single false, which
 * meant a backend restart (or any network hiccup) wiped the user's session +
 * cached pixels — the canvas then couldn't remount on reload.
 */
async function probeSession(sid: string): Promise<ProbeResult> {
  try {
    const r = await fetch(`${BASE_URL}/api/state/${sid}`);
    if (r.ok) return 'alive';
    if (r.status === 404) return 'gone';
    return 'unreachable';
  } catch {
    return 'unreachable';
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
 * has a session id. Calls the 4-tool analyze pipeline (prepare_image →
 * analyze_context → precompute_regions → suggest_widgets) to populate
 * context + autonomous suggestions. Lives in EditorProvider; one instance per app.
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
              void rehydrateMaskBytes(sessionId, snap.masksIndex ?? []);
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

      const probe = await probeSession(persisted);
      if (cancelled) return;

      if (probe === 'gone') {
        // Backend authoritatively returned 404 — the session is truly evicted.
        // Only now is it safe to drop the cached pixels + persisted id.
        console.info('[backend-session] persisted session', persisted, 'is gone (404); starting fresh');
        await deletePrefix(persisted);
        reset();
        return;
      }

      if (probe === 'unreachable') {
        // Backend down / restarting / network blip. We can't tell if the
        // session survived, so DON'T wipe — keep localStorage + IndexedDB so a
        // later reload reattaches once the backend is back. Leave the store
        // session id unset for now; the canvas stays on its last-rendered
        // state and a reload re-probes.
        console.warn('[backend-session] backend unreachable; keeping persisted session', persisted, '— reload once it is back');
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
          void rehydrateMaskBytes(persisted, snap.masksIndex ?? []);
          // Restore frontend layer metadata BEFORE restoring bitmaps — the
          // bitmap helper iterates `useEditorStore.layers`, which is empty
          // on reload until we repopulate it from IDB.
          const persistedState = await getEditorState<PersistedEditorState>(persisted);
          console.log('[reload] persisted editor state read', {
            sessionId: persisted,
            found: !!persistedState,
            layers: persistedState?.layers?.length ?? 0,
            imageNodes: Object.keys(persistedState?.imageNodes ?? {}).length,
            widgetNodes: Object.keys(persistedState?.widgetNodes ?? {}).length,
          });
          if (persistedState) {
            // Restore layers + workspace graph in ONE setState so the
            // auto-create effect in CanvasWorkspace sees the rehydrated
            // imageNodes alongside the layers. Without the workspace
            // fields, that effect would collapse all layers into a single
            // new node.
            useEditorStore.setState({
              layers: persistedState.layers,
              activeLayerId: persistedState.activeLayerId,
              pixelVersion: persistedState.pixelVersion,
              documentMeta: persistedState.documentMeta,
              imageNodes: persistedState.imageNodes ?? {},
              widgetNodes: persistedState.widgetNodes ?? {},
              tetherEdges: persistedState.tetherEdges ?? {},
              infoNodes: persistedState.infoNodes ?? {},
              activeImageNodeId: persistedState.activeImageNodeId ?? null,
              imageNodeMode: persistedState.imageNodeMode ?? {},
            });
          }
          console.log('[reload] kicking off restorePixelSources');
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
