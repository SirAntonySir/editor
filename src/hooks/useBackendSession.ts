import { useEffect, useRef } from 'react';
import { useAiSession } from '@/hooks/useImageContext';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { openSseSubscription } from '@/lib/sse-subscriber';

const BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

/**
 * Boots the BackendStateSlice + SSE subscription whenever the AiSession
 * has a session id. Calls analyze_image to populate context + autonomous
 * suggestions. Lives in EditorProvider; one instance per app.
 */
export function useBackendSession(): void {
  const sessionId = useAiSession((s) => s.sessionId);
  const setSessionId = useBackendState((s) => s.setSessionId);
  const setSnapshot = useBackendState((s) => s.setSnapshot);
  const reset = useBackendState((s) => s.reset);
  const subscriptionRef = useRef<{ close: () => void } | null>(null);

  useEffect(() => {
    if (!sessionId) {
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
      reset();
      return;
    }

    setSessionId(sessionId);
    let cancelled = false;

    (async () => {
      try {
        // 1. Open the SSE subscription FIRST. The connection establishes in
        //    <100ms locally; any events emitted by analyze after this point
        //    will be delivered.
        subscriptionRef.current = openSseSubscription(sessionId);

        // 2. Trigger analyze. Phase events, mask.created, widget.created etc.
        //    fire DURING this call and are received via the SSE stream.
        const envelope = await backendTools.analyze_image(sessionId);
        if (cancelled) return;
        if (!envelope.ok) {
          console.warn('[backend-session] analyze_image failed:', envelope.error);
        }

        // 3. Rehydrate the snapshot from REST as a safety net in case any
        //    early events arrived before the SSE connection fully opened.
        const snapshotResp = await fetch(`${BASE_URL}/api/state/${sessionId}`);
        if (cancelled) return;
        if (snapshotResp.ok) {
          setSnapshot(await snapshotResp.json());
        }
      } catch (err) {
        console.warn('[backend-session] boot failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
    };
  }, [sessionId, setSessionId, setSnapshot, reset]);
}
