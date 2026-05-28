import { useCallback, useRef } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

const DEBOUNCE_MS = 300;

/**
 * Unified hook for reading/writing adjustment parameters.
 * Works in any context: inspector panel, graph node, graph properties panel.
 *
 * @param _layerId - Target layer ID (kept for API compatibility; routing via widget)
 * @param _adjustmentType - Adjustment type (kept for API compatibility)
 * @param adjustmentId - Widget ID from the backend snapshot, or undefined
 * @param paramName - Parameter key
 * @param defaultValue - Default value when param doesn't exist
 */
export function useProcessingParam(
  _layerId: string,
  _adjustmentType: string,
  adjustmentId: string | undefined,
  paramName: string,
  defaultValue: number,
): [number, (v: number) => void] {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read: resolve via backend snapshot. If we have a widgetId, look up the
  // binding value from the widget; fall back to the operation_graph node param.
  const value = useBackendState((s) => {
    if (!adjustmentId) return defaultValue;

    // 1. Check optimistic patches first for instant slider feedback.
    const patch = s.optimistic.get(adjustmentId);
    if (patch) {
      const b = patch.bindings.find((p) => p.paramKey === paramName);
      if (b !== undefined && typeof b.value === 'number') return b.value;
    }

    // 2. Check widget bindings in snapshot.
    if (s.snapshot) {
      const widget = s.snapshot.widgets.find((w) => w.id === adjustmentId);
      if (widget) {
        const binding = widget.bindings.find((b) => b.param_key === paramName);
        if (binding !== undefined && typeof binding.value === 'number') return binding.value;
      }

      // 3. Fall back to operation_graph node params (node id === adjustmentId).
      const node = s.snapshot.operation_graph.nodes.find((n) => n.id === adjustmentId);
      if (node && typeof node.params[paramName] === 'number') {
        return node.params[paramName] as number;
      }
    }

    return defaultValue;
  });

  const setValue = useCallback(
    (v: number) => {
      if (!adjustmentId) return;

      const { sessionId, snapshot } = useBackendState.getState();
      if (!sessionId || !snapshot) return;

      const revision = snapshot.revision;

      // Apply optimistic patch for immediate visual feedback.
      useBackendState.getState().applyOptimistic(adjustmentId, {
        bindings: [{ paramKey: paramName, value: v }],
        baseRevision: revision,
      });

      // Debounced backend call.
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
