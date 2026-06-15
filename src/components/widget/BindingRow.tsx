import { Pin } from 'lucide-react';
import type { ControlBinding, CurvesValue, MaskSummary } from '@/types/widget';
import { AdjustmentSlider, type SliderProvenance } from '@/components/ui/AdjustmentSlider';
import { engineNeutralForBinding } from '@/engine/registry';
import { ToggleControl } from '@/components/widget/primitives/ToggleControl';
import { ChoiceControl } from '@/components/widget/primitives/ChoiceControl';
import { ColorControl } from '@/components/widget/primitives/ColorControl';
import { RegionPickerControl } from '@/components/widget/primitives/RegionPickerControl';
import { MaskThumbnailControl } from '@/components/widget/primitives/MaskThumbnailControl';
import { CurveControl } from '@/components/widget/primitives/CurveControl';
import { CurveEditor as RegistryCurveEditor } from '@/components/registry-controls/CurveEditor';
import { hueGradient } from '@/components/registry-controls/HueWheel';
import { kelvinGradient } from '@/components/registry-controls/KelvinStrip';
import { tintGradient } from '@/components/registry-controls/TintStrip';
import type { OpParam } from '@shared/registry/schema';

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
  /** When provided, a small Pin button renders at the right of the row.
   *  Clicking it spawns a one-control widget on the canvas containing just
   *  this binding (filter applied via `pinnedWidgetParams`). */
  onPin?: () => void;
  /** Caller-side disable for the Pin button (e.g. offline / no active layer). */
  pinDisabled?: boolean;
}

export function BindingRow({ binding, effectiveValue, onChange, maskSummaries, provenance, onPin, pinDisabled }: BindingRowProps) {
  const s = binding.controlSchema;
  const pinButton = onPin ? (
    <button
      type="button"
      onClick={onPin}
      disabled={pinDisabled}
      title={`Pin "${binding.label}" to canvas`}
      aria-label={`Pin ${binding.label} to canvas`}
      className="binding-pin inline-flex items-center text-text-secondary
        hover:text-text-primary hover:bg-surface-secondary
        p-0.5 rounded-[3px] disabled:opacity-40 disabled:cursor-not-allowed
        opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
    >
      <Pin size={11} aria-hidden />
    </button>
  ) : null;
  switch (s.controlType) {
    case 'slider':
      return (
        <div className="group relative">
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
          {pinButton && (
            <div className="absolute right-0 top-0">{pinButton}</div>
          )}
        </div>
      );
    case 'hue_wheel':
      // Color.hue + splitTone.{shadow,highlight}_hue bindings — render as a
      // hue-gradient slider. Previously fell through the switch and rendered
      // nothing, which made the hue control silently disappear from canvas
      // widgets (slider invisible → user couldn't shift hue from the widget).
      return (
        <div className="group relative">
          <AdjustmentSlider
            label={binding.label}
            value={Number(effectiveValue)}
            min={s.min}
            max={s.max}
            step={1}
            defaultValue={Number(binding.default)}
            neutralValue={engineNeutralForBinding(binding)}
            provenance={provenance}
            trackGradient={hueGradient(s.min, s.max)}
            formatValue={(v) => `${Math.round(v)}°`}
            onChange={(v) => onChange(v)}
          />
          {pinButton && (
            <div className="absolute right-0 top-0">{pinButton}</div>
          )}
        </div>
      );
    case 'kelvin_strip':
      // kelvin.temperature — cool→warm gradient slider (Lightroom convention:
      // blue left, amber right). Underlying value is still Kelvin.
      return (
        <div className="group relative">
          <AdjustmentSlider
            label={binding.label}
            value={Number(effectiveValue)}
            min={s.min}
            max={s.max}
            step={s.step ?? 1}
            defaultValue={Number(binding.default)}
            neutralValue={engineNeutralForBinding(binding)}
            provenance={provenance}
            trackGradient={kelvinGradient()}
            formatValue={(v) => `${Math.round(v)}K`}
            onChange={(v) => onChange(v)}
          />
          {pinButton && (
            <div className="absolute right-0 top-0">{pinButton}</div>
          )}
        </div>
      );
    case 'tint_strip':
      // kelvin.tint — teal↔magenta gradient slider, paired with kelvin_strip.
      return (
        <div className="group relative">
          <AdjustmentSlider
            label={binding.label}
            value={Number(effectiveValue)}
            min={s.min}
            max={s.max}
            step={s.step ?? 1}
            defaultValue={Number(binding.default)}
            neutralValue={engineNeutralForBinding(binding)}
            provenance={provenance}
            trackGradient={tintGradient()}
            formatValue={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}`}
            onChange={(v) => onChange(v)}
          />
          {pinButton && (
            <div className="absolute right-0 top-0">{pinButton}</div>
          )}
        </div>
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
          paramKey={binding.paramKey}
          label={binding.label}
          value={effectiveValue}
          schema={CURVE_EDITOR_STUB_SCHEMA}
          // RegistryCurveEditor's contract is `(next: unknown) => void` —
          // the BindingRow callback takes `ControlBinding['value']`. Cast
          // at the boundary; the underlying writer (set_widget_param) is
          // already shape-tolerant.
          onChange={(v: unknown) => onChange(v as ControlBinding['value'])}
        />
      );
  }
}
