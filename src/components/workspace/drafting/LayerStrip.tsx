import { useEditorStore } from '@/store';
import type { Layer } from '@/store/layer-slice';

interface LayerStripProps {
  /** Layer ids hosted by this image-node, in newest-first canvas order
   *  (matches the existing `data.layerIds`). */
  layerIds: string[];
}

/**
 * Tracing-paper column of skewed rectangles in the left margin, one per
 * layer. The active layer's sheet is filled in ochre; inactive sheets are
 * hairline-outlined. Click sets `activeLayerId`. Hover/focus reveals the
 * layer's name in italic Fraunces alongside the sheet — keeping the
 * column visually quiet at rest.
 *
 * The strip handles the "I want a quick layer pick" use case. The sidebar
 * LayersPanel stays as the detail view for opacity / blend mode / rename.
 */
export function LayerStrip({ layerIds }: LayerStripProps) {
  const allLayers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);

  // Resolve ids → layer records, dropping any orphan id (defensive — should
  // not happen, but a missing layer would crash the map below).
  const layers: Layer[] = [];
  for (const id of layerIds) {
    const layer = allLayers.find((l) => l.id === id);
    if (layer) layers.push(layer);
  }
  if (layers.length === 0) return null;

  return (
    <div
      data-testid="layer-strip"
      className="flex flex-col-reverse items-end gap-1.5 pr-3"
    >
      <div className="font-[var(--font-mono)] text-[9px] tracking-[0.20em] uppercase text-text-secondary mb-1">
        Layers
      </div>
      {layers.map((layer, i) => {
        const ordinal = (i + 1).toString().padStart(2, '0');
        const isActive = layer.id === activeLayerId;
        return (
          <button
            key={layer.id}
            type="button"
            onClick={(e) => { e.stopPropagation(); setActiveLayer(layer.id); }}
            onPointerDownCapture={(e) => e.stopPropagation()}
            className="group flex items-center gap-2 cursor-pointer outline-none"
            data-active={isActive ? '' : undefined}
            aria-pressed={isActive}
            aria-label={`Layer ${ordinal} · ${layer.name ?? 'Layer'}`}
            // Layer name surfaces only via native tooltip on hover. The
            // earlier inline label competed with the marginalia typography
            // even on the active row.
            title={layer.name ?? `Layer ${ordinal}`}
          >
            <span
              className={`font-[var(--font-display,Fraunces)] italic text-[14px] w-[18px] text-right tabular-nums ${
                isActive ? 'text-[var(--color-accent)] font-medium' : 'text-text-secondary'
              }`}
            >
              {ordinal}
            </span>
            <span
              aria-hidden
              className={`block w-[40px] h-[26px] border transition-colors ${
                isActive
                  ? 'bg-[var(--color-accent)] border-[var(--color-accent)]'
                  : 'bg-transparent border-text-primary group-hover:border-text-primary'
              }`}
              style={{ transform: 'skewX(-4deg)' }}
            />
          </button>
        );
      })}
    </div>
  );
}
