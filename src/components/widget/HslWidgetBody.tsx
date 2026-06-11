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
  const byParam = new Map(widget.bindings.map((b) => [b.paramKey, b] as const));
  const bands = [...new Set(widget.bindings.map((b) => b.paramKey.split('_')[0]))];

  const renderSlider = (param: string, label: string, trackGradient: string) => {
    const b = byParam.get(param);
    if (!b) return null;
    const eff = effectiveValue(b);
    const s = b.controlSchema;
    const node = widget.nodes.find((n) => n.id === b.target.nodeId);
    const isTouched = node?.layerId
      ? touched.has(touchKey(node.layerId, node.type, b.target.paramKey))
      : false;
    return (
      <AdjustmentSlider
        label={label}
        value={Number(eff)}
        min={s.controlType === 'slider' ? s.min : -100}
        max={s.controlType === 'slider' ? s.max : 100}
        step={s.controlType === 'slider' ? s.step : 1}
        defaultValue={Number(b.default)}
        // Engine-canonical neutral for HSL band params is 0. Same value
        // flows to bindingProvenance so AI sliders read VIOLET while
        // resting at the AI's pick, flipping to ACCENT (blue) only after
        // the user touches.
        neutralValue={0}
        provenance={bindingProvenance(eff, b.default, showAi, isTouched, 0)}
        trackGradient={trackGradient}
        onChange={(v) => setParam(b.paramKey, v)}
      />
    );
  };

  const bandEdited = (band: string) =>
    HSL_CHANNELS.some((c) => {
      const b = byParam.get(`${band}_${c}`);
      return b ? effectiveValue(b) !== b.default : false;
    });

  const onReset = () => {
    for (const b of widget.bindings) setParam(b.paramKey, b.default);
  };

  if (bands.length === 1) {
    return <HslSingleBandView band={bands[0]} renderSlider={renderSlider} onReset={onReset} />;
  }
  // `availableBands` are the bands this widget actually has bindings for —
  // a complementary-grade preset binds only orange + blue; the rail and the
  // by-channel view should hide the empty ones rather than render dead rows.
  return (
    <HslPanelView
      renderSlider={renderSlider}
      bandEdited={bandEdited}
      onReset={onReset}
      availableBands={bands}
    />
  );
}

/** True when a widget should render the HSL colour UI (shared `hsl` node). */
export function isHslWidget(widget: Widget): boolean {
  return widget.nodes.some((n) => n.type === 'hsl');
}
