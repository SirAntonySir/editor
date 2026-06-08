import { z } from 'zod';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { useAiSession } from '@/hooks/useImageContext';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { ackSchema, scopeSchema, type ScopeInput } from '../shared-schemas';
import type { ToolManifest } from '../types';
import type { Scope } from '@/types/scope';

const input = z.object({
  scope: scopeSchema,
  kind: z.string().describe('Processing kind registered in the ProcessingRegistry (e.g. "exposure", "contrast", "kelvin", "curves", "saturation"). Call list_named_regions or check the processing registry for valid kinds.'),
  params: z.record(z.union([z.number(), z.string(), z.boolean()])).describe('Parameters specific to the kind. Numeric values are common (e.g. exposure: 0.3).'),
  label: z.string().optional().describe('Optional display name shown to the user.'),
});

/**
 * Resolve the LLM-facing scope vocabulary to the internal Scope type.
 * Returns `null` when the requested scope cannot be resolved (no active
 * selection, missing region, missing mask).
 */
function resolveScope(scopeInput: ScopeInput): Scope | null {
  if (scopeInput.kind === 'global') return { kind: 'global' };
  if (scopeInput.kind === 'active_selection') {
    const s = useEditorStore.getState();
    const ref = s.activeMaskRef ?? s.committedMaskRef;
    if (!ref) return null;
    return { kind: 'mask', mask_id: ref };
  }
  // named_region
  const ctx = useAiSession.getState().context;
  const region = ctx?.candidateRegions?.find((r) => r.label === scopeInput.label);
  if (!region?.maskRef) return null;
  return { kind: 'mask', mask_id: region.maskRef };
}

export const applyAdjustmentTool: ToolManifest<typeof input, typeof ackSchema> = {
  name: 'apply_adjustment',
  kind: 'mutate',
  description:
    'Apply a processing adjustment to a scope. Use this when the operation is mechanically obvious (e.g. you are confident about a levels correction). For subjective decisions where the user should dial values in (mood, grading, stylistic choices), use propose_panel instead.',
  usage:
    'The scope can be global, the active selection, or a named region. The handler resolves named regions automatically — you do not need to select first.',
  inputSchema: input,
  outputSchema: ackSchema,
  handler: ({ scope, kind, label }) => {
    const definition = ProcessingRegistry.get(kind);
    if (!definition) {
      return { ok: false, message: `Unknown adjustment kind "${kind}". Valid kinds: ${ProcessingRegistry.getAll().map((d) => d.adjustmentType).join(', ')}.` };
    }
    const resolved = resolveScope(scope);
    if (!resolved) {
      return { ok: false, message: `Could not resolve scope ${JSON.stringify(scope)} — no matching mask in the document.` };
    }

    const state = useEditorStore.getState();
    const layerId = state.activeLayerId ?? state.layers.find((l) => l.type === 'image')?.id;
    if (!layerId) return { ok: false, message: 'No image layer to apply adjustment to.' };

    const sid = useBackendState.getState().sessionId;
    if (!sid) return { ok: false, message: 'Backend session not available.' };

    // Route adjustment through backend as a proposed widget.
    void backendTools.propose_widget(sid, {
      intent: label ?? `${kind} adjustment`,
      scope: resolved,
      op_id: kind,
      layer_id: layerId,
      origin: 'tool_invoked',
    });
    return { ok: true, message: `Proposing ${kind} with scope ${scope.kind}.` };
  },
};
