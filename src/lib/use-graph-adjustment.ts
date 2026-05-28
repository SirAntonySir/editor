import { useCallback, useRef } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

const DEBOUNCE_MS = 300;

/**
 * Hook for graph mode parameter editing.
 * Takes a node/adjustment ID directly and reads from the backend snapshot.
 */
export function useGraphAdjustmentParam(
  adjustmentId: string | undefined,
  paramName: string,
  defaultValue: number,
): [number, (v: number) => void] {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const value = useBackendState((s) => {
    if (!adjustmentId || !s.snapshot) return defaultValue;

    // Check optimistic patch first.
    const patch = s.optimistic.get(adjustmentId);
    if (patch) {
      const b = patch.bindings.find((p) => p.paramKey === paramName);
      if (b !== undefined && typeof b.value === 'number') return b.value;
    }

    // Fall back to operation_graph node params.
    const node = s.snapshot.operation_graph.nodes.find((n) => n.id === adjustmentId);
    if (node && typeof node.params[paramName] === 'number') {
      return node.params[paramName] as number;
    }

    return defaultValue;
  });

  const setValue = useCallback(
    (v: number) => {
      if (!adjustmentId) return;

      const { sessionId, snapshot } = useBackendState.getState();
      if (!sessionId || !snapshot) return;

      const revision = snapshot.revision;

      useBackendState.getState().applyOptimistic(adjustmentId, {
        bindings: [{ paramKey: paramName, value: v }],
        baseRevision: revision,
      });

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void backendTools.set_widget_param(sessionId, {
          widget_id: adjustmentId,
          param_key: paramName,
          value: v,
        });
      }, DEBOUNCE_MS);
    },
    [adjustmentId, paramName],
  );

  return [value, setValue];
}
