import * as ContextMenu from '@radix-ui/react-context-menu';
import { useEditorStore } from '@/store';
import type { Layer } from '@/store/layer-slice';
import type { BlendMode } from '@/store/layer-slice';

interface LayerStripProps {
  /** Layer ids hosted by this image-node, in newest-first canvas order
   *  (matches the existing `data.layerIds`). */
  layerIds: string[];
}

/**
 * Tracing-paper column of skewed rectangles in the left margin, one per
 * layer. Visible layers' sheets are filled in ochre; hidden layers are
 * hairline-outlined. Click toggles `layer.visible`. Hover/focus reveals the
 * layer's name in italic Fraunces alongside the sheet — keeping the
 * column visually quiet at rest.
 *
 * The strip handles the "I want to quickly show/hide a layer" use case. The
 * Inspector Layer tab is the detail view for opacity / blend mode / rename.
 */
const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay',
  'darken', 'lighten', 'soft-light', 'hard-light',
];

export function LayerStrip({ layerIds }: LayerStripProps) {
  const allLayers = useEditorStore((s) => s.layers);
  const updateLayer = useEditorStore((s) => s.updateLayer);

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
        const isVisible = layer.visible;
        return (
          <ContextMenu.Root key={layer.id}>
            <ContextMenu.Trigger asChild>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
                onPointerDownCapture={(e) => e.stopPropagation()}
                className="group flex items-center gap-2 cursor-pointer outline-none"
                data-visible={isVisible ? '' : undefined}
                aria-pressed={isVisible}
                aria-label={`Layer ${ordinal} · ${layer.name ?? 'Layer'}`}
                // Layer name surfaces only via native tooltip on hover. The
                // earlier inline label competed with the marginalia typography
                // even on the visible row.
                title={layer.name ?? `Layer ${ordinal}`}
              >
                <span
                  className={`font-[var(--font-display,Fraunces)] italic text-[14px] w-[18px] text-right tabular-nums ${
                    isVisible ? 'text-[var(--color-accent)] font-medium' : 'text-text-secondary'
                  }`}
                >
                  {ordinal}
                </span>
                <span
                  aria-hidden
                  className={`block w-[40px] h-[26px] border transition-colors ${
                    isVisible
                      ? 'bg-[var(--color-accent)] border-[var(--color-accent)]'
                      : 'bg-transparent border-text-primary group-hover:border-text-primary'
                  }`}
                  style={{ transform: 'skewX(-4deg)' }}
                />
              </button>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="overlay p-1 min-w-[180px] z-50">
                <ContextMenu.Item
                  className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
                  onSelect={() => useEditorStore.getState().setActiveLayer(layer.id)}
                >
                  Rename
                </ContextMenu.Item>
                <ContextMenu.Sub>
                  <ContextMenu.SubTrigger className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none">
                    Blend mode
                  </ContextMenu.SubTrigger>
                  <ContextMenu.Portal>
                    <ContextMenu.SubContent className="overlay p-1 min-w-[180px] z-50">
                      {BLEND_MODES.map((mode) => (
                        <ContextMenu.Item
                          key={mode}
                          className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
                          onSelect={() => updateLayer(layer.id, { blendMode: mode })}
                        >
                          {mode}
                        </ContextMenu.Item>
                      ))}
                    </ContextMenu.SubContent>
                  </ContextMenu.Portal>
                </ContextMenu.Sub>
                <ContextMenu.Item
                  className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
                  onSelect={() => updateLayer(layer.id, { locked: !layer.locked })}
                >
                  {layer.locked ? 'Unlock' : 'Lock'}
                </ContextMenu.Item>
                <ContextMenu.Separator className="my-1 h-px bg-separator" />
                <ContextMenu.Item
                  className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none text-text-secondary"
                  onSelect={() => useEditorStore.getState().removeLayer(layer.id)}
                >
                  Delete
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        );
      })}
    </div>
  );
}
