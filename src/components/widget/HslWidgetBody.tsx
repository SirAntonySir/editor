import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { HslPanelView } from '@/components/inspector/adjustments/HslPanelView';
import { HslSingleBandView } from '@/components/inspector/adjustments/HslSingleBandView';
import { bindingProvenance, touchKey } from '@/hooks/useParamProvenance';
import { useEditorStore } from '@/store';
import type { Widget, ControlBinding, ControlValue } from '@/types/widget';

const HSL_CHANNELS = ['hue', 'sat', 'lum'] as const;

interface HslWidgetBodyProps {
  widget: Widget;
  /** Optimistic-aware current value of a binding (provided by WidgetShell). */
  effectiveValue: (binding: ControlBinding) => ControlValue;
  /** Write a binding's param (provided by WidgetShell → set_widget_param). */
  setParam: (paramKey: string, value: ControlValue) => void;
}

/** Widget adapter: drives the shared HSL views from `widget.bindings`. Picks the
 *  single-band view when the bindings cover exactly one band, else the full panel. */
export function HslWidgetBody({ widget, effectiveValue, setParam }: HslWidgetBodyProps) {
  const touched = useEditorStore((s) => s.touchedParams);
  const showAi = widget.origin.kind !== 'tool_invoked';
  const byParam = new Map(widget.bindings.map((b) => [b.param_key, b] as const));
  const bands = [...new Set(widget.bindings.map((b) => b.param_key.split('_')[0]))];

  const renderSlider = (param: string, label: string, trackGradient: string) => {
    const b = byParam.get(param);
    if (!b) return null;
    const eff = effectiveValue(b);
    const s = b.control_schema;
    const node = widget.nodes.find((n) => n.id === b.target.node_id);
    const isTouched = node?.layer_id
      ? touched.has(touchKey(node.layer_id, node.type, b.target.param_key))
      : false;
    return (
      <AdjustmentSlider
        label={label}
        value={Number(eff)}
        min={s.control_type === 'slider' ? s.min : -100}
        max={s.control_type === 'slider' ? s.max : 100}
        step={s.control_type === 'slider' ? s.step : 1}
        defaultValue={Number(b.default)}
        // Engine-canonical neutral for all HSL band params is 0; pinning
        // here keeps the tick on the centre even when the AI seeded the
        // binding's default to a non-zero suggestion.
        neutralValue={0}
        provenance={bindingProvenance(eff, b.default, showAi, isTouched)}
        trackGradient={trackGradient}
        onChange={(v) => setParam(b.param_key, v)}
      />
    );
  };

  const bandEdited = (band: string) =>
    HSL_CHANNELS.some((c) => {
      const b = byParam.get(`${band}_${c}`);
      return b ? effectiveValue(b) !== b.default : false;
    });

  const onReset = () => {
    for (const b of widget.bindings) setParam(b.param_key, b.default);
  };

  if (bands.length === 1) {
    return <HslSingleBandView band={bands[0]} renderSlider={renderSlider} onReset={onReset} />;
  }
  return <HslPanelView renderSlider={renderSlider} bandEdited={bandEdited} onReset={onReset} />;
}

/** True when a widget should render the HSL colour UI (shared `hsl` node). */
export function isHslWidget(widget: Widget): boolean {
  return widget.nodes.some((n) => n.type === 'hsl');
}
