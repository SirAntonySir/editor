import { HSL_BANDS, bandDisplayColor, type HslBand } from './hsl-bands';

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
}

/** The colour band picker. Selects the active band and flags edited ones. */
export function HslBandRail({ activeBand, onSelect, bandEdited, bands }: HslBandRailProps) {
  const visible = bands ?? HSL_BANDS;
  return (
    <div className="flex gap-1.5 justify-between">
      {visible.map((b) => {
        const active = b.key === activeBand;
        return (
          <button
            key={b.key}
            type="button"
            aria-label={`Select ${b.label}`}
            aria-pressed={active}
            onClick={() => onSelect(b.key)}
            className="relative flex-1 aspect-square rounded-sm"
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
    </div>
  );
}
