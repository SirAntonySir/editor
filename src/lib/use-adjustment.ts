import { useCallback, useRef } from 'react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { selectPipelineNodes } from './select-pipeline-nodes';

const DEBOUNCE_MS = 300;

/**
 * Hook for reading/writing a named param on the active layer's first matching
 * pipeline node of the given adjustment type.
 *
 * Read path: backend snapshot → optimistic patches → operation_graph nodes.
 * Write path: applyOptimistic + debounced set_widget_param.
 */
export function useAdjustmentParam(
  type: string,
  paramName: string,
  defaultValue: number,
): [number, (v: number) => void] {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);

  const value = useBackendState((s) => {
    if (!activeLayerId || !s.snapshot) return defaultValue;

    // Find the first node of the given type on the active layer.
    const node = s.snapshot.operationGraph.nodes.find(
      (n) => n.layerId === activeLayerId && n.type === type,
    );
    if (!node) return defaultValue;

    // Check optimistic patch.
    const patch = s.optimistic.get(node.id);
    if (patch) {
      const b = patch.bindings.find((p) => p.paramKey === paramName);
      if (b !== undefined && typeof b.value === 'number') return b.value;
    }

    if (typeof node.params[paramName] === 'number') {
      return node.params[paramName] as number;
    }
    return defaultValue;
  });

  const setValue = useCallback(
    (v: number) => {
      if (!activeLayerId) return;

      // Find the node ID to use as widget reference.
      const nodes = selectPipelineNodes().filter(
        (n) => n.layerId === activeLayerId && n.type === type,
      );
      const nodeId = nodes[0]?.id;
      if (!nodeId) return;

      const { sessionId, snapshot } = useBackendState.getState();
      if (!sessionId || !snapshot) return;

      const revision = snapshot.revision;

      useBackendState.getState().applyOptimistic(nodeId, {
        bindings: [{ paramKey: paramName, value: v }],
        baseRevision: revision,
      });

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void backendTools.set_widget_param(sessionId, {
          widgetId: nodeId,
          paramKey: paramName,
          value: v,
        });
      }, DEBOUNCE_MS);
    },
    [activeLayerId, type, paramName],
  );

  return [value, setValue];
}
