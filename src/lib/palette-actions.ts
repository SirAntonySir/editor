import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import type { Scope } from '@/types/widget';

export type ProposeResult =
  | { ok: true }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        retryable?: boolean;
        recovery_hint?: string;
      };
    };

/** New propose-widget palette flow. The created widget appears in the
 *  inspector via the SSE `widget.created` event — no client-side layer
 *  materialization needed. Returns a structured result so the caller can
 *  surface success / failure to the user. */
export async function proposeFromPalette(
  text: string,
  scope: Scope = { kind: 'global' },
): Promise<ProposeResult> {
  const sid = useBackendState.getState().sessionId;
  const layerId = useEditorStore.getState().activeLayerId;
  if (!sid || !layerId) {
    return {
      ok: false,
      error: {
        code: 'no_session',
        message: !sid ? 'Not connected to backend.' : 'Open an image first.',
      },
    };
  }
  try {
    const env = await backendTools.propose_widget(sid, {
      intent: text,
      scope,
      prompt: text,
      layer_id: layerId,
      origin: 'mcp_user_prompt',
    });
    if (env.ok) return { ok: true };
    return {
      ok: false,
      error: env.error ?? { code: 'unknown', message: 'Backend rejected the request.' },
    };
  } catch (e) {
    return {
      ok: false,
      error: { code: 'network', message: e instanceof Error ? e.message : String(e) },
    };
  }
}
