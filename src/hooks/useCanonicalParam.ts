import { useCallback, useRef } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import type { ControlValue } from '@/types/widget';

const DEBOUNCE_MS = 300;

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
    const node = s.snapshot?.operation_graph.nodes.find((n) => n.id === nodeId);
    const p = node?.params?.[param];
    return (p === undefined ? defaultValue : (p as T));
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = useCallback((v: T) => {
    if (!layerId || !sessionId || offline) return;
    const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
    useBackendState.getState().applyOptimistic(nodeId, {
      bindings: [{ paramKey: param, value: v as ControlValue }], baseRevision,
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void backendTools.set_param(sessionId, { layer_id: layerId, op, param, value: v as ControlValue });
    }, DEBOUNCE_MS);
  }, [layerId, sessionId, offline, nodeId, op, param]);

  return [value, set];
}
