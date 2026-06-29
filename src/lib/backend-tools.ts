import type { Widget, Scope, ControlValue } from '@/types/widget';
import type { ImageContext } from '@/types/image-context';
import { BACKEND_BASE_URL as BASE_URL } from '@/lib/backend-url';

export interface PrepareImageOutput {
  samOk: boolean;
  imageWidth: number;
  imageHeight: number;
  /** CheapPassResult shape — leave as `unknown` until a consumer needs it. */
  cheap: unknown;
}

export interface PrecomputeRegionsOutput {
  maskIds: string[];
}

export interface SuggestWidgetsOutput {
  widgetIds: string[];
}

export interface ProposeMaskInput {
  imageNodeId: string;
  pngBase64: string;
  paths: number[][][];
  label?: string | null;
  origin: 'client_refinement' | 'client_new' | 'client_extracted';
}

export interface ProposeMaskOutput {
  maskId: string;
}

export interface DeleteMaskInput {
  maskId: string;
}

export interface DeleteMaskOutput {
  maskId: string;
}

export interface RenameMaskInput {
  maskId: string;
  label: string;
}

export interface RenameMaskOutput {
  maskId: string;
  label: string;
}

/** One pick returned by the palette typing-time matcher. `kind` discriminates
 *  registry op vs preset; `id` is the registry id the palette executes. */
export interface SmartMatchPick {
  kind: 'op' | 'preset';
  id: string;
  reason: string;
}

export interface SmartMatchOutput {
  picks: SmartMatchPick[];
}

/** One chip the user dropped onto Cmd+K (Info-tab pin). Mirrors the
 *  backend `_AttachedChip` shape. */
export interface AskAboutImageChip {
  label: string;
  value: string;
  sourceId?: string;
}

export interface AskAboutImageOutput {
  markdown: string;
}

export interface ToolEnvelope<T> {
  ok: boolean;
  output?: T;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
    recovery_hint?: string;
  };
}

