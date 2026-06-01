import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import type { SliderProvenance } from '@/components/inspector/AdjustmentSlider';

/** Key a canonical (layer, op, param) slot for the touched-params set. */
export function touchKey(layerId: string, op: string, param: string): string {
  return `${layerId}:${op}:${param}`;
}

/**
 * Pure provenance for a widget-binding value (used by canvas widgets + AI
 * accordion sections, which render the same widget bindings):
 *  - at the ENGINE neutral → `default` (grey)
 *  - user moved it → `hand` (accent)
 *  - AI-origin widget proposed this non-neutral value, untouched → `ai` (violet)
 *
 * `neutralValue` is the engine-canonical baseline (0 for bipolar params,
 * 6500 for kelvin, 1.0 for gamma, …). For AI bindings this is DIFFERENT
 * from `defaultValue`, which carries the AI's resolved pick — using
 * `defaultValue` as the "at-rest" check would incorrectly grey-out AI
 * sliders the moment they load (since their initial value equals the AI's
 * pick). When `neutralValue` is omitted the function falls back to
 * `defaultValue` (back-compat path for tool sliders where the two coincide).
 */
export function bindingProvenance(
  effectiveValue: unknown,
  defaultValue: unknown,
  isAiOrigin: boolean,
  isTouched: boolean,
  neutralValue?: unknown,
): SliderProvenance {
  const neutral = neutralValue !== undefined ? neutralValue : defaultValue;
  if (effectiveValue === neutral) return 'default';
  if (isTouched) return 'hand';
  if (isAiOrigin) return 'ai';
  return 'hand';
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
