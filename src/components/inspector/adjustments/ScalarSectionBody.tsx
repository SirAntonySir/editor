import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useCanonicalParam } from '@/hooks/useCanonicalParam';
import { useParamProvenance, touchKey } from '@/hooks/useParamProvenance';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import type { ParamDefinition } from '@/types/processing';

interface ScalarRowProps { layerId: string; op: string; param: ParamDefinition; }

function ScalarRow({ layerId, op, param }: ScalarRowProps) {
  const [value, setValue] = useCanonicalParam<number>(layerId, op, param.key, param.default);
  const provenance = useParamProvenance(layerId, op, param.key, value, param.default);
  function onChange(v: number) {
    // A human gesture → mark the slot hand-touched (accent, not AI violet).
    useEditorStore.getState().markParamTouched(touchKey(layerId, op, param.key));
    setValue(v);
  }
  return (
    <AdjustmentSlider
      label={param.label}
      value={value}
      min={param.min}
      max={param.max}
      step={param.step ?? 1}
      defaultValue={param.default}
      provenance={provenance}
      onChange={onChange}
    />
  );
}

interface ResetRowProps { layerId: string; op: string; params: ParamDefinition[]; }

function ResetRow({ layerId, op, params }: ResetRowProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  function reset() {
    if (!sessionId || offline) return;
    const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
    for (const p of params) {
      useBackendState.getState().applyOptimistic(`canon:${layerId}:${op}`, {
        bindings: [{ paramKey: p.key, value: p.default }], baseRevision,
      });
      void backendTools.set_param(sessionId, { layer_id: layerId, op, param: p.key, value: p.default });
    }
  }
  return (
    <div className="flex justify-end pt-1">
      <button type="button" onClick={reset} className="text-[10px] bg-surface text-text-primary border border-border-strong rounded-[4px] px-2 py-0.5 hover:bg-surface-secondary">Reset</button>
    </div>
  );
}

interface ScalarSectionBodyProps { layerId: string; op: string; params: ParamDefinition[]; }

export function ScalarSectionBody({ layerId, op, params }: ScalarSectionBodyProps) {
  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      {params.map((p) => <ScalarRow key={p.key} layerId={layerId} op={op} param={p} />)}
      <ResetRow layerId={layerId} op={op} params={params} />
    </div>
  );
}
