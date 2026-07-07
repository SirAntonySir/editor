import * as ContextMenu from '@radix-ui/react-context-menu';
import { Handle, Position } from '@xyflow/react';
import {
  Eye, EyeOff, Pencil, Blend, PanelRight, BoxSelect,
  SquareDashed, Sparkles, Copy, CopyPlus, Merge, Trash2, ChevronRight,
} from 'lucide-react';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { editorDocument } from '@/core/document';
import { LayerThumb } from '@/components/ui/LayerThumb';
import { createSelectionFromLayer } from '@/lib/segmentation/object-actions';
import { spawnGenfillFromLayer } from '@/lib/genfill-spawn';
import { duplicateLayerInPlace, duplicateLayerToNewImageNode } from '@/lib/layer-node-actions';

const MENU_ITEM = 'flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none';
// Destructive items: red text + red-tinted hover, so a delete reads as a delete.
const MENU_ITEM_DANGER =
  'flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-[3px] cursor-pointer outline-none text-[var(--color-danger,#e5484d)] ' +
  'hover:bg-[color-mix(in_srgb,var(--color-danger,#e5484d)_12%,transparent)]';
// Muted leading icon shared by every menu row (Delete inherits the red text).
const MENU_ICON = 'shrink-0 text-text-secondary';
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
  const setActiveImageNode = useEditorStore((s) => s.setActiveImageNode);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);

  // Selecting a layer from the standalone node also focuses its image node, so
  // toolrail gating (which needs `activeImageNodeId`) lights up — this used to
  // be implicit when the strip lived inside the active image node.
  function selectLayer(layerId: string) {
    setActiveImageNode(imageNodeId);
    setActiveLayer(layerId);
  }

  // Resolve ids → layer records, dropping any orphan id (defensive — should
  // not happen, but a missing layer would crash the map below).
  const layers: Layer[] = [];
  for (const id of layerIds) {
    const layer = allLayers.find((l) => l.id === id);
    if (layer) layers.push(layer);
  }
  if (layers.length === 0) return null;

  // Visible-layer count gates the node-level "Merge visible layers" action.
  const visibleCount = layers.filter((l) => l.visible).length;

  return (
    // Standalone node card. Flat `.overlay` register (the strip no longer floats
    // over photo content, so the frosted-glass exception no longer applies). The
    // whole card is the drag handle; per-row buttons stopPropagation on
    // pointer-down so they stay clickable. No overflow-hidden: the per-layer
    // tether ports sit ON the card's left border and the hover name labels
    // float outside the box.
    <div
      data-testid="layer-strip"
      // Horizontal padding lives on each ROW (below), NOT the card — that keeps
      // the card's content box flush with its border, so the per-layer tether
      // handle (positioned relative to the row's border box) straddles the
      // node's outer edge like the widget/info outlets instead of tucking inside
      // the padding. Only vertical padding + row gap here.
      className="workspace-drag-handle overlay rounded-[var(--radius-panel)] py-2 flex flex-col-reverse items-stretch gap-1.5"
    >
        {layers.map((layer, i) => {
        const ordinal = (i + 1).toString().padStart(2, '0');
        const isVisible = layer.visible;
        const isActive = layer.id === activeLayerId;
        return (
          <ContextMenu.Root key={layer.id}>
            <ContextMenu.Trigger asChild>
              <div className={`group relative flex items-center justify-end gap-1.5 pl-4 pr-2.5 ${isVisible ? '' : 'opacity-50'}`}>
                {/* Per-layer tether port — the ONLY connection surface for
                    widget tethers. Latent (see .layer-tether-port in index.css):
                    invisible at rest, fades in on row hover / while connecting.
                    The eye toggle beside it is unchanged (placement A). */}
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`layer-tether-${layer.id}`}
                  className="layer-tether-port"
                  aria-label={`Connect a widget to layer ${ordinal}`}
                />
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
                  onClick={(e) => { e.stopPropagation(); selectLayer(layer.id); }}
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
                  {isVisible ? <EyeOff size={13} className={MENU_ICON} aria-hidden /> : <Eye size={13} className={MENU_ICON} aria-hidden />}
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
                  <Pencil size={13} className={MENU_ICON} aria-hidden />
                  Rename
                </ContextMenu.Item>
                <ContextMenu.Sub>
                  <ContextMenu.SubTrigger className={MENU_ITEM}>
                    <Blend size={13} className={MENU_ICON} aria-hidden />
                    Change blend mode
                    <ChevronRight size={13} className="ml-auto text-text-secondary" aria-hidden />
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
                  onSelect={() => usePreferencesStore.getState().showLayer()}
                >
                  <PanelRight size={13} className={MENU_ICON} aria-hidden />
                  Open layer panel
                </ContextMenu.Item>
                <ContextMenu.Separator className="my-1 h-px bg-separator" />
                <ContextMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => createSelectionFromLayer(layer.id, imageNodeId)}
                >
                  <BoxSelect size={13} className={MENU_ICON} aria-hidden />
                  Create selection
                </ContextMenu.Item>
                <ContextMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => createSelectionFromLayer(layer.id, imageNodeId, { invert: true })}
                >
                  <SquareDashed size={13} className={MENU_ICON} aria-hidden />
                  Create inverted selection
                </ContextMenu.Item>
                <ContextMenu.Item
                  className={MENU_ITEM}
                  onSelect={() => void spawnGenfillFromLayer(layer.id, imageNodeId)}
                >
                  <Sparkles size={13} className={MENU_ICON} aria-hidden />
                  Generative fill…
                </ContextMenu.Item>
                {/* Non-destructive Duplicate (whole layer). Both keep the
                    source: a sibling sheet in this node, or a copy on its own
                    new image node. */}
                <ContextMenu.Item
                  className={MENU_ITEM}
                  onSelect={() =>
                    editorDocument.workspace.batch('Duplicate layer', () =>
                      duplicateLayerInPlace(layer.id, imageNodeId),
                    )
                  }
                >
                  <Copy size={13} className={MENU_ICON} aria-hidden />
                  Duplicate layer
                </ContextMenu.Item>
                <ContextMenu.Item
                  className={MENU_ITEM}
                  onSelect={() =>
                    editorDocument.workspace.batch('Duplicate to image node', () =>
                      duplicateLayerToNewImageNode(layer.id, imageNodeId),
                    )
                  }
                >
                  <CopyPlus size={13} className={MENU_ICON} aria-hidden />
                  Duplicate to image node
                </ContextMenu.Item>
                {/* Node-level action: flatten all visible layers into one
                    raster. Only meaningful with ≥2 visible layers. */}
                {visibleCount >= 2 && (
                  <ContextMenu.Item
                    className={MENU_ITEM}
                    onSelect={() => editorDocument.workspace.mergeVisibleLayers(imageNodeId)}
                  >
                    <Merge size={13} className={MENU_ICON} aria-hidden />
                    Merge visible layers
                  </ContextMenu.Item>
                )}
                <ContextMenu.Separator className="my-1 h-px bg-separator" />
                <ContextMenu.Item
                  className={MENU_ITEM_DANGER}
                  onSelect={() => editorDocument.workspace.removeLayer(layer.id)}
                >
                  <Trash2 size={13} className="shrink-0" aria-hidden />
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
