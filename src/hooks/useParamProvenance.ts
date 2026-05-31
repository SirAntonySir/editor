import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import type { SliderProvenance } from '@/components/inspector/AdjustmentSlider';

/** Key a canonical (layer, op, param) slot for the touched-params set. */
export function touchKey(layerId: string, op: string, param: string): string {
  return `${layerId}:${op}:${param}`;
}

/**
 * Provenance of a canonical param's current value, for slider colour-coding:
 *  - `default`: value equals its default → grey
 *  - `hand`: the user moved it (in the touched set) → accent
 *  - `ai`: an AI/fused widget proposed this non-default value and the user
 *    hasn't overridden it → violet
 *
 * Resolution order: a value at its default always reads `default`; otherwise a
 * user touch wins over an AI proposal.
 */
export function useParamProvenance(
  layerId: string | null,
  op: string,
  param: string,
  value: number,
  defaultValue: number,
): SliderProvenance {
  const touched = useEditorStore((s) =>
    layerId ? s.touchedParams.has(touchKey(layerId, op, param)) : false,
  );
  const aiProposed = useBackendState((s) => {
    if (!layerId || !s.snapshot) return false;
    for (const w of s.snapshot.widgets) {
      if (w.status !== 'active' && w.status !== 'accepted') continue;
      if (w.origin.kind === 'tool_invoked') continue; // only AI/fused origins
      for (const b of w.bindings) {
        if (b.target.param_key !== param) continue;
        const node = w.nodes.find((n) => n.id === b.target.node_id);
        if (node?.layer_id === layerId && node.type === op && b.value !== b.default) {
          return true;
        }
      }
    }
    return false;
  });

  if (value === defaultValue) return 'default';
  if (touched) return 'hand';
  if (aiProposed) return 'ai';
  return 'hand';
}
