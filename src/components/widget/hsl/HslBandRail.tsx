import type { ReactNode } from 'react';
import { HSL_BANDS, bandDisplayColor, type HslBand } from '@/components/widget/hsl/hsl-bands';

interface HslBandRailProps {
  activeBand: string;
  onSelect: (band: string) => void;
  /** Whether a band has any non-default param (drives the edited dot). */
  bandEdited: (band: string) => boolean;
  /**
   * Optional subset of bands to render. Defaults to all 8 bands. Filtered
   * widgets (e.g. complementary-grade with only orange + blue bindings)
   * shrink the rail to just those bands.
   */
  bands?: readonly HslBand[];
  /**
   * Optional trailing cell in the grid — the add-colour swatch. Sits in the
   * same 8-column grid so it matches the band swatches' size exactly.
   */
  addSlot?: ReactNode;
}

/** The colour band picker. Selects the active band and flags edited ones.
 *
 *  Sized in an 8-column grid regardless of how many bands are visible:
 *  a `flex-1` row would stretch each button to fill the available width,
 *  so a 2-band widget (e.g. complementary-grade with orange + blue) would
 *  render two giant swatches instead of two compact ones. Anchoring to the
 *  8-cell grid keeps each swatch the same size in every variant — fewer
 *  bands just leave trailing empty cells. */
export function HslBandRail({ activeBand, onSelect, bandEdited, bands, addSlot }: HslBandRailProps) {
  const visible = bands ?? HSL_BANDS;
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {visible.map((b) => {
        const active = b.key === activeBand;
        return (
          <button
            key={b.key}
            type="button"
            aria-label={`Select ${b.label}`}
            aria-pressed={active}
            onClick={() => onSelect(b.key)}
            className="relative aspect-square rounded-sm"
            style={{
              background: bandDisplayColor(b.centerHue),
              boxShadow: active
                ? '0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-accent)'
                : 'inset 0 0 0 1px var(--color-separator)',
            }}
          >
            {bandEdited(b.key) && (
              <span
                data-testid="hsl-edited-dot"
                className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-accent"
                style={{ boxShadow: '0 0 0 1.5px var(--color-surface)' }}
              />
            )}
          </button>
        );
      })}
      {addSlot}
    </div>
  );
}
