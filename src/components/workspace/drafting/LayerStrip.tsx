import * as ContextMenu from '@radix-ui/react-context-menu';
import { Eye, EyeOff } from 'lucide-react';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { editorDocument } from '@/core/document';
import { LayerThumb } from '@/components/ui/LayerThumb';
import { createSelectionFromLayer } from '@/lib/segmentation/object-actions';

const MENU_ITEM = 'text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none';
// Destructive items: red text + red-tinted hover, so a delete reads as a delete.
const MENU_ITEM_DANGER =
  'text-[12px] px-2 py-1.5 rounded-[3px] cursor-pointer outline-none text-[var(--color-danger,#e5484d)] ' +
  'hover:bg-[color-mix(in_srgb,var(--color-danger,#e5484d)_12%,transparent)]';
import type { Layer } from '@/store/layer-slice';
import type { BlendMode } from '@/store/layer-slice';

interface LayerStripProps {
  /** The image node these layers belong to — drives live thumbnails + the
   *  "create selection from layer" actions. */
  imageNodeId: string;
  /** Layer ids hosted by this image-node, in newest-first canvas order
   *  (matches the existing `data.layerIds`). */
  layerIds: string[];
}

/**
 * Column of layer thumbnails in the left margin, one per layer. Each shows the
 * layer's pixels (cover-cropped); the active EDIT layer (the one adjustments
 * target) carries an accent ring, hidden layers are dimmed. Clicking a thumb
 * selects it as active; a small eye button toggles visibility independently.
 * Hover/focus reveals the layer's name in italic Fraunces alongside the thumb —
 * keeping the column visually quiet at rest.
 *
 * The strip is the canvas-side control for "which layer am I editing" + quick
 * show/hide. The Inspector Layer tab is the detail view for opacity / blend
 * mode / rename.
 */
const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay',
  'darken', 'lighten', 'soft-light', 'hard-light',
];

export function LayerStrip({ imageNodeId, layerIds }: LayerStripProps) {
  const allLayers = useEditorStore((s) => s.layers);
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);

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
        const isActive = layer.id === activeLayerId;
        return (
          <ContextMenu.Root key={layer.id}>
            <ContextMenu.Trigger asChild>
              <div className={`group relative flex items-center gap-1.5 ${isVisible ? '' : 'opacity-50'}`}>
                {/* Hover/focus label — floats to the LEFT of the marker (the
                    strip sits in the left margin) so it never overlaps the
                    photo. Quiet at rest, revealed on hover. */}
                <span
                  className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap
                    px-1.5 py-0.5 rounded-[3px] text-[11px] italic font-[var(--font-display,Fraunces)]
                    bg-surface text-text-primary border border-separator shadow-sm
                    opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100
                    transition-opacity pointer-events-none"
                >
                  {layer.name ?? `Layer ${ordinal}`}
                </span>
                {/* Eye — toggles visibility independently of selection. */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
                  onPointerDownCapture={(e) => e.stopPropagation()}
                  className="text-text-secondary hover:text-text-primary outline-none"
                  aria-label={`${isVisible ? 'Hide' : 'Show'} layer ${ordinal}`}
                  aria-pressed={isVisible}
                >
                  {isVisible ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />}
                </button>
                {/* Sheet — selects the active EDIT layer. */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActiveLayer(layer.id); }}
                  onPointerDownCapture={(e) => e.stopPropagation()}
                  className="relative flex items-center gap-2 cursor-pointer outline-none"
                  data-active={isActive ? '' : undefined}
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={`Select layer ${ordinal} · ${layer.name ?? 'Layer'}`}
                >
                  <span
                    className={`font-[var(--font-display,Fraunces)] italic text-[14px] w-[18px] text-right tabular-nums ${
                      isActive ? 'text-[var(--color-accent)] font-medium' : 'text-text-secondary'
                    }`}
                  >
                    {ordinal}
                  </span>
                  {/* Layer thumbnail — live-updates from the node composite;
                      the active (edit-target) layer gets an accent ring. */}
                  <LayerThumb layerId={layer.id} active={isActive} imageNodeId={imageNodeId} />
                </button>
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="overlay p-1 min-w-[180px] z-50">
                <ContextMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => updateLayer(layer.id, { visible: !layer.visible })}
                >
                  {isVisible ? 'Hide' : 'Show'}
                </ContextMenu.Item>
                <ContextMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => {
                    const editor = useEditorStore.getState();
                    editor.setActiveLayer(layer.id);
                    editor.requestRenameLayer(layer.id);
                    usePreferencesStore.getState().showLayer();
                  }}
                >
                  Rename
                </ContextMenu.Item>
                <ContextMenu.Sub>
                  <ContextMenu.SubTrigger className={MENU_ITEM}>
                    Change blend mode
                  </ContextMenu.SubTrigger>
                  <ContextMenu.Portal>
                    <ContextMenu.SubContent className="overlay p-1 min-w-[180px] z-50">
                      {BLEND_MODES.map((mode) => (
                        <ContextMenu.Item
                          key={mode}
                          className={MENU_ITEM}
                          onSelect={() => updateLayer(layer.id, { blendMode: mode })}
                        >
                          {mode}
                        </ContextMenu.Item>
                      ))}
                    </ContextMenu.SubContent>
                  </ContextMenu.Portal>
                </ContextMenu.Sub>
                <ContextMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => updateLayer(layer.id, { locked: !layer.locked })}
                >
                  {layer.locked ? 'Unlock' : 'Lock'}
                </ContextMenu.Item>
                <ContextMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => usePreferencesStore.getState().showLayer()}
                >
                  Open layer panel
                </ContextMenu.Item>
                <ContextMenu.Separator className="my-1 h-px bg-separator" />
                <ContextMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => createSelectionFromLayer(layer.id, imageNodeId)}
                >
                  Create selection
                </ContextMenu.Item>
                <ContextMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => createSelectionFromLayer(layer.id, imageNodeId, { invert: true })}
                >
                  Create inverted selection
                </ContextMenu.Item>
                {/* Move (not copy) this layer onto its own image node. Only
                    meaningful when the node has other layers to leave behind. */}
                {layers.length >= 2 && (
                  <ContextMenu.Item
                    className={MENU_ITEM}
                    onSelect={() => editorDocument.workspace.splitImageNode(imageNodeId, layer.id)}
                  >
                    Move to own image node
                  </ContextMenu.Item>
                )}
                <ContextMenu.Separator className="my-1 h-px bg-separator" />
                <ContextMenu.Item
                  className={MENU_ITEM_DANGER}
                  onSelect={() => editorDocument.workspace.removeLayer(layer.id)}
                >
                  Delete layer
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        );
      })}
    </div>
  );
}
