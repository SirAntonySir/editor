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
        const envelope = await backendTools.analyze_image(sessionId);
        if (cancelled) return;
        if (!envelope.ok) {
          console.warn('[backend-session] analyze_image failed:', envelope.error);
        }
        const snapshotResp = await fetch(`${BASE_URL}/api/state/${sessionId}`);
        if (cancelled) return;
        if (snapshotResp.ok) {
          setSnapshot(await snapshotResp.json());
        }
        subscriptionRef.current = openSseSubscription(sessionId);
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
