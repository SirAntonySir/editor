import { useEffect, useState } from 'react';
import { LevelsHistogramControl } from '@/components/inspector/LevelsHistogramControl';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { PipelineManager } from '@/lib/pipeline-manager';
import type { Widget, ControlBinding, ControlValue } from '@/types/widget';

interface LevelsWidgetBodyProps {
  widget: Widget;
  effectiveValue: (binding: ControlBinding) => ControlValue;
  setParam: (paramKey: string, value: ControlValue) => void;
}

/** True when the widget exposes the full input-levels triple (inBlack +
 *  inWhite + gamma on a `levels` node) — the prerequisite for the rich
 *  histogram-with-handles control. Partial Levels widgets (e.g. `foggy`
 *  binds only `inBlack`) fall back to plain BindingRow sliders. */
export function isFullLevelsWidget(widget: Widget): boolean {
  const hasLevelsNode = widget.nodes.some((n) => n.type === 'levels');
  if (!hasLevelsNode) return false;
  const keys = new Set(widget.bindings.map((b) => b.param_key));
  return keys.has('inBlack') && keys.has('inWhite') && keys.has('gamma');
}

/** Widget adapter for the histogram-handles Levels control. Mirrors the
 *  HSL adapter: drives `LevelsHistogramControl` off `widget.bindings`,
 *  writing back through `setParam` (which goes through `set_widget_param`
 *  + optimistic canonical patch in WidgetShell). */
export function LevelsWidgetBody({
  widget,
  effectiveValue,
  setParam,
}: LevelsWidgetBodyProps) {
  // Hooks run unconditionally before any early return — the binding
  // lookup + null guard below must follow, not precede, useState/useEffect.
  // Histogram source subscribes to the pipeline so the chart redraws as
  // upstream adjustments tick.
  const layerId = widget.nodes[0]?.layer_id ?? null;
  const [source, setSource] = useState<HTMLCanvasElement | OffscreenCanvas | null>(null);
  useEffect(() => {
    if (!layerId) {
      setSource(null);
      return;
    }
    const working = CanvasRegistry.get(layerId);
    if (working) setSource(working);
    const unsub = PipelineManager.subscribe((output) => setSource(output));
    return unsub;
  }, [layerId]);

  const byParam = new Map(widget.bindings.map((b) => [b.param_key, b] as const));
  const inBlackBinding = byParam.get('inBlack');
  const inWhiteBinding = byParam.get('inWhite');
  const gammaBinding = byParam.get('gamma');
  if (!inBlackBinding || !inWhiteBinding || !gammaBinding) return null;

  return (
    <LevelsHistogramControl
      source={source}
      inBlack={Number(effectiveValue(inBlackBinding))}
      inWhite={Number(effectiveValue(inWhiteBinding))}
      gamma={Number(effectiveValue(gammaBinding))}
      onInBlackChange={(v) => setParam('inBlack', v)}
      onInWhiteChange={(v) => setParam('inWhite', v)}
      onGammaChange={(v) => setParam('gamma', v)}
    />
  );
}
