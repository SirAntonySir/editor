import { useState, useEffect } from 'react';
import { Eye, EyeOff, Lock, LockOpen, Pencil, Trash2, ChevronDown } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';
import { AdjustmentSlider } from '@/components/ui/AdjustmentSlider';
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
        'flex flex-col gap-1 px-2 py-1.5 border-b border-separator cursor-pointer',
        isActive
          ? 'border-l-2 border-l-[var(--color-accent)] text-text-primary'
          : 'border-l-2 border-l-transparent text-text-secondary hover:bg-surface-secondary',
      ].join(' ')}
      onClick={() => setActiveLayer(layer.id)}
    >
      <div className="flex items-center justify-between gap-1.5">
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
            className="flex-1 bg-transparent border-b border-separator outline-none text-[11px]"
            aria-label={`Rename ${layer.name}`}
          />
        ) : (
          <span className="text-[11px] truncate flex-1">{layer.name}</span>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setRenaming(true); }}
          aria-label={`Rename ${layer.name}`}
          className="text-text-secondary hover:text-[var(--color-accent)]"
        >
          <Pencil size={11} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
          aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
          className="text-text-secondary hover:text-[var(--color-accent)]"
        >
          {layer.visible ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { locked: !layer.locked }); }}
          aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
          className={layer.locked ? 'text-[var(--color-accent)]' : 'text-text-secondary hover:text-[var(--color-accent)]'}
        >
          {layer.locked ? <Lock size={11} /> : <LockOpen size={11} />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); editorDocument.workspace.removeLayer(layer.id); }}
          aria-label={`Delete ${layer.name}`}
          className="text-text-secondary hover:text-[var(--color-danger,#e5484d)]"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Opacity — AdjustmentSlider primitive handles label, readout, and Radix track */}
      <div onClick={(e) => e.stopPropagation()}>
        <AdjustmentSlider
          label="Opacity"
          value={Math.round(layer.opacity * 100)}
          min={0}
          max={100}
          onChange={(v) => updateLayer(layer.id, { opacity: v / 100 })}
          formatValue={(v) => `${v}%`}
        />
      </div>

      {/* Blend mode — Radix DropdownMenu mirroring LayerProperties.tsx */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-text-secondary shrink-0">Blend</span>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-between flex-1 px-1.5 py-0.5 text-[11px]
                bg-surface-secondary rounded-sm border border-separator
                hover:bg-separator transition-colors text-text-primary capitalize"
              aria-label={`Blend mode for ${layer.name}`}
            >
              {layer.blendMode.replace('-', ' ')}
              <ChevronDown size={10} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="overlay p-1 min-w-[140px] z-50"
              sideOffset={4}
            >
              {BLEND_MODES.map((mode) => (
                <DropdownMenu.Item
                  key={mode}
                  className={`px-2 py-1 text-[11px] rounded-sm cursor-pointer outline-none capitalize
                    ${layer.blendMode === mode
                      ? 'bg-accent text-white'
                      : 'text-text-primary hover:bg-surface-secondary'
                    }`}
                  onSelect={() => updateLayer(layer.id, { blendMode: mode })}
                >
                  {mode.replace('-', ' ')}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}
