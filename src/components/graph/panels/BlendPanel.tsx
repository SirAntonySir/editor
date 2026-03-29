import { useCallback } from 'react';
import { useEditorStore } from '@/store';
import type { BlendMode } from '@/store/layer-slice';
import type { NodePanelProps } from '@/types/node-definition';

const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay',
  'darken', 'lighten', 'soft-light', 'hard-light',
];

export function BlendPanel({ node }: NodePanelProps) {
  const layer = useEditorStore((s) =>
    node.data.layerId ? s.layers.find((l) => l.id === node.data.layerId) : undefined,
  );
  const updateLayer = useEditorStore((s) => s.updateLayer);

  const blendMode = layer?.blendMode ?? 'normal';
  const opacity = layer?.opacity ?? 1;
  const opacityPct = Math.round(opacity * 100);

  const handleBlendModeChange = useCallback((mode: BlendMode) => {
    if (node.data.layerId) updateLayer(node.data.layerId, { blendMode: mode });
  }, [node.data.layerId, updateLayer]);

  const handleOpacityChange = useCallback((value: number) => {
    if (node.data.layerId) updateLayer(node.data.layerId, { opacity: value / 100 });
  }, [node.data.layerId, updateLayer]);

  return (
    <div className="p-3 flex flex-col gap-3">
      {/* Blend mode */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-text-secondary font-medium">Blend Mode</span>
        <div className="flex flex-wrap gap-0.5">
          {BLEND_MODES.map((mode) => (
            <button
              key={mode}
              onClick={() => handleBlendModeChange(mode)}
              className={`px-1.5 py-0.5 text-[10px] rounded-[var(--radius-button)] capitalize transition-colors cursor-default
                ${mode === blendMode
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary/60'
                }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Opacity */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-secondary font-medium">Opacity</span>
          <span className="text-[10px] text-text-primary tabular-nums">{opacityPct}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={opacityPct}
          onChange={(e) => handleOpacityChange(parseInt(e.target.value, 10))}
          className="w-full h-1 accent-accent cursor-default"
        />
      </div>
    </div>
  );
}
