import { useCallback, useMemo } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { useEditorStore } from '@/store';
import { useSegmentSelection } from '@/store/segment-selection-slice';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { LutRegistry } from '@/lib/lut-registry';
import {
  PRESET_LUTS,
  type LUTData,
} from '@/lib/lut-parser';

export function FiltersPanel({ layerId: layerIdProp }: { layerId?: string } = {}) {
  const storeLayerId = useEditorStore((s) => s.activeLayerId);
  const activeLayerId = layerIdProp ?? storeLayerId;

  // Generate previews once per layer (CPU thumbnails from working canvas)
  const presets = useMemo(() => {
    if (!activeLayerId) return [];
    const offscreen = CanvasRegistry.get(activeLayerId);
    if (!offscreen) return [];

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

      ctx.drawImage(offscreen, 0, 0, thumbW, thumbH);

      const imageData = ctx.getImageData(0, 0, thumbW, thumbH);
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
      results.push({ name: lut.title, lut, preview: tmpCanvas.toDataURL() });
    }

    return results;
  }, [activeLayerId]);

  const applyFilter = useCallback((lut: LUTData) => {
    if (!activeLayerId) return;

    const store = useEditorStore.getState();
    const layer = store.layers.find((l) => l.id === activeLayerId);
    if (!layer) return;

    // Find existing LUT adjustment — replace it instead of stacking
    const existingLut = layer.adjustmentStack.adjustments.find((a) => a.type === 'lut');
    if (existingLut) {
      // Clean up old LUT data and cache
      LutRegistry.remove(existingLut.id);
      store.removeAdjustment(activeLayerId, existingLut.id);
    }

    const adjustmentId = crypto.randomUUID();

    // Store LUT data outside Zustand (too large for Immer proxies)
    LutRegistry.register(adjustmentId, lut.size, lut.data);

    // Add non-destructive LUT adjustment layer
    store.addAdjustment(activeLayerId, {
      id: adjustmentId,
      type: 'lut',
      name: lut.title,
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: { lutSize: lut.size },
    });
  }, [activeLayerId]);

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
  icon: ImageIcon,
  category: 'filter',
  processingId: 'filter',
  onActivate: () => {
    const sid = useSegmentSelection.getState().selectedSegmentId;
    useEditorStore.getState().setActiveScope(
      sid ? { kind: 'mask', mask_id: sid } : null,
    );
  },
};
