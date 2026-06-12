import type { StateEvent, SessionStateSnapshot } from '@/types/widget';
import { useBackendState } from '@/store/backend-state-slice';
import { RUNTIME } from '@/config';

const BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

export function parseSseLine(line: string): StateEvent | null {
  if (!line.startsWith('data: ')) return null;
  try {
    return JSON.parse(line.slice(6)) as StateEvent;
  } catch {
    return null;
  }
}

async function fetchSnapshot(sessionId: string): Promise<SessionStateSnapshot> {
  const response = await fetch(`${BASE_URL}/api/state/${sessionId}`);
  if (!response.ok) throw new Error(`/api/state/${sessionId} → ${response.status}`);
  return (await response.json()) as SessionStateSnapshot;
}

export interface SseHandle {
  close: () => void;
  /** Resolves when the EventSource fires its first onopen (or after the
   * configured safety timeout in RUNTIME.sseSafetyTimeoutMs). */
  opened: Promise<void>;
}

export function openSseSubscription(sessionId: string): SseHandle {
  const state = useBackendState.getState();
  let attempt = 0;
  let closed = false;
  let source: EventSource | null = null;

  // Resolve once — on first onopen or after the safety timeout.
  let resolveOpened!: () => void;
  const opened = new Promise<void>((resolve) => { resolveOpened = resolve; });
  // Safety net: if onopen never fires (e.g. the server is slow), analyze still
  // proceeds rather than hanging forever.
  setTimeout(() => resolveOpened(), RUNTIME.sseSafetyTimeoutMs);

  function backoffMs(): number {
    return Math.min(
      RUNTIME.sseReconnectMaxMs,
      RUNTIME.sseReconnectBaseMs * 2 ** Math.min(attempt, 4),
    );
  }

  async function rehydrate() {
    try {
      const snap = await fetchSnapshot(sessionId);
      state.setSnapshot(snap);
    } catch (err) {
      console.warn('[sse] rehydrate failed:', err);
    }
  }

  function open() {
    if (closed) return;
    state.setSseStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    source = new EventSource(`${BASE_URL}/api/state/${sessionId}/events`);

    source.onopen = () => {
      attempt = 0;
      state.setSseStatus('open');
      // Resolve the opened promise (safe to call multiple times — Promise deduplicates).
      resolveOpened();
    };

    source.onmessage = (event) => {
      const ev = parseSseLine(`data: ${event.data}`);
      if (ev) state.applyEvent(ev);
    };

    source.onerror = () => {
      if (closed) return;
      source?.close();
      attempt += 1;
      state.setSseStatus('reconnecting');
      // Refetch the snapshot on every reconnect (no Last-Event-ID replay in v1).
      setTimeout(() => {
        rehydrate().finally(open);
      }, backoffMs());
    };
  }

  open();

  return {
    opened,
    close: () => {
      closed = true;
      source?.close();
      state.setSseStatus('closed');
    },
  };
}
