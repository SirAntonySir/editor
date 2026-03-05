import { useEffect, useRef, useCallback } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useAdjustmentParam } from '@/lib/use-adjustment';
import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { PipelineManager } from '@/lib/pipeline-manager';

function drawHistogram(source: HTMLCanvasElement | OffscreenCanvas, target: HTMLCanvasElement) {
  const sampleW = Math.min(source.width, 512);
  const sampleH = Math.min(source.height, 512);
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

function Histogram() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);

  const updateHistogram = useCallback((output: HTMLCanvasElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawHistogram(output, canvas);
  }, []);

  // Draw initial histogram from working canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeLayerId) return;
    const working = CanvasRegistry.get(activeLayerId);
    if (!working) return;
    drawHistogram(working, canvas);
  }, [activeLayerId]);

  // Subscribe to pipeline renders for live updates
  useEffect(() => {
    return PipelineManager.subscribe(updateHistogram);
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

function LevelsPanel() {
  const [inBlack, setInBlack] = useAdjustmentParam('levels', 'inBlack', 0);
  const [inWhite, setInWhite] = useAdjustmentParam('levels', 'inWhite', 255);
  const [gamma, setGamma] = useAdjustmentParam('levels', 'gamma', 1.0);
  const [outBlack, setOutBlack] = useAdjustmentParam('levels', 'outBlack', 0);
  const [outWhite, setOutWhite] = useAdjustmentParam('levels', 'outWhite', 255);

  return (
    <div className="p-3 flex flex-col gap-3">
      <Histogram />

      <div className="text-xs font-medium text-text-secondary">Input Levels</div>
      <AdjustmentSlider label="Black Point" value={inBlack} min={0} max={255} onChange={setInBlack} />
      <AdjustmentSlider
        label="Midtones"
        value={gamma}
        min={0.1}
        max={10}
        step={0.01}
        onChange={setGamma}
        formatValue={(v) => v.toFixed(2)}
      />
      <AdjustmentSlider label="White Point" value={inWhite} min={0} max={255} onChange={setInWhite} />

      <div className="h-px bg-separator" />

      <div className="text-xs font-medium text-text-secondary">Output Levels</div>
      <AdjustmentSlider label="Output Black" value={outBlack} min={0} max={255} onChange={setOutBlack} />
      <AdjustmentSlider label="Output White" value={outWhite} min={0} max={255} onChange={setOutWhite} />
    </div>
  );
}

export const LevelsTool: ToolDefinition = {
  name: 'levels',
  label: 'Levels',
  icon: SlidersHorizontal,
  category: 'adjust',
  OptionsPanel: LevelsPanel,
};