async function invokeTool<T>(
  name: string,
  sessionId: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolEnvelope<T>> {
  const response = await fetch(`${BASE_URL}/api/tools/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, input }),
    signal,
  });
  // 429 = backend rate limiter tripped (e.g. drag flooding set_widget_param).
  // Return a soft-fail envelope instead of throwing so fire-and-forget
  // call sites (the slider-drag write path is the canonical example) don't
  // produce unhandled-promise-rejection console spam. The optimistic UI
  // patch already reflects the value; the next debounced flush succeeds.
  if (response.status === 429) {
    return {
      ok: false,
      error: { code: 'rate_limited', message: 'rate limited', retryable: true },
    };
  }
  if (!response.ok) {
    throw new Error(`/api/tools/${name} → ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as ToolEnvelope<T>;
}

async function historyAction(
  sessionId: string,
  action: 'undo' | 'redo' | 'revert',
): Promise<{ revision: number; applied: string } | null> {
  const response = await fetch(`${BASE_URL}/api/state/${sessionId}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  // 409 = nothing on the backend's stack — caller falls back to the
  // frontend's workspace history. Anything else is a real failure.
  if (response.status === 409) return null;
  if (!response.ok) {
    throw new Error(
      `/api/state/${sessionId}/${action} → ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as { revision: number; applied: string };
}

export const backendTools = {
  prepare_image(sessionId: string) {
    return invokeTool<PrepareImageOutput>('prepare_image', sessionId, {});
  },
  analyze_context(sessionId: string, input: { layerId?: string } = {}) {
    return invokeTool<ImageContext>('analyze_context', sessionId, input);
  },
  precompute_regions(sessionId: string) {
    return invokeTool<PrecomputeRegionsOutput>('precompute_regions', sessionId, {});
  },
  suggest_widgets(sessionId: string, input: { layerId?: string } = {}) {
    return invokeTool<SuggestWidgetsOutput>('suggest_widgets', sessionId, input);
  },
  list_widgets(sessionId: string) {
    return invokeTool<{ widgets: Widget[] }>('list_widgets', sessionId, {});
  },
  proposeStack(sessionId: string, args: {
    intent: string;
    scope: Scope;
    origin: 'mcp_user_prompt' | 'mcp_autonomous' | 'tool_invoked';
    forced_ops?: string[];
    /** Per-op initial param overrides; only honored for the `tool_invoked`
     *  / `forced_ops` path. Used by Auto Light / Auto Color / etc to spawn
     *  widgets at mechanically-derived starting values. */
    forced_params?: Record<string, Record<string, number | string | boolean>>;
    preset_id?: string;
    prompt?: string;
    layerId?: string;
    layerIds?: string[];
  }) {
    return invokeTool<{ widgets: Widget[] }>('propose_stack', sessionId, args);
  },
  refine_widget(sessionId: string, args: {
    widgetId: string;
    edits: { paramKey: string; instruction: string }[];
    additions: { request: string }[];
    instruction?: string;
  }) {
    return invokeTool<{ widget: Widget }>('refine_widget', sessionId, args);
  },
  repeat_widget(sessionId: string, args: { widgetId: string }) {
    return invokeTool<{ widget: Widget }>('repeat_widget', sessionId, args);
  },
  delete_widget(sessionId: string, args: { widgetId: string; suppressSimilar: boolean }) {
    return invokeTool<{ widgetId: string }>('delete_widget', sessionId, args);
  },
  restore_widget(sessionId: string, args: { widgetId: string }) {
    return invokeTool<{ widgetId: string }>('restore_widget', sessionId, args);
  },
  accept_widget(sessionId: string, args: { widgetId: string }) {
    return invokeTool<{ widgetId: string }>('accept_widget', sessionId, args);
  },
  set_widget_param(sessionId: string, args: { widgetId: string; paramKey: string; value: ControlValue }) {
    return invokeTool<{ widget: Widget }>('set_widget_param', sessionId, args);
  },
  unlock_widget_param(sessionId: string, args: { widgetId: string; paramKey: string }) {
    return invokeTool<{ widget: Widget }>('unlock_widget_param', sessionId, args);
  },
  set_param(sessionId: string, args: { layerId: string; op: string; param: string; value: ControlValue }) {
    return invokeTool<{ ok: boolean }>('set_param', sessionId, args);
  },
  set_image_node_transform(sessionId: string, args: {
    imageNodeId: string;
    layerIds: string[];
    crop: { x: number; y: number; w: number; h: number } | null;
    rotate: { angle: number; flip_h: boolean; flip_v: boolean } | null;
  }) {
    return invokeTool<{ ok: boolean }>('set_image_node_transform', sessionId, args);
  },
  preview_widget(sessionId: string, args: { widgetId: string; max_dim?: number }) {
    return invokeTool<{ mime_type: string; image_b64: string | null; reason?: string }>(
      'preview_widget', sessionId, args,
    );
  },
  propose_mask(sessionId: string, input: ProposeMaskInput) {
    return invokeTool<ProposeMaskOutput>('propose_mask', sessionId, input as unknown as Record<string, unknown>);
  },
  delete_mask(sessionId: string, input: DeleteMaskInput) {
    return invokeTool<DeleteMaskOutput>('delete_mask', sessionId, input as unknown as Record<string, unknown>);
  },
  rename_mask(sessionId: string, input: RenameMaskInput) {
    return invokeTool<RenameMaskOutput>('rename_mask', sessionId, input as unknown as Record<string, unknown>);
  },
  /** Palette typing-time matcher — returns 0..3 op/preset ids ranked by
   *  fit to BOTH the typed query and the current image's context. Fast
   *  tier (Haiku 4.5) and cache-friendly catalog/context blocks so a
   *  debounced keystroke costs little. `signal` cancels the request when
   *  a newer query supersedes it. */
  smart_match_command(
    sessionId: string,
    input: { query: string },
    signal?: AbortSignal,
  ) {
    return invokeTool<SmartMatchOutput>(
      'smart_match_command', sessionId, input, signal,
    );
  },
  /** Palette Ask-mode entry point — free-form Q&A about the open photo.
   *  Returns a markdown string grounded in image_context + editor state +
   *  attached chips. Sonnet tier (mid latency, mid cost). `signal`
   *  cancels the request when the user fires a new query. */
  ask_about_image(
    sessionId: string,
    input: { query: string; attachedChips?: AskAboutImageChip[] },
    signal?: AbortSignal,
  ) {
    return invokeTool<AskAboutImageOutput>(
      'ask_about_image', sessionId, input as unknown as Record<string, unknown>, signal,
    );
  },
  /** Cancel the in-flight mutate/emit tool task for this session, if any.
   *  Hits the dedicated /session/{sid}/cancel endpoint (not /tools/) since
   *  cancellation targets the registry, not a specific tool. */
  async cancelAnalyze(sessionId: string): Promise<{ cancelled: boolean }> {
    const response = await fetch(`${BASE_URL}/api/session/${sessionId}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`/api/session/${sessionId}/cancel → ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as { cancelled: boolean };
  },

  /** Reply to a backend client.tool_request: POST the result (or denial) of an
   *  LlmToolRegistry tool so the awaiting agent loop unblocks. */
  async postToolResult(
    sessionId: string,
    result: { requestId: string; ok: boolean; output?: unknown; error?: string; denied?: boolean },
  ): Promise<{ resolved: boolean }> {
    const response = await fetch(`${BASE_URL}/api/state/${sessionId}/tool_result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: result.requestId,
        ok: result.ok,
        output: result.output ?? null,
        error: result.error ?? null,
        denied: result.denied ?? false,
      }),
    });
    if (!response.ok) throw new Error(`tool_result POST failed: ${response.status}`);
    return response.json() as Promise<{ resolved: boolean }>;
  },

  /** Start an agentic turn: the backend runs a multi-turn Anthropic loop that
   *  may call client tools (via client.tool_request) and propose_adjustment_widgets. */
  async agentTurn(
    sessionId: string,
    body: {
      intent: string; attached_objects: string[];
      forced_targets: { image_node_id: string; layer_ids: string[] }[];
      client_tools: unknown[];
      active_node: { image_node_id: string; layer_ids: string[] } | null;
    },
  ): Promise<{ ok: boolean; toolCalls: number }> {
    const response = await fetch(`${BASE_URL}/api/state/${sessionId}/agent_turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`agent_turn failed: ${response.status}`);
    const json = (await response.json()) as { ok: boolean; tool_calls: number };
    return { ok: json.ok, toolCalls: json.tool_calls };
  },

  /** Backend snapshot-based history. Each returns null when the backend
   *  has nothing on its stack (HTTP 409) so the caller can fall back to
   *  the frontend's workspace history. Any other failure throws. */
  async undo(sessionId: string): Promise<{ revision: number; applied: string } | null> {
    return historyAction(sessionId, 'undo');
  },
  async redo(sessionId: string): Promise<{ revision: number; applied: string } | null> {
    return historyAction(sessionId, 'redo');
  },
  async revertAll(sessionId: string): Promise<{ revision: number; applied: string } | null> {
    return historyAction(sessionId, 'revert');
  },

  /** Return the session's history log (entries omit snapshot bytes). */
  async listHistory(sessionId: string): Promise<{
    entries: { id: string; ts: number; label: string }[];
    cursor: number;
    can_undo: boolean;
    can_redo: boolean;
  } | null> {
    const response = await fetch(`${BASE_URL}/api/state/${sessionId}/history`);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `/api/state/${sessionId}/history → ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as {
      entries: { id: string; ts: number; label: string }[];
      cursor: number;
      can_undo: boolean;
      can_redo: boolean;
    };
  },

  /** Seek the history cursor to `targetCursor`. -1 = pre-history baseline.
   *  Returns null when the target is invalid or already current (HTTP 409). */
  async jumpHistory(
    sessionId: string,
    targetCursor: number,
  ): Promise<{ revision: number; applied: string } | null> {
    const response = await fetch(
      `${BASE_URL}/api/state/${sessionId}/jump/${targetCursor}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      },
    );
    if (response.status === 409) return null;
    if (!response.ok) {
      throw new Error(
        `/api/state/${sessionId}/jump/${targetCursor} → ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as { revision: number; applied: string };
  },

  /** Per-widget history: the slice of the global undo stack that touched
   *  `widgetId`, with that widget's param snapshots inlined for delta
   *  rendering. Returns null when the session is unknown (HTTP 404). */
  async widgetHistory(
    sessionId: string,
    widgetId: string,
  ): Promise<{
    entries: {
      id: string;
      ts: number;
      label: string;
      params_before: Record<string, Record<string, unknown>>;
      params_after: Record<string, Record<string, unknown>>;
    }[];
    current_entry_id: string | null;
    can_restore: boolean;
  } | null> {
    const response = await fetch(
      `${BASE_URL}/api/state/${sessionId}/widget-history/${widgetId}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `/api/state/${sessionId}/widget-history/${widgetId} → ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as {
      entries: {
        id: string;
        ts: number;
        label: string;
        params_before: Record<string, Record<string, unknown>>;
        params_after: Record<string, Record<string, unknown>>;
      }[];
      current_entry_id: string | null;
      can_restore: boolean;
    };
  },

  /** Restore one widget's params from a past history entry, re-applied as a
   *  NEW forward mutation (so it shows in the global history and is itself
   *  undoable). Returns null on 404 (unknown session / entry / widget). */
  async restoreWidgetToRevision(
    sessionId: string,
    widgetId: string,
    entryId: string,
  ): Promise<{ revision: number; applied: string } | null> {
    const response = await fetch(
      `${BASE_URL}/api/state/${sessionId}/restore-widget/${widgetId}/${entryId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `/api/state/${sessionId}/restore-widget/${widgetId}/${entryId} → ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as { revision: number; applied: string };
  },
};
