import { useCallback, useEffect, useRef } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { RUNTIME } from '@/config';
import type { ControlValue } from '@/types/widget';

/** Read/write one canonical (layer, op, param) value, widget-less.
 * op is the canonical node type (basic | kelvin | curves | levels | lut).
 * Mirrors useProcessingParam but routes through the set_param tool and keys
 * optimistic patches on the canon node id (which IS the op_graph node id). */
export function useCanonicalParam<T extends ControlValue = number>(
  layerId: string | null,
  op: string,
  param: string,
  defaultValue: T,
): [T, (v: T) => void] {
  const nodeId = layerId ? `canon:${layerId}:${op}` : '';
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');

  const value = useBackendState((s) => {
    const opt = s.optimistic.get(nodeId);
    const hit = opt?.bindings.find((b) => b.paramKey === param);
    if (hit) return hit.value as T;
    const node = s.snapshot?.operationGraph.nodes.find((n) => n.id === nodeId);
    const p = node?.params?.[param];
    return (p === undefined ? defaultValue : (p as T));
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel any pending debounced write on unmount so a slider drag
  // that's still in flight when the panel closes doesn't fire
  // backendTools.set_param on a dead session.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const set = useCallback((v: T) => {
    if (!layerId || !sessionId || offline) return;
    const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
    useBackendState.getState().applyOptimistic(nodeId, {
      bindings: [{ paramKey: param, value: v as ControlValue }], baseRevision,
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // Stale-write guard: if a backend history op (undo/redo/revert)
      // landed between the user's input and this debounce firing, the
      // `history.applied` handler in backend-state-slice will have cleared
      // s.optimistic. Checking that our intended value still sits in the
      // optimistic map tells us nothing newer happened — if it doesn't,
      // dispatching the stale set_param would push a *new* history entry
      // that effectively "undoes" the revert from the user's POV.
      const opt = useBackendState.getState().optimistic.get(nodeId);
      const stillIntended = opt?.bindings.some(
        (b) => b.paramKey === param && b.value === (v as ControlValue),
      );
      if (!stillIntended) return;
      void backendTools.set_param(sessionId, { layerId, op, param, value: v as ControlValue });
    }, RUNTIME.sliderDebounceMs);
  }, [layerId, sessionId, offline, nodeId, op, param]);

  return [value, set];
}
