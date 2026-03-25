import { useEffect, useRef, useCallback } from 'react';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useProcessingParam } from '@/lib/use-processing-param';
import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { PipelineManager } from '@/lib/pipeline-manager';

// ─── Histogram ──────────────────────────────────────────────────────

function drawHistogram(source: HTMLCanvasElement | OffscreenCanvas, target: HTMLCanvasElement) {
  const sampleW = Math.min(source.width, 256);
  const sampleH = Math.min(source.height, 256);
  const sampleCanvas = new OffscreenCanvas(sampleW, sampleH);
  const sampleCtx = sampleCanvas.getContext('2d');
  if (!sampleCtx) return;
  sampleCtx.drawImage(source, 0, 0, sampleW, sampleH);

  const imageData = sampleCtx.getImageData(0, 0, sampleW, sampleH);
  const { data } = imageData;

  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const lum = new Uint32Array(256);

  for (let i = 0; i < data.length; i += 4) {
    r[data[i]]++;
    g[data[i + 1]]++;
    b[data[i + 2]]++;
    const l = Math.round(data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722);
    lum[l]++;
  }

  const drawCtx = target.getContext('2d');
  if (!drawCtx) return;

  const w = target.width;
  const h = target.height;
  drawCtx.clearRect(0, 0, w, h);

  let maxVal = 0;
  for (let i = 1; i < 255; i++) {
    maxVal = Math.max(maxVal, lum[i], r[i], g[i], b[i]);
  }
  if (maxVal === 0) return;

  const drawChannel = (bins: Uint32Array, color: string) => {
    drawCtx.beginPath();
    drawCtx.moveTo(0, h);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const barH = Math.min(h, (bins[i] / maxVal) * h);
      drawCtx.lineTo(x, h - barH);
    }
    drawCtx.lineTo(w, h);
    drawCtx.closePath();
    drawCtx.fillStyle = color;
    drawCtx.fill();
  };

  drawChannel(r, 'rgba(255, 68, 68, 0.25)');
  drawChannel(g, 'rgba(68, 187, 68, 0.25)');
  drawChannel(b, 'rgba(68, 136, 255, 0.25)');
  drawChannel(lum, 'rgba(180, 180, 180, 0.4)');
}

const HISTOGRAM_THROTTLE_MS = 150;

function Histogram({ layerId }: { layerId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pendingSource = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushHistogram = useCallback(() => {
    const canvas = canvasRef.current;
    const source = pendingSource.current;
    if (!canvas || !source) return;
    pendingSource.current = null;
    drawHistogram(source, canvas);
  }, []);

  const updateHistogram = useCallback((output: HTMLCanvasElement) => {
    pendingSource.current = output;
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushHistogram();
    }, HISTOGRAM_THROTTLE_MS);
  }, [flushHistogram]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layerId) return;
    const working = CanvasRegistry.get(layerId);
    if (!working) return;
    drawHistogram(working, canvas);
  }, [layerId]);

  useEffect(() => {
    const unsub = PipelineManager.subscribe(updateHistogram);
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [updateHistogram]);

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={80}
      className="w-full h-20 rounded-sm bg-surface-secondary"
    />
  );
}

// ─── Panel ──────────────────────────────────────────────────────────

export function LevelsPanel({ layerId, adjustmentId }: ProcessingPanelProps) {
  const [inBlack, setInBlack] = useProcessingParam(layerId, 'levels', adjustmentId, 'inBlack', 0);
  const [inWhite, setInWhite] = useProcessingParam(layerId, 'levels', adjustmentId, 'inWhite', 255);
  const [gamma, setGamma] = useProcessingParam(layerId, 'levels', adjustmentId, 'gamma', 1.0);
  const [outBlack, setOutBlack] = useProcessingParam(layerId, 'levels', adjustmentId, 'outBlack', 0);
  const [outWhite, setOutWhite] = useProcessingParam(layerId, 'levels', adjustmentId, 'outWhite', 255);

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
      <Histogram layerId={layerId} />

      <div className="text-xs font-medium text-text-secondary">Input Levels</div>
      <AdjustmentSlider label="Black Point" value={inBlack} min={0} max={255} defaultValue={0} onChange={setInBlack} />
      <AdjustmentSlider
        label="Midtones"
        value={gamma}
        min={0.1}
        max={10}
        step={0.01}
        defaultValue={1.0}
        onChange={setGamma}
        formatValue={(v) => v.toFixed(2)}
      />
      <AdjustmentSlider label="White Point" value={inWhite} min={0} max={255} defaultValue={255} onChange={setInWhite} />

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
  icon: SlidersHorizontal,
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
  expandable: true,
};
