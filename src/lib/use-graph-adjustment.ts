import { useCallback } from 'react';
import { useEditorStore } from '@/store';
import type { Adjustment } from '@/store/layer-slice';
import { editorDocument } from '@/core/document';

const ADJUSTMENT_NAMES: Record<string, string> = {
  basic: 'Light & Color',
  curves: 'Curves',
  levels: 'Levels',
  kelvin: 'White Balance',
  lut: 'Filter',
};

/**
 * Hook for graph mode parameter editing.
 * Unlike useAdjustmentParam (which uses activeLayerId + type lookup),
 * this takes an adjustmentId directly and finds the layer containing it.
 */
export function useGraphAdjustmentParam(
  adjustmentId: string | undefined,
  paramName: string,
  defaultValue: number,
): [number, (v: number) => void] {
  const value = useEditorStore((s) => {
    if (!adjustmentId) return defaultValue;
    for (const layer of s.layers) {
      const adj = layer.adjustmentStack.adjustments.find((a) => a.id === adjustmentId);
      if (adj) {
        return (adj.params[paramName] as number) ?? defaultValue;
      }
    }
    return defaultValue;
  });

  const setValue = useCallback(
    (v: number) => {
      if (!adjustmentId) return;
      const state = useEditorStore.getState();

      // Find the layer and adjustment
      let targetLayerId: string | null = null;
      let targetAdj: Adjustment | null = null;
      for (const layer of state.layers) {
        const adj = layer.adjustmentStack.adjustments.find((a) => a.id === adjustmentId);
        if (adj) {
          targetLayerId = layer.id;
          targetAdj = adj;
          break;
        }
      }
      if (!targetLayerId || !targetAdj) return;

      if (!editorDocument.hasActiveInteraction) {
        editorDocument.beginInteraction(
          `Adjust ${ADJUSTMENT_NAMES[targetAdj.type] ?? targetAdj.name}`,
        );
      }
      editorDocument.tickInteraction();
      state.setAdjustment(targetLayerId, targetAdj.type, { [paramName]: v });
    },
    [adjustmentId, paramName],
  );

  return [value, setValue];
}
