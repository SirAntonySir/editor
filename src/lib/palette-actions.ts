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

/** Palette propose flow via `propose_stack`. The backend resolves the intent
 *  into 1–6 widgets; each appears in the inspector via the SSE `widget.created`
 *  event — no client-side layer materialization needed. Returns a structured
 *  result so the caller can surface success / failure to the user. */
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
    const env = await backendTools.proposeStack(sid, {
      intent: text,
      scope,
      prompt: text,
      layer_id: layerId,
      origin: 'mcp_user_prompt',
    });
    // Each widget in the stack is delivered via SSE widget.created events;
    // the HTTP response confirms the call succeeded but the frontend does not
    // need to manually place the returned widgets.
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
