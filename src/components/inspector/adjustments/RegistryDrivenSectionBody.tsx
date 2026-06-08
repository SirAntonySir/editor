import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';
import { loadRegistry } from '@/lib/registry/loader';
import { RegistryDrivenPanel } from '../RegistryDrivenPanel';
import { ScalarSectionBody } from './ScalarSectionBody';
import { touchKey } from '@/hooks/useParamProvenance';
import type { ParamDefinition } from '@/types/processing';

const DEBOUNCE_MS = 300;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface RegistryDrivenSectionBodyProps {
  /** ProcessingDefinition.id — used to look up the registry op. */
  defId: string;
  /** ProcessingDefinition.adjustmentType — used as `op` for canonical node id. */
  opType: string;
  layerId: string;
  /** Fallback params from ProcessingDefinition if no registry entry (should not happen). */
  params: ParamDefinition[];
}

/**
 * Wires RegistryDrivenPanel to the backend store for canonical (toolrail)
 * ops. Falls back to ScalarSectionBody if the op isn't in the registry yet.
 */
export function RegistryDrivenSectionBody({
  defId,
  opType,
  layerId,
  params,
}: RegistryDrivenSectionBodyProps) {
  const reg = loadRegistry();
  const registryOp = reg.ops[defId];

  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const nodeId = `canon:${layerId}:${opType}`;

  // Read all param values from the canonical node (with optimistic overlay).
  // useShallow performs a shallow comparison of the returned object so Zustand
  // doesn't trigger a re-render when individual values haven't changed, avoiding
  // the "getSnapshot should be cached" infinite-loop warning.
  const values = useBackendState(
    useShallow((s) => {
      const result: Record<string, unknown> = {};
      if (!registryOp) return result;
      for (const binding of registryOp.bindings) {
        const param = registryOp.params[binding.param_key];
        const defaultVal = param.default;
        const opt = s.optimistic.get(nodeId);
        const hit = opt?.bindings.find((b) => b.paramKey === binding.param_key);
        if (hit !== undefined) {
          result[binding.param_key] = hit.value;
          continue;
        }
        const node = s.snapshot?.operation_graph.nodes.find((n) => n.id === nodeId);
        const v = node?.params?.[binding.param_key];
        result[binding.param_key] = v === undefined ? defaultVal : v;
      }
      return result;
    }),
  );

  const onParamChange = useCallback(
    (paramKey: string, value: unknown) => {
      if (!sessionId || offline) return;
      const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
      // Mark the param as hand-touched for provenance colouring.
      useEditorStore.getState().markParamTouched(touchKey(layerId, opType, paramKey));
      // Optimistic patch for instant feedback.
      useBackendState.getState().applyOptimistic(nodeId, {
        bindings: [{ paramKey, value: value as number }],
        baseRevision,
      });
      // Debounced backend write.
      const timerKey = `${nodeId}:${paramKey}`;
      const existing = debounceTimers.get(timerKey);
      if (existing) clearTimeout(existing);
      debounceTimers.set(
        timerKey,
        setTimeout(() => {
          debounceTimers.delete(timerKey);
          void backendTools.set_param(sessionId, {
            layer_id: layerId,
            op: opType,
            param: paramKey,
            value: value as number,
          });
        }, DEBOUNCE_MS),
      );
    },
    [sessionId, offline, layerId, opType, nodeId],
  );

  if (!registryOp) {
    // Fallback: op not yet in the registry — use the bespoke scalar body.
    return <ScalarSectionBody layerId={layerId} op={opType} params={params} />;
  }

  return (
    <RegistryDrivenPanel
      op={registryOp}
      values={values}
      onParamChange={onParamChange}
      disabled={offline}
    />
  );
}
