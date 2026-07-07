import { createPortal } from 'react-dom';
import { MapPin, Image as ImageIcon, Layers } from 'lucide-react';
import type { PaletteElement } from '@/lib/region-suggest';

export interface RegionSuggestionsProps {
  /** Ranked elements to offer (regions + targets). Empty → renders nothing. */
  elements: PaletteElement[];
  /** Index of the keyboard-highlighted row. */
  activeIndex: number;
  /** Caret rect the dropdown anchors under (null → anchored at origin). */
  anchorRect: DOMRect | null;
  onSelect(element: PaletteElement): void;
  onHover(index: number): void;
}

/** Per-kind affordance: a region pin, an image-node target, or a layer target. */
function elementGlyph(el: PaletteElement): { Icon: typeof MapPin; tag: string } {
  if (el.kind === 'target') {
    return el.targetKind === 'layer'
      ? { Icon: Layers, tag: 'Layer' }
      : { Icon: ImageIcon, tag: 'Image' };
  }
  return { Icon: MapPin, tag: 'Region' };
}

/** Caret-anchored element picker (regions + targets). Fixed-positioned just
 *  below the caret so it floats over the palette chrome. Mouse-down (not click)
 *  drives selection so the editor never loses focus mid-pick. */
export function RegionSuggestions({
  elements,
  activeIndex,
  anchorRect,
  onSelect,
  onHover,
}: RegionSuggestionsProps) {
  if (elements.length === 0) return null;

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
      aria-label="Element suggestions"
      // Marker so the palette's Radix Dialog can recognise interactions with this
      // portalled-to-<body> dropdown as "inside" and not steal the mousedown
      // (dismiss / focus-trap) before the row's own onMouseDown → onSelect runs.
      data-atelier-suggest=""
      style={style}
      className="overlay overflow-hidden min-w-[10rem] max-w-[18rem] py-1 text-xs shadow-md"
    >
      {elements.map((el, i) => {
        const active = i === activeIndex;
        const { Icon, tag } = elementGlyph(el);
        return (
          <button
            key={el.sourceId}
            type="button"
            role="option"
            aria-selected={active}
            data-active={active ? 'true' : 'false'}
            // mouseDown fires before the editor's blur, preserving the caret.
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(el);
            }}
            onMouseEnter={() => onHover(i)}
            className={`flex w-full items-center gap-2 px-2 py-1 text-left transition-colors ${
              active ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'
            }`}
          >
            <Icon size={12} className="flex-none text-[var(--color-ai)]" />
            <span className="truncate text-text-primary">{el.label}</span>
            <span className="ml-auto flex-none text-[9px] uppercase tracking-wide text-text-secondary">
              {tag}
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
