import type { StateEvent, SessionStateSnapshot } from '@/types/widget';
import { useBackendState } from '@/store/backend-state-slice';
import { RUNTIME } from '@/config';

import { BACKEND_BASE_URL as BASE_URL } from '@/lib/backend-url';

export function parseSseLine(line: string): StateEvent | null {
  if (!line.startsWith('data: ')) return null;
  try {
    return JSON.parse(line.slice(6)) as StateEvent;
  } catch {
    return null;
  }
}

/** Fetch the full SessionStateSnapshot. Exposed so the backend-state slice
 *  can call it when it sees a `state.gap` event (replay can't catch up). */
export async function fetchSnapshot(sessionId: string): Promise<SessionStateSnapshot> {
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
  let closed = false;

  // Resolve once — on first onopen or after the safety timeout.
  let resolveOpened!: () => void;
  const opened = new Promise<void>((resolve) => { resolveOpened = resolve; });
  // Safety net: if onopen never fires (e.g. the server is slow), analyze still
  // proceeds rather than hanging forever.
  setTimeout(() => resolveOpened(), RUNTIME.sseSafetyTimeoutMs);

  // The browser's EventSource auto-reconnects on its own and re-sends
  // `Last-Event-ID` on each reconnect — the backend uses that to replay
  // any missed entries from doc.history. We DON'T close + recreate on
  // error: doing so would lose the lastEventId the browser tracks, and
  // we'd have to refetch a full snapshot every blip.
  //
  // When replay can't catch up (history was pruned past the lastEventId),
  // the backend emits a synthetic `state.gap` event; the backend-state
  // slice reacts by calling fetchSnapshot() above.
  state.setSseStatus('connecting');
  const source = new EventSource(`${BASE_URL}/api/state/${sessionId}/events`);

  source.onopen = () => {
    state.setSseStatus('open');
    resolveOpened();
  };

  source.onmessage = (event) => {
    const ev = parseSseLine(`data: ${event.data}`);
    if (ev) state.applyEvent(ev);
  };

  source.onerror = () => {
    if (closed) return;
    // The browser will retry on its own (sse_starlette sends a `retry:`
    // hint). We only surface the status so the UI can show a tiny banner.
    state.setSseStatus('reconnecting');
  };

  return {
    opened,
    close: () => {
      closed = true;
      source.close();
      state.setSseStatus('closed');
    },
  };
}
