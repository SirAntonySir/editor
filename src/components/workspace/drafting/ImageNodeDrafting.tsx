import { useState, useMemo } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Handle, Position } from '@xyflow/react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { usePreferencesStore } from '@/store/preferences-store';
import { useImageNodeObjects } from '@/hooks/useImageNodeObjects';
import { backendTools } from '@/lib/backend-tools';
import { editorDocument } from '@/core/document';
import { toast } from '@/components/ui/Toast';
import {
  convertObjectToLayerMask,
  extractObjectToImageNode,
  deleteObject,
  startObjectRename,
} from '@/lib/segmentation/object-actions';
import { computeEffectiveSize, type Crop } from '@/lib/image-node-geometry';
import { ImageNodeBody } from '../ImageNodeBody';
import { ImageNodeResizeHandle } from '../ImageNodeResizeHandle';
import { SegmentHitLayer } from '../SegmentHitLayer';
import { ImageNodeObjectsLayer } from '../ImageNodeObjectsLayer';
import { CornerTicks } from './CornerTicks';
import { TopMarginalia } from './TopMarginalia';
import { BottomMarginalia } from './BottomMarginalia';
import { LayerStrip } from './LayerStrip';
import { ObjectMarkers } from './ObjectMarkers';

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
 * Drafting variant of the image node. The image body is centred; chrome
 * lives in the four surrounding margins:
 *
 *     ┌── TopMarginalia ─────────────────────────────┐
 *     │ LayerStrip │ IMAGE BODY │ (markers, Phase 3) │
 *     │            │            │                     │
 *     └─────────── BottomMarginalia (under image) ────┘
 *
 * Notable behaviours that diverge from the classic surface:
 *
 * - Objects mode is OFF by default. Toggle it via the ⋯ menu or the
 *   right-click ContextMenu. The classic auto-on heuristic ("if any
 *   objects exist, default to objects mode") is intentionally dropped
 *   here so segmentation overlays don't compete with the editorial
 *   typography unless the user asked for them.
 * - React Flow's connection Handles are anchored to the IMAGE BODY box,
 *   not the outer composition. Tether edges therefore touch the image
 *   rectangle, not the title row above it.
 */
export function ImageNodeDrafting({ id, data, selected }: ImageNodeDraftingProps) {
  const [compareHeld, setCompareHeld] = useState(false);

  // --- Effective rotate / crop (mirrors ImageNodeClassic) -----------------
  // The image-node display box needs to follow the WebGL pipeline's effective
  // source dimensions, not the raw uploaded ones. Rotate 90°/270° swaps W/H;
  // crop replaces them outright. Both surface as op_graph nodes
  // (transform:<id>:rotate / :crop) so we read them from useBackendState.
  // Live edits in the Crop tab arrive via useEditorStore.cropPreview.
  const snapshotRotateAngle = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find((n) => n.id === `transform:${id}:rotate`);
    if (!node) return null;
    return (node.params.angle as number) ?? null;
  });
  const snapshotCropX = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find((n) => n.id === `transform:${id}:crop`);
    if (!node) return null;
    const p = node.params as { x?: number; w?: number; h?: number };
    return p.w != null && p.h != null ? (p.x ?? 0) : null;
  });
  const snapshotCropY = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find((n) => n.id === `transform:${id}:crop`);
    if (!node) return null;
    const p = node.params as { y?: number; w?: number; h?: number };
    return p.w != null && p.h != null ? (p.y ?? 0) : null;
  });
  const snapshotCropW = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find((n) => n.id === `transform:${id}:crop`);
    if (!node) return null;
    return (node.params as { w?: number }).w ?? null;
  });
  const snapshotCropH = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find((n) => n.id === `transform:${id}:crop`);
    if (!node) return null;
    return (node.params as { h?: number }).h ?? null;
  });
  const snapshotCrop: Crop | null =
    snapshotCropW != null && snapshotCropH != null
      ? { x: snapshotCropX ?? 0, y: snapshotCropY ?? 0, w: snapshotCropW, h: snapshotCropH }
      : null;

  const inspectorTab = usePreferencesStore((s) => s.inspectorTab);
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const cropPreview = useEditorStore((s) => s.cropPreview);
  const previewActive = inspectorTab === 'crop' && activeImageNodeId === id;

  const effectiveRotateAngle =
    previewActive && cropPreview && cropPreview.rotate
      ? cropPreview.rotate.angle
      : snapshotRotateAngle;
  const effectiveCropRect: Crop | null =
    previewActive && cropPreview && cropPreview.crop
      ? cropPreview.crop
      : snapshotCrop;
  const effectiveSource = computeEffectiveSize(data.sourceSize, effectiveRotateAngle, effectiveCropRect);

  const aspect = effectiveSource.h > 0 ? effectiveSource.w / effectiveSource.h : 1;
  const displayW = data.size.w;
  const displayH = displayW / aspect;

  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const documentMeta = useEditorStore((s) => s.documentMeta);
  const imageNodeMode = useEditorStore((s) => s.imageNodeMode[id]);
  const setImageNodeMode = useEditorStore((s) => s.setImageNodeMode);
  const objects = useImageNodeObjects(id);
  const activeScope = useEditorStore((s) => s.activeScope);
  // The "selected object" reachable from the image-node menu: the active-
  // scope mask, but only when that mask belongs to one of THIS node's
  // objects (so the same context menu opening on a different node doesn't
  // see another node's selection).
  const selectedObject = useMemo(() => {
    if (activeScope.kind !== 'mask') return null;
    return objects.find((o) => o.id === activeScope.mask_id) ?? null;
  }, [activeScope, objects]);

  // Default is 'layers' — no auto-flip to objects when a segmented mask
  // exists. The user opts in explicitly via the menu.
  const currentMode: 'layers' | 'objects' = imageNodeMode ?? 'layers';
  const objectsActive = currentMode === 'objects';

  const activeLayerName = useMemo(() => {
    const active = layers.find((l) => l.id === activeLayerId);
    return active?.name ?? 'Source';
  }, [layers, activeLayerId]);

  const mime = documentMeta?.mimeType ?? '';
  const formatLabel = mime.startsWith('image/')
    ? mime.slice('image/'.length).toUpperCase()
    : 'IMG';

  const fileSize = documentMeta?.fileSize ? formatBytes(documentMeta.fileSize) : null;

  // Handlers — kept inline so the closure picks up `id` + `data.layerIds`.
  // Lifted out of the classic node verbatim. When the surface stabilises a
  // shared hook (e.g. useImageNodeActions) folds these and the classic
  // copy into one source. For now duplicating keeps the diff small and
  // doesn't risk classic regressions.
  function handleTransformDelta(delta: { angle?: number; flip_h?: boolean; flip_v?: boolean }) {
    const sessionId = useBackendState.getState().sessionId;
    if (!sessionId) return;
    const nodes = useBackendState.getState().snapshot?.operationGraph.nodes ?? [];
    const prevRotate = nodes.find((n) => n.id === `transform:${id}:rotate`)?.params as
      | { angle: number; flip_h: boolean; flip_v: boolean } | undefined;
    const prevCrop = nodes.find((n) => n.id === `transform:${id}:crop`)?.params as
      | { x: number; y: number; w: number; h: number } | undefined;
    const base = prevRotate ?? { angle: 0, flip_h: false, flip_v: false };
    const next = {
      angle: ((base.angle + (delta.angle ?? 0)) % 360 + 360) % 360,
      flip_h: delta.flip_h ? !base.flip_h : base.flip_h,
      flip_v: delta.flip_v ? !base.flip_v : base.flip_v,
    };
    void backendTools.set_image_node_transform(sessionId, {
      imageNodeId: id,
      layerIds: data.layerIds,
      crop: prevCrop ?? null,
      rotate: next,
    });
  }
  const canSplit = data.layerIds.length >= 2;
  function handleSplit() {
    if (!canSplit) return;
    const lastLayerId = data.layerIds[data.layerIds.length - 1];
    editorDocument.workspace.splitImageNode(id, lastLayerId);
  }
  function handleDelete() {
    editorDocument.closeDocument();
  }

  /**
   * Items rendered by both the ⋯ dropdown and the right-click ContextMenu.
   * Same set as classic ImageNode plus an Object-mode toggle (drafting-
   * specific) and a placeholder Duplicate (TODO: real clone).
   */
  const itemClass = 'px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary';
  const itemClassDim = 'px-2 py-1 text-[10px] rounded-sm cursor-not-allowed outline-none text-text-secondary opacity-60';
  const renderMenuItems = (Item: typeof DropdownMenu.Item | typeof ContextMenu.Item) => (
    <>
      {selectedObject && (
        <>
          <div className="px-2 pt-1 pb-0.5 text-[9px] uppercase tracking-wide text-text-secondary">
            {selectedObject.label}
          </div>
          <Item
            className={itemClass}
            onSelect={() => startObjectRename(selectedObject.id, id)}
          >
            Rename
          </Item>
          <Item
            className={itemClass}
            onSelect={() => convertObjectToLayerMask(selectedObject.id)}
          >
            Convert to Layer Mask
          </Item>
          <Item
            className={itemClass}
            onSelect={() => extractObjectToImageNode(selectedObject.id, id)}
          >
            Extract to Image Node
          </Item>
          <Item
            className={itemClass}
            onSelect={() => void deleteObject(selectedObject.id)}
          >
            Delete object
          </Item>
          <div className="my-1 h-px bg-separator" />
        </>
      )}
      <Item
        className={itemClass}
        onSelect={() => setImageNodeMode(id, objectsActive ? 'layers' : 'objects')}
      >
        {objectsActive ? 'Exit objects mode' : 'Enter objects mode'}
      </Item>
      <Item className={itemClass} onSelect={() => usePreferencesStore.getState().showCrop()}>
        Crop…
      </Item>
      <Item className={itemClass} onSelect={() => handleTransformDelta({ angle: +90 })}>
        Rotate 90° CW
      </Item>
      <Item className={itemClass} onSelect={() => handleTransformDelta({ angle: -90 })}>
        Rotate 90° CCW
      </Item>
      <Item className={itemClass} onSelect={() => handleTransformDelta({ flip_h: true })}>
        Flip Horizontal
      </Item>
      <Item className={itemClass} onSelect={() => handleTransformDelta({ flip_v: true })}>
        Flip Vertical
      </Item>
      <Item
        className={canSplit ? itemClass : itemClassDim}
        disabled={!canSplit}
        onSelect={canSplit ? handleSplit : undefined}
      >
        Split last layer
      </Item>
      <Item
        className={itemClass}
        onSelect={() => toast.info('Duplicate — not yet wired (workspace clone op pending).')}
      >
        Duplicate
      </Item>
      <Item className={itemClass} onSelect={handleDelete}>
        Delete
      </Item>
    </>
  );

  return (
    <div
      className="relative"
      style={{
        paddingLeft: `${LEFT_MARGIN}px`,
        paddingRight: `${RIGHT_MARGIN}px`,
        paddingTop: '24px',
        paddingBottom: '20px',
      }}
    >
      {/* TopMarginalia — drag handle lives on the title row only. */}
      <div className="workspace-drag-handle cursor-grab active:cursor-grabbing">
        <TopMarginalia
          title={data.name ?? 'Image'}
          activeLayerName={activeLayerName}
          formatLabel={formatLabel}
          rhsLines={fileSize ? [fileSize] : []}
          onCompareDown={() => setCompareHeld(true)}
          onCompareUp={() => setCompareHeld(false)}
          renderMenuItems={renderMenuItems as (Item: typeof DropdownMenu.Item) => React.ReactNode}
          tight
        />
      </div>

      {/* Body row */}
      <div className="flex items-start gap-0">
        <div
          className="shrink-0 self-stretch"
          style={{ width: `${LEFT_MARGIN}px`, marginLeft: `-${LEFT_MARGIN}px` }}
        >
          <LayerStrip layerIds={data.layerIds} />
        </div>

        {/* Image body. Handles + ContextMenu + overlays all anchor here so
            tether edges touch the image rectangle (not the title). */}
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
              <ContextMenu.Content className="overlay p-1 min-w-[160px] z-50">
                {renderMenuItems(ContextMenu.Item)}
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>

          {/* Outlines render for every committed object, independent of the
              objects-mode toggle: objects are a permanent feature, not a
              mode-gated overlay. Labels are suppressed because the markers
              in the right marginalia carry the names instead. */}
          <ImageNodeObjectsLayer
            imageNodeId={id}
            widthPx={displayW}
            heightPx={displayH}
            hideLabels
          />
          {/* Numbered markers + leader lines into the right gutter. */}
          <ObjectMarkers
            imageNodeId={id}
            widthPx={displayW}
            heightPx={displayH}
            marginWidth={RIGHT_MARGIN}
          />
          {/* SegmentHitLayer is the click-to-segment surface — only mount
              it when the user has explicitly entered objects mode via the
              ⋯ menu / right-click. */}
          {objectsActive && (
            <SegmentHitLayer imageNodeId={id} widthPx={displayW} heightPx={displayH} />
          )}

          {!selected && <CornerTicks />}

          {/* Selection frame fades in on `selected`. Width transitions only
              opacity so the body box stays steady. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 border border-[var(--color-accent)] transition-opacity duration-200"
            style={{ opacity: selected ? 1 : 0 }}
          />

          {selected && <ImageNodeResizeHandle imageNodeId={id} displayWidth={displayW} />}

          {/* React Flow connection points — anchored to the image body so
              tether edges land on the image rectangle's edges, not the
              outer composition. */}
          <Handle type="source" position={Position.Top}
            id="tether-out-top"    style={{ opacity: 0 }} />
          <Handle type="source" position={Position.Bottom}
            id="tether-out-bottom" style={{ opacity: 0 }} />
          <Handle type="source" position={Position.Left}
            id="tether-out-left"   style={{ opacity: 0 }} />
          <Handle type="source" position={Position.Right}
            id="tether-out-right"  style={{ opacity: 0 }} />
          <Handle type="target" position={Position.Top}
            id="tether-in-top"     style={{ opacity: 0 }} />
          <Handle type="target" position={Position.Bottom}
            id="tether-in-bottom"  style={{ opacity: 0 }} />
          <Handle type="target" position={Position.Left}
            id="tether-in-left"    style={{ opacity: 0 }} />
          <Handle type="target" position={Position.Right}
            id="tether-in-right"   style={{ opacity: 0 }} />
        </div>

        {/* Right margin gutter (object markers + leader lines land here in
            Phase 3). Empty for now so the composition stays balanced. */}
        <div
          className="shrink-0"
          style={{ width: `${RIGHT_MARGIN}px`, marginRight: `-${RIGHT_MARGIN}px` }}
        />
      </div>

      <BottomMarginalia
        sourceWidth={Math.round(effectiveSource.w)}
        sourceHeight={Math.round(effectiveSource.h)}
        formatLabel={formatLabel}
        fileSize={fileSize}
        layerCount={data.layerIds.length}
        objectCount={objects.length}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
