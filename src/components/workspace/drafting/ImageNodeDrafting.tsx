import { useState, useMemo } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Handle, Position } from '@xyflow/react';
import { useEditorStore } from '@/store';
import { useImageNodeObjects } from '@/hooks/useImageNodeObjects';
import { ImageNodeBody } from '../ImageNodeBody';
import { ImageNodeResizeHandle } from '../ImageNodeResizeHandle';
import { SegmentHitLayer } from '../SegmentHitLayer';
import { ImageNodeObjectsLayer } from '../ImageNodeObjectsLayer';
import { CornerTicks } from './CornerTicks';
import { TopMarginalia } from './TopMarginalia';
import { BottomMarginalia } from './BottomMarginalia';
import { LayerStrip } from './LayerStrip';

interface ImageNodeDraftingProps {
  id: string;
  data: {
    name?: string;
    layerIds: string[];
    size: { w: number; h: number };
    sourceSize: { w: number; h: number };
  };
  selected: boolean;
}

const LEFT_MARGIN = 120;
const RIGHT_MARGIN = 120;

/**
 * Phase 2 — Drafting variant of the image node. Lays out the four
 * marginalia regions around the image canvas:
 *
 *     ┌── TopMarginalia ───────────────────────────────────┐
 *     │ LayerStrip │ image body │ (object markers, Phase 3) │
 *     │            │            │                           │
 *     │            │            │                           │
 *     └─────────── BottomMarginalia (under image) ──────────┘
 *
 * The image body retains everything from the classic surface: the
 * existing WebGL composite, ContextMenu, SegmentHitLayer, and the
 * objects overlay. Only the chrome moves out into the margins.
 *
 * The corner ticks fade into a full hairline frame on `selected` via a
 * 200ms transition. React Flow's draggable region is `.workspace-drag-handle`
 * placed on the TopMarginalia outer container so dragging the title row
 * moves the node — the body itself stays click-clean for segmentation.
 */
