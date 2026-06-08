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
  layer_id: z.string().optional().describe('Layer to target. Defaults to the active layer when omitted.'),
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
  handler: ({ intent, scope, origin, forced_ops, prompt, layer_id }) => {
    const sid = useBackendState.getState().sessionId;
    const resolvedLayerId = layer_id ?? useEditorStore.getState().activeLayerId ?? undefined;
    if (!sid) return { ok: false, message: 'Backend session not available.' };

    const resolvedScope = resolveScope(scope);
    void backendTools.proposeStack(sid, {
      intent,
      scope: resolvedScope,
      origin,
      forced_ops,
      prompt,
      layer_id: resolvedLayerId,
    });
    return { ok: true, message: `propose_stack accepted for intent: "${intent}".` };
  },
};
