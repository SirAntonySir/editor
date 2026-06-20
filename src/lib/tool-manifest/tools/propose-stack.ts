import { z } from 'zod';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { scopeSchema, type ScopeInput } from '../shared-schemas';
import type { ToolManifest } from '../types';
import type { Scope } from '@/types/scope';

const input = z.object({
  intent: z.string().min(1).describe(
    'A concise description of the desired aesthetic result, e.g. "cinematic teal and orange" or "warm golden hour look".',
  ),
  scope: scopeSchema,
  origin: z
    .enum(['mcp_user_prompt', 'mcp_autonomous', 'tool_invoked'])
    .describe('Who is calling this tool. Use "mcp_user_prompt" for user requests.'),
  forced_ops: z
    .array(z.string())
    .optional()
    .describe(
      'Registry op ids to force into the stack (e.g. ["light", "color"]). Omit to let the backend planner choose.',
    ),
  prompt: z.string().optional().describe('Verbatim user text to include in the prompt context.'),
  layerId: z.string().optional().describe('Layer to target. Defaults to the active layer when omitted.'),
});

const output = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});

/** Resolve the LLM-facing scope vocabulary to the internal Scope type. */
function resolveScope(scopeInput: ScopeInput): Scope {
  if (scopeInput.kind === 'global') return { kind: 'global' };
  if (scopeInput.kind === 'active_selection') {
    const s = useEditorStore.getState();
    const ref = s.activeMaskRef ?? s.committedMaskRef;
    if (!ref) return { kind: 'global' };
    return { kind: 'mask', mask_id: ref };
  }
  // named_region
  return { kind: 'named_region', label: scopeInput.label };
}

export const proposeStackTool: ToolManifest<typeof input, typeof output> = {
  name: 'propose_stack',
  kind: 'mutate',
  description:
    'Propose a stack of 1–6 widgets for a single intent. Use this for any creative aesthetic request (mood, style, grading). The backend planner selects which ops best serve the intent and materialises each as a widget via SSE. Prefer this over apply_adjustment when the user wants to explore or when the request is subjective.',
  usage:
    'The result is delivered asynchronously through SSE widget.created events — the HTTP response confirms the call was accepted. Do not attempt to use the returned widget list to place nodes manually.',
  inputSchema: input,
  outputSchema: output,
  handler: ({ intent, scope, origin, forced_ops, prompt, layerId }) => {
    const sid = useBackendState.getState().sessionId;
    if (!sid) return { ok: false, message: 'Backend session not available.' };

    // Resolve a REAL layer id, never letting the backend fall back to its
    // "legacy" default. Without this the produced widget's nodes carry
    // layer_id="legacy", which the frontend tether resolver can't match to
    // any image-node — the widget exists in the snapshot but has no canvas
    // home. Order: caller-supplied → activeLayerId → first image-layer of
    // the active image-node. If none of those exist there is no image to
    // adjust; refuse with a useful message so the LLM can recover.
    const editor = useEditorStore.getState();
    const activeNode = editor.activeImageNodeId
      ? editor.imageNodes[editor.activeImageNodeId]
      : undefined;
    const firstPhotoLayer = activeNode
      ? activeNode.layerIds.find(
          (lid) => editor.layers.find((l) => l.id === lid)?.type === 'image',
        ) ?? activeNode.layerIds[0]
      : undefined;
    const resolvedLayerId = layerId ?? editor.activeLayerId ?? firstPhotoLayer;
    if (!resolvedLayerId) {
      return {
        ok: false,
        message:
          'No image is active. Open an image and try again, or pass layerId explicitly.',
      };
    }

    // The backend reads multi-layer broadcast routing from
    // scope.kind === "image_node". The LLM-facing scope vocabulary
    // doesn't expose that variant, so when the LLM asks for global scope
    // and we have an active image-node, upgrade silently to image_node so
    // the produced widget broadcasts across the node's layers — matching
    // what the frontend spawn paths (toolrail / promote / Cmd+K) already
    // do via the layerIds field they cannot send from here.
    const resolvedScope: Scope =
      scope.kind === 'global' && activeNode
        ? { kind: 'image_node', imageNodeId: activeNode.id, layerIds: activeNode.layerIds }
        : resolveScope(scope);

    void backendTools.proposeStack(sid, {
      intent,
      scope: resolvedScope,
      origin,
      forced_ops,
      prompt,
      layerId: resolvedLayerId,
    });
    return { ok: true, message: `propose_stack accepted for intent: "${intent}".` };
  },
};
