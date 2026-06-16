import { Combine, Eye, Image, MoreHorizontal, Scissors } from 'lucide-react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { ImageNodeBody } from './ImageNodeBody';
import { ImageNodeResizeHandle } from './ImageNodeResizeHandle';
import { ImageNodeSelectionPopover } from './ImageNodeSelectionPopover';
import { ObjectModeFooter } from './ObjectModeFooter';
import { SegmentHitLayer } from './SegmentHitLayer';
import { editorDocument } from '@/core/document';
import { useChromeVisible } from '@/hooks/useChromeVisible';
import { useImageNodeObjects } from '@/hooks/useImageNodeObjects';
import { ImageNodeObjectsLayer } from './ImageNodeObjectsLayer';
import { ImageNodeDrafting } from './drafting/ImageNodeDrafting';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { computeEffectiveSize, type Crop } from '@/lib/image-node-geometry';
import {
  convertObjectToLayerMask,
  extractObjectToImageNode,
  deleteObject,
  startObjectRename,
} from '@/lib/segmentation/object-actions';
import { exportImageNode, rejoinSourceImage } from '@/lib/image-node-actions';

export interface ImageNodeData extends Record<string, unknown> {
  name?: string;
  layerIds: string[];
  /** Canvas-space layout box (display dims). Drives outer wrapper sizing,
   *  React Flow's layout, and CSS dims of the visible canvas. */
  size: { w: number; h: number };
  /** Source bitmap dimensions in pixels. Drives the WebGL pipeline + crop
   *  geometry. Independent of `size` so a 6000×4000 photo and a 300×200
   *  thumbnail render at the same canvas-space box. */
  sourceSize: { w: number; h: number };
  activeLayerIndex?: number;
}

interface ImageNodeProps {
  id: string;
  data: ImageNodeData;
  selected: boolean;
}

function stopPointerDownNative(e: PointerEvent) {
  e.stopPropagation();
}

/**
 * The original Vercel/Radix flat image-node body. Renamed from `ImageNode`
 * for the Direction A drafting restyle so a thin wrapper at module scope
 * can branch on `usePreferencesStore.visualStyle`. Phase 1 stub: the
 * drafting branch returns ImageNodeClassic so the colour ramp / font load
 * is visible without the layout refactor committing. Phases 2 + 3 land
 * the marginalia + layer-strip + object-markers in
 * `./drafting/ImageNodeDrafting.tsx`.
 */
