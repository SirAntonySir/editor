import { useState, useEffect } from 'react';
import { Eye, EyeOff, Lock, LockOpen, Pencil, ChevronDown } from 'lucide-react';
import { useEditorStore } from '@/store';
import type { Layer, BlendMode } from '@/store/layer-slice';

const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'hard-light',
];

export function LayerRow({ layer, isActive }: { layer: Layer; isActive: boolean }) {
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const renamingLayerId = useEditorStore((s) => s.renamingLayerId);
  const clearRenameRequest = useEditorStore((s) => s.clearRenameRequest);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(layer.name);

  useEffect(() => {
    if (renamingLayerId === layer.id) {
      setRenaming(true);
      setDraftName(layer.name);
      clearRenameRequest();
    }
  }, [renamingLayerId, layer.id, layer.name, clearRenameRequest]);

  return (
    <div
      className={[
        'flex flex-col gap-2 px-3 py-2 border-b border-separator cursor-pointer',
        isActive
          ? 'border-l-2 border-l-[var(--color-accent)] text-text-primary'
          : 'border-l-2 border-l-transparent text-text-secondary hover:bg-surface-secondary',
      ].join(' ')}
      onClick={() => setActiveLayer(layer.id)}
    >
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => {
              updateLayer(layer.id, { name: draftName.trim() || layer.name });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') { setDraftName(layer.name); setRenaming(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent border-b border-separator outline-none font-display italic text-[15px] tracking-[-0.01em]"
            aria-label={`Rename ${layer.name}`}
          />
        ) : (
          <span className="font-display italic text-[15px] tracking-[-0.01em] truncate flex-1">{layer.name}</span>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setRenaming(true); }}
          aria-label={`Rename ${layer.name}`}
          className="text-text-secondary hover:text-[var(--color-accent)]"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
          aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
          className="text-text-secondary hover:text-[var(--color-accent)]"
        >
          {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { locked: !layer.locked }); }}
          aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
          className={layer.locked ? 'text-[var(--color-accent)]' : 'text-text-secondary hover:text-[var(--color-accent)]'}
        >
          {layer.locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[9px] uppercase tracking-[0.18em] text-text-secondary font-mono min-w-[64px]">Opacity</label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(layer.opacity * 100)}
          onChange={(e) => updateLayer(layer.id, { opacity: Number(e.target.value) / 100 })}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Opacity for ${layer.name}`}
          className="flex-1 appearance-none h-1 rounded-none bg-separator accent-[var(--color-accent)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-[10px] [&::-webkit-slider-thumb]:w-[10px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-accent)] [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-separator [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:h-[10px] [&::-moz-range-thumb]:w-[10px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--color-accent)] [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-separator"
        />
        <span className="text-[10px] tabular-nums w-8 text-right font-mono">{Math.round(layer.opacity * 100)}%</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[9px] uppercase tracking-[0.18em] text-text-secondary font-mono min-w-[64px]">Blend</label>
        <div className="relative flex-1">
          <select
            value={layer.blendMode}
            onChange={(e) => updateLayer(layer.id, { blendMode: e.target.value as BlendMode })}
            onClick={(e) => e.stopPropagation()}
            className="appearance-none w-full bg-transparent text-[13px] border-b border-separator outline-none capitalize cursor-pointer hover:border-text-secondary py-0.5 pr-5"
            aria-label={`Blend mode for ${layer.name}`}
          >
            {BLEND_MODES.map((m) => (
              <option key={m} value={m} className="capitalize">
                {m.replace('-', ' ')}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-0 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
        </div>
      </div>
    </div>
  );
}
