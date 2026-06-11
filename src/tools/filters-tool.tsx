import { useCallback, useMemo } from 'react';
import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ToolDefinition } from '@/types/tool';

const FiltersIcon = createMaterialIcon('filter_b_and_w');
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
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
    const sid = useBackendState.getState().sessionId;
    if (!sid) return;

    // Register LUT data so the WebGL pipeline can access it when the backend
    // confirms the widget. Use a stable key derived from the LUT title.
    const adjustmentId = crypto.randomUUID();
    LutRegistry.register(adjustmentId, lut.size, lut.data);

    // Propose a filter widget — default scope to active selection, fallback Global.
    // NOTE: filters/LUT remain on propose_widget; the 'filter' op_id is not yet
    // modeled in the SSoT registry (it uses TOOL_DEFAULTS + LutRegistry instead).
    const scope = useEditorStore.getState().activeScope ?? { kind: 'global' as const };
    void backendTools.propose_widget(sid, {
      intent: `Apply ${lut.title} filter`,
      scope,
      opId: 'filter',
      layerId: activeLayerId,
      origin: 'tool_invoked',
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
  icon: FiltersIcon,
  category: 'filter',
  processingId: 'filter',
  onActivate: () => {
    // activeScope is already set by the canvas click/cycle; nothing extra needed.
  },
};
