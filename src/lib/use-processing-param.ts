import { useCallback } from 'react';
import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';
import { ProcessingRegistry } from '@/lib/processing-registry';

/**
 * Unified hook for reading/writing adjustment parameters.
 * Works in any context: inspector panel, graph node, graph properties panel.
 *
 * @param layerId - Target layer ID
 * @param adjustmentType - Adjustment type in the store (e.g., 'basic', 'curves')
 * @param adjustmentId - Optional specific adjustment ID. If omitted, finds by type (singleton).
 * @param paramName - Parameter key
 * @param defaultValue - Default value when param doesn't exist
 */
export function useProcessingParam(
  layerId: string,
  adjustmentType: string,
  adjustmentId: string | undefined,
  paramName: string,
  defaultValue: number,
): [number, (v: number) => void] {
  const value = useEditorStore((s) => {
    const layer = s.layers.find((l) => l.id === layerId);
    if (!layer) return defaultValue;

    let adj;
    if (adjustmentId) {
      adj = layer.adjustmentStack.adjustments.find((a) => a.id === adjustmentId);
    } else {
      adj = layer.adjustmentStack.adjustments.find((a) => a.type === adjustmentType);
    }
    return (adj?.params[paramName] as number) ?? defaultValue;
  });

  const setValue = useCallback(
    (v: number) => {
      if (!layerId) return;

      const adjustmentName = ProcessingRegistry.getAdjustmentName(adjustmentType);
      if (!editorDocument.hasActiveInteraction) {
        editorDocument.beginInteraction(`Adjust ${adjustmentName}`);
      }
      editorDocument.tickInteraction();
      useEditorStore.getState().setAdjustment(layerId, adjustmentType, { [paramName]: v });
    },
    [layerId, adjustmentType, paramName],
  );

  return [value, setValue];
}
