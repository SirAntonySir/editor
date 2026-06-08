import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';

const LevelsIcon = createMaterialIcon('tune');
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { LevelsHistogramControl } from '@/components/inspector/LevelsHistogramControl';
import { useProcessingParam } from '@/lib/use-processing-param';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { PipelineManager } from '@/lib/pipeline-manager';

// ─── Panel ──────────────────────────────────────────────────────────

/** Track the latest pipeline output canvas as the histogram source. Mirrors
 *  the cold-start + subscribe pattern the legacy `<Histogram>` component
 *  used, but exposes the canvas as state so `<LevelsHistogramControl>` can
 *  consume it directly. */
function useHistogramSource(layerId: string | null): HTMLCanvasElement | OffscreenCanvas | null {
  const [source, setSource] = useState<HTMLCanvasElement | OffscreenCanvas | null>(null);
  useEffect(() => {
    if (!layerId) {
      setSource(null);
      return;
    }
    const working = CanvasRegistry.get(layerId);
    if (working) setSource(working);
    const unsub = PipelineManager.subscribe((output) => {
      setSource(output);
    });
    return unsub;
  }, [layerId]);
  return source;
}

export function LevelsPanel({ layerId, adjustmentId }: ProcessingPanelProps) {
  const [inBlack, setInBlack] = useProcessingParam(layerId, 'levels', adjustmentId, 'inBlack', 0);
  const [inWhite, setInWhite] = useProcessingParam(layerId, 'levels', adjustmentId, 'inWhite', 255);
  const [gamma, setGamma] = useProcessingParam(layerId, 'levels', adjustmentId, 'gamma', 1.0);
  const [outBlack, setOutBlack] = useProcessingParam(layerId, 'levels', adjustmentId, 'outBlack', 0);
  const [outWhite, setOutWhite] = useProcessingParam(layerId, 'levels', adjustmentId, 'outWhite', 255);

  const source = useHistogramSource(layerId);

  const isDefault = inBlack === 0 && inWhite === 255 && gamma === 1.0 && outBlack === 0 && outWhite === 255;
  const reset = () => {
    setInBlack(0);
    setInWhite(255);
    setGamma(1.0);
    setOutBlack(0);
    setOutWhite(255);
  };

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="text-xs font-medium text-text-secondary">Input Levels</div>
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

      <div className="text-xs font-medium text-text-secondary">Output Levels</div>
      <AdjustmentSlider label="Output Black" value={outBlack} min={0} max={255} defaultValue={0} onChange={setOutBlack} />
      <AdjustmentSlider label="Output White" value={outWhite} min={0} max={255} defaultValue={255} onChange={setOutWhite} />

      {!isDefault && (
        <button
          onClick={reset}
          className="flex items-center justify-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary
            bg-surface-secondary hover:bg-surface-secondary/80 rounded transition-colors cursor-default"
        >
          <RotateCcw size={10} />
          Reset
        </button>
      )}
    </div>
  );
}

const gammaFormat = (v: number) => v.toFixed(2);

export const levelsProcessing: ProcessingDefinition = {
  id: 'levels',
  label: 'Levels',
  icon: LevelsIcon,
  category: 'adjust',
  adjustmentType: 'levels',
  params: [
    { key: 'inBlack', label: 'Black Point', min: 0, max: 255, default: 0 },
    { key: 'inWhite', label: 'White Point', min: 0, max: 255, default: 255 },
    { key: 'gamma', label: 'Midtones', min: 0.1, max: 10, default: 1.0, step: 0.01, format: gammaFormat },
    { key: 'outBlack', label: 'Output Black', min: 0, max: 255, default: 0 },
    { key: 'outWhite', label: 'Output White', min: 0, max: 255, default: 255 },
  ],
  Panel: LevelsPanel,
};
