import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import type { Scope } from '@/types/widget';

/** New propose-widget palette flow. The created widget appears in the
 *  inspector via the SSE `widget.created` event — no client-side layer
 *  materialization needed. */
export async function proposeFromPalette(
  text: string,
  scope: Scope = { kind: 'global' },
): Promise<void> {
  const sid = useBackendState.getState().sessionId;
  const layerId = useEditorStore.getState().activeLayerId;
  if (!sid || !layerId) {
    console.warn('[palette] no session or layer, ignoring submit');
    return;
  }
  const env = await backendTools.propose_widget(sid, {
    intent: text,
    scope,
    prompt: text,
    layer_id: layerId,
    origin: 'mcp_user_prompt',
  });
  if (!env.ok) {
    console.error('[palette] propose_widget failed:', env.error);
  }
}
