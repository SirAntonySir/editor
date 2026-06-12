import type { Widget, Scope, ControlValue, WidgetOriginKind } from '@/types/widget';
import type { ImageContext } from '@/types/image-context';

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

const BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

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
): Promise<ToolEnvelope<T>> {
  const response = await fetch(`${BASE_URL}/api/tools/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, input }),
  });
  if (!response.ok) {
    throw new Error(`/api/tools/${name} → ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as ToolEnvelope<T>;
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
  propose_widget(sessionId: string, args: {
    intent: string;
    scope: Scope;
    opId?: string;
    prompt?: string;
    layerId: string;
    origin: WidgetOriginKind;
  }) {
    return invokeTool<{ widget: Widget }>('propose_widget', sessionId, args);
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
};