export function ImageNodeDrafting({ id, data, selected }: ImageNodeDraftingProps) {
  const [compareHeld, setCompareHeld] = useState(false);

  // Display dimensions — display width set on the workspace state, height
  // derived from source aspect.
  const aspect = data.sourceSize.w / data.sourceSize.h;
  const displayW = data.size.w;
  const displayH = displayW / aspect;

  // Layer + meta for the marginalia. Resolved against the active layer
  // and document meta in one selector each so updates only re-render
  // this node.
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const documentMeta = useEditorStore((s) => s.documentMeta);
  const objects = useImageNodeObjects(id);

  const activeLayerName = useMemo(() => {
    const active = layers.find((l) => l.id === activeLayerId);
    return active?.name ?? 'Source';
  }, [layers, activeLayerId]);

  const mime = documentMeta?.mimeType ?? '';
  const formatLabel = mime.startsWith('image/')
    ? mime.slice('image/'.length).toUpperCase()
    : 'IMG';

  const fileSize = documentMeta?.fileSize ? formatBytes(documentMeta.fileSize) : null;

  // Stub menu items — full menu items move out of ImageNode.tsx into a
  // shared module in a follow-up. Drafting Phase 2 keeps the essentials.
  const renderMenuItems = (Item: typeof DropdownMenu.Item | typeof ContextMenu.Item) => (
    <>
      <Item
        className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
        onSelect={() => { /* TODO: rotate CW */ }}
      >
        Rotate 90° CW
      </Item>
      <Item
        className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
        onSelect={() => { /* TODO: rotate CCW */ }}
      >
        Rotate 90° CCW
      </Item>
    </>
  );

  return (
    <div
      className="relative"
      style={{
        paddingLeft: `${LEFT_MARGIN}px`,
        paddingRight: `${RIGHT_MARGIN}px`,
        paddingTop: '64px',
        paddingBottom: '32px',
      }}
    >
      {/* TopMarginalia spans the full composition width and includes the
          drag handle so React Flow drags fire from the title row. */}
      <div
        className="workspace-drag-handle cursor-grab active:cursor-grabbing"
        style={{ marginLeft: 0, marginRight: 0 }}
      >
        <TopMarginalia
          title={data.name ?? 'Image'}
          activeLayerName={activeLayerName}
          formatLabel={formatLabel}
          rhsLines={fileSize ? [fileSize] : []}
          onCompareDown={() => setCompareHeld(true)}
          onCompareUp={() => setCompareHeld(false)}
          renderMenuItems={renderMenuItems as (Item: typeof DropdownMenu.Item) => React.ReactNode}
        />
      </div>

      {/* Body row: left layer strip · image canvas · (object markers slot, Phase 3) */}
      <div className="flex items-start gap-0">
        <div
          className="shrink-0"
          style={{ width: `${LEFT_MARGIN}px`, marginLeft: `-${LEFT_MARGIN}px` }}
        >
          <LayerStrip layerIds={data.layerIds} />
        </div>

        {/* Image body. Sits inside a wrapper that hosts both the corner
            ticks (visible at rest) and a sibling .frame (fades in on
            selected). */}
        <div
          className="relative"
          style={{ width: `${displayW}px`, height: `${displayH}px` }}
        >
          <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <div className="relative w-full h-full">
                <ImageNodeBody
                  imageNodeId={id}
                  layerIds={data.layerIds}
                  sourceWidth={data.sourceSize.w}
                  sourceHeight={data.sourceSize.h}
                  displayWidth={displayW}
                  displayHeight={displayH}
                  bypassAdjustments={compareHeld}
                />
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="overlay p-1 min-w-[140px] z-50">
                {renderMenuItems(ContextMenu.Item)}
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>

          {/* Objects overlays. Stay on top of the body in the same
              z-order as classic so SAM hit-test continues to work. */}
          <ImageNodeObjectsLayer imageNodeId={id} widthPx={displayW} heightPx={displayH} />
          <SegmentHitLayer imageNodeId={id} widthPx={displayW} heightPx={displayH} />

          {/* Corner ticks at rest. */}
          {!selected && <CornerTicks />}

          {/* Frame fades in when selected. The transition is on `opacity`,
              not `border-width`, so the box doesn't shift. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 border border-[var(--color-accent)] transition-opacity duration-200"
            style={{ opacity: selected ? 1 : 0 }}
          />

          {selected && <ImageNodeResizeHandle imageNodeId={id} displayWidth={displayW} />}
        </div>

        {/* Right margin gutter. Object markers + leader lines land here in
            Phase 3. For Phase 2 it's an empty reserved column so the body
            is visually balanced inside the composition. */}
        <div
          className="shrink-0"
          style={{ width: `${RIGHT_MARGIN}px`, marginRight: `-${RIGHT_MARGIN}px` }}
        />
      </div>

      {/* BottomMarginalia sits under the body, aligned to its left edge. */}
      <div className="mt-2">
        <BottomMarginalia
          sourceWidth={Math.round(data.sourceSize.w)}
          sourceHeight={Math.round(data.sourceSize.h)}
          formatLabel={formatLabel}
          fileSize={fileSize}
          layerCount={data.layerIds.length}
          objectCount={objects.length}
        />
      </div>

      {/* Tether handles. Same positions as classic so existing tether edges
          continue to land on the right pixels. */}
      <Handle type="source" position={Position.Top}
        id="tether-out-top"    style={{ top: '64px', opacity: 0 }} />
      <Handle type="source" position={Position.Bottom}
        id="tether-out-bottom" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left}
        id="tether-out-left"   style={{ top: '64px', opacity: 0 }} />
      <Handle type="source" position={Position.Right}
        id="tether-out-right"  style={{ top: '64px', opacity: 0 }} />
      <Handle type="target" position={Position.Top}
        id="tether-in-top"     style={{ top: '64px', opacity: 0 }} />
      <Handle type="target" position={Position.Bottom}
        id="tether-in-bottom"  style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left}
        id="tether-in-left"    style={{ top: '64px', opacity: 0 }} />
      <Handle type="target" position={Position.Right}
        id="tether-in-right"   style={{ top: '64px', opacity: 0 }} />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
