import { useEditorStore } from '@/store';
import { AdjustmentSlider } from './AdjustmentSlider';
import type { BlendMode } from '@/types/adjustment';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';

const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'hard-light',
];

export function LayerProperties() {
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const layer = useEditorStore((s) =>
    s.layers.find((l) => l.id === s.activeLayerId),
  );
  const updateLayer = useEditorStore((s) => s.updateLayer);

  if (!activeLayerId || !layer) {
    return (
      <div className="px-3 py-2 text-xs text-text-secondary">
        No layer selected
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 text-xs font-medium text-text-secondary border-b border-separator">
        Layer
      </div>
      <div className="p-3 flex flex-col gap-3">
        <div className="text-xs text-text-primary truncate">{layer.name}</div>

        <AdjustmentSlider
          label="Opacity"
          value={Math.round(layer.opacity * 100)}
          min={0}
          max={100}
          onChange={(v) => updateLayer(activeLayerId, { opacity: v / 100 })}
          formatValue={(v) => `${v}%`}
        />

        <div className="flex flex-col gap-1">
          <span className="text-xs text-text-secondary">Blend Mode</span>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="flex items-center justify-between w-full px-2 py-1 text-xs
                bg-surface-secondary rounded-sm border border-separator
                hover:bg-separator transition-colors text-text-primary capitalize">
                {layer.blendMode.replace('-', ' ')}
                <ChevronDown size={12} />
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
                    className={`px-2 py-1 text-xs rounded-sm cursor-pointer outline-none capitalize
                      ${layer.blendMode === mode
                        ? 'bg-accent text-white'
                        : 'text-text-primary hover:bg-surface-secondary'
                      }`}
                    onSelect={() => updateLayer(activeLayerId, { blendMode: mode })}
                  >
                    {mode.replace('-', ' ')}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </div>
  );
}
