import { useEffect, useState } from 'react';
import { AdjustmentSlider } from '@/components/ui/AdjustmentSlider';
import { LevelsHistogramControl } from '@/components/inspector/LevelsHistogramControl';
import { useCanonicalParam } from '@/hooks/useCanonicalParam';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { PipelineManager } from '@/lib/pipeline-manager';

/**
 * Inspector adapter for the Levels tool: drives `LevelsHistogramControl`
 * (input black/gamma/white) + two output-range sliders off canonical
 * params via `useCanonicalParam`. Mirrors `HslSectionBody` — both replace
 * the generic `ScalarSectionBody` rendering for tools that benefit from a
 * richer affordance than a flat slider list.
 *
 * Routed via the `'levels'` branch in `ToolSection`.
 */
export function LevelsSectionBody({ layerId }: { layerId: string }) {
  const [inBlack, setInBlack] = useCanonicalParam<number>(layerId, 'levels', 'inBlack', 0);
  const [inWhite, setInWhite] = useCanonicalParam<number>(layerId, 'levels', 'inWhite', 255);
  const [gamma, setGamma] = useCanonicalParam<number>(layerId, 'levels', 'gamma', 1.0);
  const [outBlack, setOutBlack] = useCanonicalParam<number>(layerId, 'levels', 'outBlack', 0);
  const [outWhite, setOutWhite] = useCanonicalParam<number>(layerId, 'levels', 'outWhite', 255);

  // Histogram source: lazy-init from the registry, then subscribe to the
  // pipeline so the chart refreshes when upstream adjustments tick.
  // Lazy-init avoids setState-during-effect. The prev-prop pattern resets
  // synchronously when layerId changes.
  const [source, setSource] = useState<HTMLCanvasElement | OffscreenCanvas | null>(
    () => CanvasRegistry.get(layerId) ?? null,
  );
  const [prevLayerId, setPrevLayerId] = useState(layerId);
  if (prevLayerId !== layerId) {
    setPrevLayerId(layerId);
    setSource(CanvasRegistry.get(layerId) ?? null);
  }
  useEffect(() => {
    // setSource inside the subscriber callback is the canonical allowed
    // case (external-system → React state).
    const unsub = PipelineManager.subscribe((output) => setSource(output));
    return unsub;
  }, []);

  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      <LevelsHistogramControl
        source={source}
        inBlack={inBlack}
        inWhite={inWhite}
        gamma={gamma}
        onInBlackChange={setInBlack}
        onInWhiteChange={setInWhite}
        onGammaChange={setGamma}
      />
      <div className="h-px bg-separator" />
      <div className="text-[9px] uppercase tracking-wide text-text-secondary">
        Output Levels
      </div>
      <AdjustmentSlider
        label="Output Black"
        value={outBlack}
        min={0}
        max={255}
        defaultValue={0}
        onChange={setOutBlack}
      />
      <AdjustmentSlider
        label="Output White"
        value={outWhite}
        min={0}
        max={255}
        defaultValue={255}
        onChange={setOutWhite}
      />
    </div>
  );
}
