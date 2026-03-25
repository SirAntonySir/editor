import { useCallback } from 'react';
import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';
import { ProcessingRegistry } from '@/lib/processing-registry';

const ADJUSTMENT_NAMES: Record<string, string> = {
  basic: 'Light & Color',
  curves: 'Curves',
  levels: 'Levels',
  kelvin: 'White Balance',
  lut: 'Filter',
};

export function useAdjustmentParam(
  type: string,
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
      const name = ADJUSTMENT_NAMES[type] ?? ProcessingRegistry.getAdjustmentName(type);
      if (!editorDocument.hasActiveInteraction) {
        editorDocument.beginInteraction(`Adjust ${name}`);
      }
      editorDocument.tickInteraction();
      useEditorStore.getState().setAdjustment(activeLayerId, type, { [paramName]: v });
    },
    [activeLayerId, type, paramName],
  );

  return [value, setValue];
}
