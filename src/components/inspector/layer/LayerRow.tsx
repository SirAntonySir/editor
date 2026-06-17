import { useState } from 'react';
import { Eye, EyeOff, Lock, LockOpen, Pencil } from 'lucide-react';
import { useEditorStore } from '@/store';
import type { Layer, BlendMode } from '@/store/layer-slice';

const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'hard-light',
];

export function LayerRow({ layer, isActive }: { layer: Layer; isActive: boolean }) {
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(layer.name);

  return (
    <div
      className={[
        'flex flex-col gap-2 px-3 py-2 border-b border-separator cursor-pointer',
        isActive ? 'bg-accent/10 text-text-primary' : 'text-text-secondary hover:bg-surface-secondary',
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
            className="flex-1 bg-transparent border-b border-separator text-sm outline-none"
            aria-label={`Rename ${layer.name}`}
          />
        ) : (
          <span className="text-sm truncate flex-1">{layer.name}</span>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setRenaming(true); }}
          aria-label={`Rename ${layer.name}`}
          className="text-text-secondary hover:text-text-primary"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
          aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
          className="text-text-secondary hover:text-text-primary"
        >
          {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { locked: !layer.locked }); }}
          aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
          className="text-text-secondary hover:text-text-primary"
        >
          {layer.locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-[0.18em] text-text-secondary">Opacity</label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(layer.opacity * 100)}
          onChange={(e) => updateLayer(layer.id, { opacity: Number(e.target.value) / 100 })}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Opacity for ${layer.name}`}
          className="flex-1"
        />
        <span className="text-[10px] tabular-nums w-8 text-right">{Math.round(layer.opacity * 100)}%</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-[0.18em] text-text-secondary">Blend</label>
        <select
          value={layer.blendMode}
          onChange={(e) => updateLayer(layer.id, { blendMode: e.target.value as BlendMode })}
          onClick={(e) => e.stopPropagation()}
          className="bg-transparent text-sm border-b border-separator outline-none flex-1 capitalize"
          aria-label={`Blend mode for ${layer.name}`}
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m} className="capitalize">
              {m.replace('-', ' ')}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
