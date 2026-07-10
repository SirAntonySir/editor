import { AdjustmentSlider } from '@/components/ui/AdjustmentSlider';
import { HslPanelView } from '@/components/widget/hsl/HslPanelView';
import { HslSingleBandView } from '@/components/widget/hsl/HslSingleBandView';
import { HslAddBandControl } from '@/components/widget/hsl/HslAddBandControl';
import { HSL_BANDS } from '@/components/widget/hsl/hsl-bands';
import { shownHslBands, availableHslBands } from '@/components/widget/hsl/hsl-shown-bands';
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
  const revealed = useEditorStore((s) => s.hslRevealedBands[widget.id]);
  const revealBand = useEditorStore((s) => s.revealHslBand);
  const showAi = widget.origin.kind !== 'tool_invoked';
  const byParam = new Map(widget.bindings.map((b) => [b.paramKey, b] as const));

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

  // Bands to display: edited bands ∪ the ones the user revealed via "+", falling
  // back to a single band (red) so a fresh HSL widget opens on one colour. The
  // rest are reachable through the add-colour swatch. Reset lives on the widget
  // strip (WidgetHistoryStepper), so this body renders none of its own.
  const shown = shownHslBands(widget, revealed ?? []);
  const addable = HSL_BANDS.filter(
    (b) => availableHslBands(widget).includes(b.key) && !shown.includes(b.key),
  );

  const onAddBand = (band: string) => {
    // Persist the currently-shown bands (incl. the fallback default) before
    // adding, so the new colour augments the widget rather than replacing the
    // single band that was only there by fallback.
    for (const b of shown) revealBand(widget.id, b);
    revealBand(widget.id, band);
  };

  // The add-colour swatch sits in the band rail (both views) at swatch size.
  const addSlot = <HslAddBandControl bands={addable} onAdd={onAddBand} />;

  if (shown.length === 1) {
    return (
      <HslSingleBandView
        band={shown[0]}
        renderSlider={renderSlider}
        bandEdited={bandEdited}
        addSlot={addSlot}
      />
    );
  }
  // `availableBands={shown}` keeps the rail and by-channel view to the bands in
  // play — a complementary-grade preset (orange + blue) shows just those.
  return (
    <HslPanelView
      renderSlider={renderSlider}
      bandEdited={bandEdited}
      availableBands={shown}
      addSlot={addSlot}
    />
  );
}

/** True when a widget should render the HSL colour UI (shared `hsl` node). */
export function isHslWidget(widget: Widget): boolean {
  return widget.nodes.some((n) => n.type === 'hsl');
}
