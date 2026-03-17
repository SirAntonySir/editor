import { useCallback } from 'react';
import { useEditorStore } from '@/store';
import type { Adjustment } from '@/store/layer-slice';
import { editorDocument } from '@/core/document';

const ADJUSTMENT_NAMES: Record<Adjustment['type'], string> = {
  basic: 'Light & Color',
  curves: 'Curves',
  levels: 'Levels',
  kelvin: 'White Balance',
  lut: 'Filter',
};

export function useAdjustmentParam(
  type: Adjustment['type'],
  paramName: string,
  defaultValue: number,
): [number, (v: number) => void] {
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const value = useEditorStore((s) => {
    if (!s.activeLayerId) return defaultValue;
    const layer = s.layers.find((l) => l.id === s.activeLayerId);
    if (!layer) return defaultValue;
    const adj = layer.adjustmentStack.adjustments.find((a) => a.type === type);
    return (adj?.params[paramName] as number) ?? defaultValue;
  });

  const setValue = useCallback(
    (v: number) => {
      if (!activeLayerId) return;
      if (!editorDocument.hasActiveInteraction) {
        editorDocument.beginInteraction(`Adjust ${ADJUSTMENT_NAMES[type]}`);
      }
      editorDocument.tickInteraction();
      useEditorStore.getState().setAdjustment(activeLayerId, type, { [paramName]: v });
    },
    [activeLayerId, type, paramName],
  );

  return [value, setValue];
}
