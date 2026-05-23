import type { StateEvent, SessionStateSnapshot } from '@/types/widget';
import { useBackendState } from '@/store/backend-state-slice';

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

interface SseHandle {
  close: () => void;
}

export function openSseSubscription(sessionId: string): SseHandle {
  const state = useBackendState.getState();
  let attempt = 0;
  let closed = false;
  let source: EventSource | null = null;

  function backoffMs(): number {
    return Math.min(4000, 250 * 2 ** Math.min(attempt, 4));
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
    close: () => {
      closed = true;
      source?.close();
      state.setSseStatus('closed');
    },
  };
}
