import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import type { Scope } from '@/types/widget';

/** New propose-widget palette flow. The created widget appears in the
 *  inspector via the SSE `widget.created` event — no client-side layer
 *  materialization needed. */
export async function proposeFromPalette(
  text: string,
  scope: Scope = { kind: 'global' },
): Promise<void> {
  const sid = useBackendState.getState().sessionId;
  if (!sid) {
    console.warn('[palette] no session yet, ignoring submit');
    return;
  }
  const env = await backendTools.propose_widget(sid, {
    intent: text, scope, prompt: text,
  });
  if (!env.ok) {
    console.error('[palette] propose_widget failed:', env.error);
  }
}