function ImageNodeClassic({ id, data, selected }: ImageNodeProps) {
  const stacked = data.layerIds.length > 1;
  const showStrip = stacked && selected;
  const canSplit = data.layerIds.length >= 2;
  const chromeVisible = useChromeVisible();
  // Chrome strips live in canvas space (Figma model) so they scale down with
  // zoom-out like everything else in the node. We deliberately do NOT
  // counter-scale them: a `transform: scale()` keeps the strip readable on
  // screen but doesn't claim layout space, so the strip's visually-overflowing
  // area landed on top of the image body (or vice-versa, depending on
  // stacking order) and a narrowed strip wrapped its toolbar to two rows
  // when its CSS width was percentage-compensated. The strip is hidden
  // entirely below the `useChromeVisible` LOD threshold (0.05); above that
  // it shrinks with the rest of the node, never overlaps, never wraps.
  const [compareHeld, setCompareHeld] = useState(false);

  // Stop native pointerdown bubbling so React Flow's drag-handle never sees it.
  // Named handler at module scope ensures removeEventListener can find the same reference.
  const compareBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = compareBtnRef.current;
    if (!el) return;
    el.addEventListener('pointerdown', stopPointerDownNative);
    return () => el.removeEventListener('pointerdown', stopPointerDownNative);
  }, [chromeVisible]);

  // Reset compareHeld synchronously when chrome hides. We use the
  // documented previous-prop-during-render pattern intentionally —
  // putting this in useEffect causes the cascading-renders ESLint
  // warning and lets the user see a "still held" Compare button for
  // one paint before it resets. React explicitly endorses this idiom
  // when guarded by `prev !== current` (see react.dev/reference/react/
  // useState#storing-information-from-previous-renders).
  const [prevChromeVisible, setPrevChromeVisible] = useState(chromeVisible);
  if (prevChromeVisible !== chromeVisible) {
    setPrevChromeVisible(chromeVisible);
    if (!chromeVisible) setCompareHeld(false);
  }

  const snapshotRotateAngle = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${id}:rotate`,
    );
    if (!node) return null;
    return (node.params.angle as number) ?? null;
  });
  // Split crop into primitive selectors to avoid Zustand object-identity churn.
  const snapshotCropX = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${id}:crop`,
    );
    if (!node) return null;
    const p = node.params as { x?: number; w?: number; h?: number };
    return p.w != null && p.h != null ? (p.x ?? 0) : null;
  });
  const snapshotCropY = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${id}:crop`,
    );
    if (!node) return null;
    const p = node.params as { y?: number; w?: number; h?: number };
    return p.w != null && p.h != null ? (p.y ?? 0) : null;
  });
  const snapshotCropW = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${id}:crop`,
    );
    if (!node) return null;
    return (node.params as { w?: number }).w ?? null;
  });
  const snapshotCropH = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${id}:crop`,
    );
    if (!node) return null;
    return (node.params as { h?: number }).h ?? null;
  });

  const snapshotCrop: Crop | null =
    snapshotCropW != null && snapshotCropH != null
      ? { x: snapshotCropX ?? 0, y: snapshotCropY ?? 0, w: snapshotCropW, h: snapshotCropH }
      : null;

  // Merge with cropPreview when this node is the crop-tab target.
  const inspectorTab = usePreferencesStore((s) => s.inspectorTab);
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const previousImageNodeId = useEditorStore((s) => s.previousImageNodeId);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const imageNodeCount = useEditorStore((s) => Object.keys(s.imageNodes).length);
  const previousImageNodeName = useEditorStore((s) =>
    previousImageNodeId ? s.imageNodes[previousImageNodeId]?.id : undefined,
  );
  const cropPreview = useEditorStore((s) => s.cropPreview);
  const imageNodeMode = useEditorStore((s) => s.imageNodeMode[id]);
  const objects = useImageNodeObjects(id);
  const objectCount = objects.length;
  const activeObjectId = useEditorStore((s) => s.activeObjectId);
  // Mask currently selected via canvas hit-test — only when it belongs to
  // THIS node's objects. Drives the per-object section that appears at
  // the top of this image-node's ContextMenu (Rename / Convert / Extract /
  // Delete). The same shared `object-actions` helpers as the drafting
  // variant so the two surfaces stay in lock-step.
  const selectedObject = objects.find(
    (o) => activeObjectId === o.id,
  ) ?? null;
  // Only extracted nodes carry sourceImageNodeId — drives the conditional
  // "Rejoin source image" menu item that undoes the extract.
  const sourceImageNodeId = useEditorStore(
    (s) => s.imageNodes[id]?.sourceImageNodeId,
  );
  const currentMode: 'layers' | 'objects' =
    imageNodeMode ?? (objectCount > 0 ? 'objects' : 'layers');
const previewActive = inspectorTab === 'crop' && activeImageNodeId === id;

  const effectiveRotateAngle =
    previewActive && cropPreview && cropPreview.rotate
      ? cropPreview.rotate.angle
      : snapshotRotateAngle;
  const effectiveCropRect: Crop | null =
    previewActive && cropPreview && cropPreview.crop
      ? cropPreview.crop
      : snapshotCrop;

  // Effective *source* dims after rotate/crop — drives the crop info readout
  // and the visible canvas's aspect ratio.
  const effectiveSource = computeEffectiveSize(data.sourceSize, effectiveRotateAngle, effectiveCropRect);
  // Canvas-space display box. Width comes from data.size (resizable, default
  // 600); height is derived from width × effective-source aspect so the box
  // always matches what the image will render as.
  const aspect = effectiveSource.h > 0 ? effectiveSource.w / effectiveSource.h : 1;
  const displayW = data.size.w;
  const displayH = displayW / aspect;

  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, updateNodeInternals]);

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

  function handleSplit() {
    if (!canSplit) return;
    const lastLayerId = data.layerIds[data.layerIds.length - 1];
    editorDocument.workspace.splitImageNode(id, lastLayerId);
  }

  // Header affordance: peel the *currently active* layer (not the last one)
  // onto a new image node. Gated on selected + multi-layer + active layer
  // belonging to this node (matches spec).
  const canSplitActive =
    selected &&
    canSplit &&
    activeLayerId !== null &&
    data.layerIds.includes(activeLayerId);
  function handleSplitActiveLayer() {
    if (!canSplitActive) return;
    editorDocument.workspace.splitActiveLayer(id);
  }

  // Header affordance: merge THIS node into the last-active different one.
  // Gated on ≥2 nodes existing and a known previous distinct from `id`.
  const canMergeIntoPrevious =
    imageNodeCount >= 2 &&
    previousImageNodeId !== null &&
    previousImageNodeId !== id;
  function handleMergeIntoPrevious() {
    if (!canMergeIntoPrevious || previousImageNodeId === null) return;
    editorDocument.workspace.mergeInto(previousImageNodeId, id);
  }

  function handleDelete() {
    // Deletes this image node only. Falls back to closing the document
    // when it's the last node (clears layers, pixel data, backend session)
    // because the auto-recreate effect in CanvasWorkspace would otherwise
    // immediately re-create the node from the surviving layers.
    editorDocument.workspace.deleteImageNode(id);
  }

  // Shared menu items for both DropdownMenu and ContextMenu.
  // Both Radix namespaces share the same prop shape for Item components.
  function renderItems(MenuItem: React.ComponentType<{
    className?: string;
    disabled?: boolean;
    onSelect?: () => void;
    children?: React.ReactNode;
  }>) {
    const objectItemCls =
      'px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none ' +
      'text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary';
    return (
      <>
        {selectedObject && (
          <>
            <div className="px-2 pt-1 pb-0.5 text-[9px] uppercase tracking-wide text-text-secondary">
              {selectedObject.label}
            </div>
            <MenuItem
              className={objectItemCls}
              onSelect={() => startObjectRename(selectedObject.id, id)}
            >
              Rename
            </MenuItem>
            <MenuItem
              className={objectItemCls}
              onSelect={() => convertObjectToLayerMask(selectedObject.id, id)}
            >
              Convert to Layer Mask
            </MenuItem>
            <MenuItem
              className={objectItemCls}
              onSelect={() => extractObjectToImageNode(selectedObject.id, id)}
            >
              Extract to Image Node
            </MenuItem>
            <MenuItem
              className={objectItemCls}
              onSelect={() => void deleteObject(selectedObject.id)}
            >
              Delete object
            </MenuItem>
            <div className="my-1 h-px bg-separator" />
          </>
        )}
        <MenuItem
          className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
            text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
          onSelect={() => usePreferencesStore.getState().showCrop()}
        >
          Crop…
        </MenuItem>
        <MenuItem
          className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
            text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
          onSelect={() => handleTransformDelta({ angle: +90 })}
        >
          Rotate 90° CW
        </MenuItem>
        <MenuItem
          className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
            text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
          onSelect={() => handleTransformDelta({ angle: -90 })}
        >
          Rotate 90° CCW
        </MenuItem>
        <MenuItem
          className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
            text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
          onSelect={() => handleTransformDelta({ flip_h: true })}
        >
          Flip Horizontal
        </MenuItem>
        <MenuItem
          className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
            text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
          onSelect={() => handleTransformDelta({ flip_v: true })}
        >
          Flip Vertical
        </MenuItem>
        <MenuItem
          className={`px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
            ${canSplit
              ? 'text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary'
              : 'text-text-tertiary cursor-not-allowed'
            }`}
          disabled={!canSplit}
          onSelect={handleSplit}
        >
          Split last layer
        </MenuItem>
        <div className="my-1 h-px bg-separator" />
        <MenuItem
          className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
            text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
          onSelect={() => void exportImageNode(id, 'png')}
        >
          Export as PNG
        </MenuItem>
        <MenuItem
          className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
            text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
          onSelect={() => void exportImageNode(id, 'jpeg')}
        >
          Export as JPEG
        </MenuItem>
        <MenuItem
          className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
            text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
          onSelect={() => void exportImageNode(id, 'webp')}
        >
          Export as WebP
        </MenuItem>
        {sourceImageNodeId && (
          <MenuItem
            className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
              text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
            onSelect={() => { rejoinSourceImage(id); }}
          >
            Rejoin source image
          </MenuItem>
        )}
        <div className="my-1 h-px bg-separator" />
        <MenuItem
          className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
            text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
          onSelect={handleDelete}
        >
          Delete
        </MenuItem>
      </>
    );
  }

  return (
    <div className="relative" style={{ width: displayW + 2 /* outer border */ }}>
      <div
        className={`overlay overflow-hidden ${selected ? 'workspace-node-selected' : ''}`}
        style={{
          ['--chrome-scale' as string]: '1',
          ['--overlay-border-width' as string]: '1px',
          ['--overlay-radius' as string]: '8px',
          ['--overlay-shadow' as string]: '0 4px 14px var(--shadow-overlay-color)',
        }}
      >
        {chromeVisible && (
          <ImageNodeSelectionPopover layerIds={data.layerIds}>
            <div
              className="workspace-drag-handle flex items-center gap-1.5 px-2 py-1 bg-surface border-b border-separator cursor-grab active:cursor-grabbing"
            >
              <Image size={11} className="text-text-secondary" aria-hidden />
              <span className="text-[10px] font-medium flex-1 truncate">{data.name ?? 'Image'}</span>
              <button
                ref={compareBtnRef}
                type="button"
                aria-label="Show original (hold)"
                onPointerDownCapture={(e) => { e.stopPropagation(); setCompareHeld(true); }}
                onPointerUp={() => setCompareHeld(false)}
                onPointerLeave={() => setCompareHeld(false)}
                onPointerCancel={() => setCompareHeld(false)}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] text-text-secondary hover:bg-surface-secondary hover:text-text-primary cursor-pointer"
              >
                <Eye size={10} aria-hidden />
              </button>
              {canSplitActive && (
                <button
                  type="button"
                  aria-label="Split selected layer to new image node"
                  title="Split selected layer to new image node"
                  onPointerDownCapture={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); handleSplitActiveLayer(); }}
                  className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] text-text-secondary hover:bg-surface-secondary hover:text-text-primary cursor-pointer"
                >
                  <Scissors size={10} aria-hidden />
                </button>
              )}
              {canMergeIntoPrevious && (
                <button
                  type="button"
                  aria-label={
                    previousImageNodeName
                      ? `Merge into ${previousImageNodeName}`
                      : 'Merge into previous image node'
                  }
                  title={
                    previousImageNodeName
                      ? `Merge into ${previousImageNodeName}`
                      : 'Merge into previous image node'
                  }
                  onPointerDownCapture={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); handleMergeIntoPrevious(); }}
                  className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] text-text-secondary hover:bg-surface-secondary hover:text-text-primary cursor-pointer"
                >
                  <Combine size={10} aria-hidden />
                </button>
              )}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    aria-label="Image node menu"
                    className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] text-text-secondary hover:bg-surface-secondary hover:text-text-primary cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal size={10} aria-hidden />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="overlay p-1 min-w-[140px] z-50" sideOffset={4} align="end">
                    {renderItems(DropdownMenu.Item)}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </ImageNodeSelectionPopover>
        )}
        <div className="relative">
          <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <div className="relative">
                <ImageNodeBody
                  imageNodeId={id}
                  layerIds={data.layerIds}
                  sourceWidth={data.sourceSize.w}
                  sourceHeight={data.sourceSize.h}
                  displayWidth={displayW}
                  displayHeight={displayH}
                  bypassAdjustments={compareHeld}
                />
                {/* See ImageNodeDrafting for the rationale: SegmentHitLayer
                    lives inside the Trigger so empty-area right-clicks in
                    layers mode bubble naturally to the image-node menu.
                    SAM segment-on-click runs only when objectsMode=true. */}
                <SegmentHitLayer
                  imageNodeId={id}
                  widthPx={displayW}
                  heightPx={displayH}
                  objectsMode={currentMode === 'objects'}
                />
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="overlay p-1 min-w-[140px] z-50">
                {renderItems(ContextMenu.Item)}
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
          <ImageNodeObjectsLayer
            imageNodeId={id}
            widthPx={displayW}
            heightPx={displayH}
          />
        </div>
        {chromeVisible && (
          <div
            className="flex items-center gap-1.5 px-2 py-1 text-[9px] text-text-secondary bg-surface border-t border-separator"
          >
            <span className="num">{Math.round(effectiveSource.w)} × {Math.round(effectiveSource.h)}</span>
            <span className="flex-1" />
            <ObjectModeFooter
              imageNodeId={id}
              layerCount={data.layerIds.length}
              objectCount={objectCount}
              currentMode={currentMode}
            />

          </div>
        )}
        {chromeVisible && showStrip && (
          <div
            aria-label="Layer strip"
            className="flex gap-1 px-2 py-1 bg-surface-secondary border-t border-separator"
          >
            {data.layerIds.map((lid, i) => (
              <div
                key={lid}
                className={`flex-1 h-[18px] rounded-[3px] border border-separator bg-surface ${i === (data.activeLayerIndex ?? 0) ? 'outline-[1.5px] outline outline-accent' : ''}`}
              />
            ))}
          </div>
        )}
      </div>
      <Handle type="target" position={Position.Top}
        id="tether-in-top"    style={{ left: '50%', opacity: 0 }} />
      <Handle type="target" position={Position.Bottom}
        id="tether-in-bottom" style={{ left: '50%', opacity: 0 }} />
      <Handle type="target" position={Position.Left}
        id="tether-in-left"   style={{ top: '10px', opacity: 0 }} />
      <Handle type="target" position={Position.Right}
        id="tether-in-right"  style={{ top: '10px', opacity: 0 }} />
      {selected && (
        <ImageNodeResizeHandle imageNodeId={id} displayWidth={displayW} />
      )}
    </div>
  );
}

/**
 * Module-scope wrapper that picks the visual style. Stays as `ImageNode`
 * so React Flow's nodeTypes registration is stable. Phase 1: drafting
 * just renders the classic body (the cream-paper + ochre palette comes
 * through CSS tokens via `[data-visual-style="drafting"]`). Phases 2 + 3
 * point this at `ImageNodeDrafting` instead.
 */
export function ImageNode(props: ImageNodeProps) {
  const visualStyle = usePreferencesStore((s) => s.visualStyle);
  if (visualStyle === 'drafting') return <ImageNodeDrafting {...props} />;
  return <ImageNodeClassic {...props} />;
}
