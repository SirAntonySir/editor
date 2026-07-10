import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Plus } from 'lucide-react';
import { bandDisplayColor, type HslBand } from './hsl-bands';

interface HslAddBandControlProps {
  /** Bands not currently shown — the colours the user can add. */
  bands: readonly HslBand[];
  onAdd: (band: string) => void;
}

/**
 * "+ Add colour" — reveals another HSL band's Hue/Sat/Lum on the widget. Lists
 * only bands not already shown; renders nothing once every band is shown. Each
 * item carries the band's representative swatch so the picker reads visually.
 */
export function HslAddBandControl({ bands, onAdd }: HslAddBandControlProps) {
  if (bands.length === 0) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Add colour"
        className="flex items-center gap-1 self-start text-[10px] text-text-secondary hover:text-text-primary border border-border-strong rounded-[4px] px-2 py-0.5"
      >
        <Plus size={11} />
        <span>Add colour</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="overlay p-1 min-w-[140px] z-50" sideOffset={4}>
          {bands.map((b) => (
            <DropdownMenu.Item
              key={b.key}
              onSelect={() => onAdd(b.key)}
              className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary flex items-center gap-1.5"
            >
              <span
                aria-hidden
                className="w-2.5 h-2.5 rounded-sm"
                style={{
                  background: bandDisplayColor(b.centerHue),
                  boxShadow: 'inset 0 0 0 1px var(--color-separator)',
                }}
              />
              <span>{b.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
