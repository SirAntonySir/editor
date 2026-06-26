import { createPortal } from 'react-dom';
import { MapPin } from 'lucide-react';
import type { SuggestRegion } from '@/lib/region-suggest';

export interface RegionSuggestionsProps {
  /** Ranked regions to offer. Empty → the dropdown renders nothing. */
  regions: SuggestRegion[];
  /** Index of the keyboard-highlighted row. */
  activeIndex: number;
  /** Caret rect the dropdown anchors under (null → anchored at origin). */
  anchorRect: DOMRect | null;
  onSelect(region: SuggestRegion): void;
  onHover(index: number): void;
}

/** Caret-anchored region picker. Fixed-positioned just below the caret so it
 *  floats over the palette chrome. Mouse-down (not click) drives selection so
 *  the editor never loses focus mid-pick. */
export function RegionSuggestions({
  regions,
  activeIndex,
  anchorRect,
  onSelect,
  onHover,
}: RegionSuggestionsProps) {
  if (regions.length === 0) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: anchorRect ? anchorRect.left : 0,
    top: anchorRect ? anchorRect.bottom + 4 : 0,
    zIndex: 60,
  };

  // Portal to <body>: the palette is a transformed (framer-motion) container,
  // which would otherwise become the containing block for this `fixed` element
  // and offset it off-screen. Rendering at the body root makes `fixed` resolve
  // against the viewport, matching the caret's getBoundingClientRect coords.
  return createPortal(
    <div
      role="listbox"
      aria-label="Region suggestions"
      style={style}
      className="overlay min-w-[10rem] max-w-[18rem] py-1 text-xs shadow-md"
    >
      {regions.map((r, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={r.sourceId}
            type="button"
            role="option"
            aria-selected={active}
            data-active={active ? 'true' : 'false'}
            // mouseDown fires before the editor's blur, preserving the caret.
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(r);
            }}
            onMouseEnter={() => onHover(i)}
            className={`flex w-full items-center gap-2 px-2 py-1 text-left transition-colors ${
              active ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'
            }`}
          >
            <MapPin size={12} className="flex-none text-[var(--color-ai)]" />
            <span className="truncate text-text-primary">{r.label}</span>
            <span className="ml-auto flex-none text-[9px] uppercase tracking-wide text-text-secondary">
              Region
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
