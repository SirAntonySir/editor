import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Plus } from 'lucide-react';
import { bandDisplayColor, type HslBand } from './hsl-bands';

interface HslAddBandControlProps {
  /** Bands not currently shown — the colours the user can add. */
  bands: readonly HslBand[];
  onAdd: (band: string) => void;
}

/**
 * Add-colour affordance — reveals another HSL band's Hue/Sat/Lum on the widget.
 * Rendered as an "empty" swatch (same square footprint as the band swatches in
 * the rail) with a plus in it; clicking lists the bands not yet shown, each as
 * its own colour swatch. Renders nothing once every band is shown.
 */
export function HslAddBandControl({ bands, onAdd }: HslAddBandControlProps) {
  if (bands.length === 0) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Add colour"
        className="relative aspect-square rounded-sm flex items-center justify-center border border-dashed border-border-strong text-text-secondary transition-colors hover:text-text-primary hover:border-text-secondary"
      >
        <Plus size={12} aria-hidden />
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
