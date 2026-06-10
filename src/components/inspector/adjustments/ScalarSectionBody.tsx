import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useCanonicalParam } from '@/hooks/useCanonicalParam';
import { useParamProvenance, touchKey } from '@/hooks/useParamProvenance';
import { useEditorStore } from '@/store';
import { SliderPinMenu } from './SliderPinMenu';
import type { ParamDefinition } from '@/types/processing';

interface ScalarRowProps { toolId: string; layerId: string; op: string; param: ParamDefinition; }

function ScalarRow({ toolId, layerId, op, param }: ScalarRowProps) {
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
      pinSlot={
        <SliderPinMenu
          toolId={toolId}
          opAdjustmentType={op}
          layerId={layerId}
          paramKey={param.key}
          paramLabel={param.label}
        />
      }
    />
  );
}

interface ScalarSectionBodyProps { toolId: string; layerId: string; op: string; params: ParamDefinition[]; }

/** The per-section Reset row used to live here; it's been consolidated into
 *  the clickable touched-count badge in `ToolSection.tsx`. One affordance,
 *  same handler, no duplication. */
export function ScalarSectionBody({ toolId, layerId, op, params }: ScalarSectionBodyProps) {
  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      {params.map((p) => <ScalarRow key={p.key} toolId={toolId} layerId={layerId} op={op} param={p} />)}
    </div>
  );
}
