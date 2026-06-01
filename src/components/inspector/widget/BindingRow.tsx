import type { ControlBinding, CurvesValue, MaskSummary } from '@/types/widget';
import { AdjustmentSlider, type SliderProvenance } from '@/components/inspector/AdjustmentSlider';
import { engineParam } from '@/engine/registry';
import { ToggleControl } from './primitives/ToggleControl';
import { ChoiceControl } from './primitives/ChoiceControl';
import { ColorControl } from './primitives/ColorControl';
import { RegionPickerControl } from './primitives/RegionPickerControl';
import { MaskThumbnailControl } from './primitives/MaskThumbnailControl';
import { CurveControl } from './primitives/CurveControl';

/** Engine-canonical neutral for a binding. Used to anchor the slider's
 *  neutral tick to a stable reference (0 for bipolar params, 6500 for
 *  kelvin, 1.0 for gamma, …) instead of the AI's resolved value, which
 *  is what `binding.default` carries for `tunable_default=true` templates.
 *
 *  Lookup precedence:
 *    1. The shared engine registry (covers every shader param the engine
 *       knows about).
 *    2. A range heuristic for legacy / synthetic params not in the
 *       registry (e.g. fused templates' `temperature` delta): bipolar
 *       range → 0, unipolar → min.
 */
function neutralForBinding(binding: ControlBinding): number | undefined {
  const reg = engineParam(binding.target.param_key);
  if (reg) return reg.default;
  const s = binding.control_schema;
  if (s.control_type !== 'slider') return undefined;
  if (s.min < 0 && s.max > 0) return 0;
  return s.min;
}

interface BindingRowProps {
  binding: ControlBinding;
  effectiveValue: ControlBinding['value'];
  onChange: (value: ControlBinding['value']) => void;
  maskSummaries: MaskSummary[];
  /** Slider fill colour — default=grey, ai=violet, hand=accent. */
  provenance?: SliderProvenance;
}

export function BindingRow({ binding, effectiveValue, onChange, maskSummaries, provenance }: BindingRowProps) {
  const s = binding.control_schema;
  switch (s.control_type) {
    case 'slider':
      return (
        <AdjustmentSlider
          label={binding.label}
          value={Number(effectiveValue)}
          min={s.min}
          max={s.max}
          step={s.step}
          defaultValue={Number(binding.default)}
          neutralValue={neutralForBinding(binding)}
          provenance={provenance}
          formatValue={s.unit ? (v) => `${Math.round(v)}${s.unit}` : undefined}
          onChange={(v) => onChange(v)}
        />
      );
    case 'toggle':
      return <ToggleControl label={binding.label} value={Boolean(effectiveValue)} default={Boolean(binding.default)} schema={s} onChange={onChange} />;
    case 'choice':
      return <ChoiceControl label={binding.label} value={String(effectiveValue)} default={String(binding.default)} schema={s} onChange={onChange} />;
    case 'color':
      return <ColorControl label={binding.label} value={String(effectiveValue)} default={String(binding.default)} schema={s} onChange={onChange} />;
    case 'region_picker':
      return <RegionPickerControl label={binding.label} value={String(effectiveValue)} default={String(binding.default)} schema={s} onChange={onChange} maskSummaries={maskSummaries} />;
    case 'mask_thumbnail':
      return <MaskThumbnailControl label={binding.label} value={String(effectiveValue)} default={String(binding.default)} schema={s} onChange={onChange} maskSummaries={maskSummaries} />;
    case 'curve':
      return <CurveControl label={binding.label} value={effectiveValue as CurvesValue} onChange={onChange} />;
  }
}
