import { Sparkles } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';
import {
  PRESET_LUTS,
  type LUTData,
} from '@/lib/lut-parser';
import { useEffect, useState } from 'react';

function FiltersPanel() {
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const [presets, setPresets] = useState<{ name: string; lut: LUTData; preview: string }[]>([]);


  useEffect(() => {
    if (!activeLayerId) return;
    const offscreen = CanvasRegistry.get(activeLayerId);
    if (!offscreen) return;

    // Generate small preview thumbnails
    const thumbW = 64;
    const thumbH = Math.round((offscreen.height / offscreen.width) * thumbW);

    const results: { name: string; lut: LUTData; preview: string }[] = [];

    for (const genLUT of PRESET_LUTS) {
      const lut = genLUT();
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = thumbW;
      tmpCanvas.height = thumbH;
      const ctx = tmpCanvas.getContext('2d');
      if (!ctx) continue;

      // Draw downscaled original
      ctx.drawImage(offscreen, 0, 0, thumbW, thumbH);

      // Apply LUT via pixel manipulation (CPU preview)
      const imageData = ctx.getImageData(0, 0, thumbW, thumbH);
      const { data } = imageData;
      const lutSize = lut.size;
      const lutData = lut.data;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;

        // Nearest-neighbor 3D LUT lookup
        const ri = Math.min(lutSize - 1, Math.round(r * (lutSize - 1)));
        const gi = Math.min(lutSize - 1, Math.round(g * (lutSize - 1)));
        const bi = Math.min(lutSize - 1, Math.round(b * (lutSize - 1)));
        const idx = (bi * lutSize * lutSize + gi * lutSize + ri) * 3;

        data[i] = Math.round(lutData[idx] * 255);
        data[i + 1] = Math.round(lutData[idx + 1] * 255);
        data[i + 2] = Math.round(lutData[idx + 2] * 255);
      }

      ctx.putImageData(imageData, 0, 0);
      results.push({ name: lut.title, lut, preview: tmpCanvas.toDataURL() });
    }

    setPresets(results);
  }, [activeLayerId]);

  const applyFilter = (lut: LUTData) => {
    if (!activeLayerId) return;
    const offscreen = CanvasRegistry.get(activeLayerId);
    if (!offscreen) return;

    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
    const { data } = imageData;
    const lutSize = lut.size;
    const lutData = lut.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      const ri = Math.min(lutSize - 1, Math.round(r * (lutSize - 1)));
      const gi = Math.min(lutSize - 1, Math.round(g * (lutSize - 1)));
      const bi = Math.min(lutSize - 1, Math.round(b * (lutSize - 1)));
      const idx = (bi * lutSize * lutSize + gi * lutSize + ri) * 3;

      data[i] = Math.round(lutData[idx] * 255);
      data[i + 1] = Math.round(lutData[idx + 1] * 255);
      data[i + 2] = Math.round(lutData[idx + 2] * 255);
    }

    ctx.putImageData(imageData, 0, 0);

    // Force re-render — trigger a no-op adjustment change
    useEditorStore.getState().setAdjustment(activeLayerId, 'basic', {});
  };

  if (presets.length === 0) {
    return <div className="p-3 text-xs text-text-secondary">Load an image to see filter previews</div>;
  }

  return (
    <div className="p-2">
      <div className="grid grid-cols-2 gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset.name}
            onClick={() => applyFilter(preset.lut)}
            className="flex flex-col items-center gap-1 p-1 rounded hover:bg-surface-secondary transition-colors cursor-pointer"
          >
            <img
              src={preset.preview}
              alt={preset.name}
              className="w-full aspect-[4/3] object-cover rounded-sm"
            />
            <span className="text-[10px] text-text-secondary">{preset.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export const FiltersTool: ToolDefinition = {
  name: 'filters',
  label: 'Filters',
  icon: Sparkles,
  category: 'filter',
  OptionsPanel: FiltersPanel,
};
