import type { ControlBinding, CurvesValue, MaskSummary } from '@/types/widget';
import { AdjustmentSlider, type SliderProvenance } from '@/components/inspector/AdjustmentSlider';
import { engineNeutralForBinding } from '@/engine/registry';
import { ToggleControl } from './primitives/ToggleControl';
import { ChoiceControl } from './primitives/ChoiceControl';
import { ColorControl } from './primitives/ColorControl';
import { RegionPickerControl } from './primitives/RegionPickerControl';
import { MaskThumbnailControl } from './primitives/MaskThumbnailControl';
import { CurveControl } from './primitives/CurveControl';
import { CurveEditor as RegistryCurveEditor } from '@/components/registry-controls/CurveEditor';
import type { OpParam } from '../../../../shared/registry/schema';

// Stub schema for the registry CurveEditor — it only reads channel-locking
// from paramKey and ignores `schema` itself (min/max-point enforcement is
// deferred). Carrying the typed OpParam keeps the prop contract honest.
const CURVE_EDITOR_STUB_SCHEMA: OpParam = {
  type: 'curve_points',
  default: [[0, 0], [255, 255]],
} as OpParam;


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
    case 'curve_editor':
      // Registry-driven curves widget: each binding owns one channel
      // (param_key ∈ {rgb, red, green, blue}) and stores an XYPair[] in
      // 0–255 space. Reuse the registry-controls dispatcher, which locks
      // the underlying primitive to that channel and handles the 0–255 ↔
      // 0–1 translation.
      return (
        <RegistryCurveEditor
          paramKey={binding.param_key}
          label={binding.label}
          value={effectiveValue}
          schema={CURVE_EDITOR_STUB_SCHEMA}
          onChange={onChange}
        />
      );
  }
}
