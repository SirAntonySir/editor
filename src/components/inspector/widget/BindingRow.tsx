import type { ControlBinding, CurvesValue, MaskSummary } from '@/types/widget';
import { AdjustmentSlider, type SliderProvenance } from '@/components/inspector/AdjustmentSlider';
import { engineNeutralForBinding } from '@/engine/registry';
import { ToggleControl } from './primitives/ToggleControl';
import { ChoiceControl } from './primitives/ChoiceControl';
import { ColorControl } from './primitives/ColorControl';
import { RegionPickerControl } from './primitives/RegionPickerControl';
import { MaskThumbnailControl } from './primitives/MaskThumbnailControl';
import { CurveControl } from './primitives/CurveControl';


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
          neutralValue={engineNeutralForBinding(binding)}
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
