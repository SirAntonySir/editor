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

export interface PaletteContextItem {
  label: string;
  value: string;
}

/** Build a structured `Image context:` preamble out of attached chips. The
 *  backend's planner reads the user prompt verbatim; embedding the context
 *  as a bulleted preamble keeps it readable in logs and makes the model
 *  treat it as fact rather than instruction. Returns an empty string when
 *  no items are attached. */
function _formatContextPreamble(items: PaletteContextItem[]): string {
  if (items.length === 0) return '';
  const lines = items.map((c) => `- ${c.label}: ${c.value}`);
  return `Image context (pinned by user):\n${lines.join('\n')}\n\n`;
}

/** Palette propose flow via `propose_stack`. The backend resolves the intent
 *  into 1–6 widgets; each appears in the inspector via the SSE `widget.created`
 *  event — no client-side layer materialization needed. Returns a structured
 *  result so the caller can surface success / failure to the user.
 *
 *  `contextItems` (optional) are surfaced to the LLM as a structured preamble
 *  attached above the user prompt. Used by the Cmd+K context-attachment
 *  strip when the user pinned chips from the Info tab. */
export async function proposeFromPalette(
  text: string,
  scope: Scope = { kind: 'global' },
  contextItems: PaletteContextItem[] = [],
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
  const preamble = _formatContextPreamble(contextItems);
  const enriched = `${preamble}${text}`;
  try {
    const env = await backendTools.proposeStack(sid, {
      intent: enriched,
      scope,
      prompt: enriched,
      layerId,
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
