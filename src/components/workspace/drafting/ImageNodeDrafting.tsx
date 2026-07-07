import { useState, useMemo } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Handle, Position } from '@xyflow/react';
import {
  Bot,
  ChevronRight,
  Combine,
  Copy,
  Crop as CropIcon,
  Download,
  FlipHorizontal2,
  FlipVertical2,
  Info,
  Merge,
  MessageSquare,
  Pencil,
  RotateCcw,
  RotateCw,
  ScanSearch,
  Scissors,
  Sparkles,
  SquareArrowOutUpRight,
  Trash2,
} from 'lucide-react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { usePreferencesStore } from '@/store/preferences-store';
import { useImageNodeObjects } from '@/hooks/useImageNodeObjects';
import { analyseImageLayer, useAiSession } from '@/hooks/useImageContext';
import { useAiAccess } from '@/lib/ai-access';
import { backendTools } from '@/lib/backend-tools';
import { editorDocument } from '@/core/document';
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
import { toast } from '@/components/ui/Toast';
import {
  extractObjectToImageNode,
  deleteObject,
  startObjectRename,
} from '@/lib/segmentation/object-actions';
import { exportImageNode, rejoinSourceImage } from '@/lib/image-node-actions';
import { duplicateActiveImageNode } from '@/lib/duplicate-image-node';
import { computeEffectiveSize, type Crop } from '@/lib/image-node-geometry';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { ImageNodeBody } from '../ImageNodeBody';
import { SegmentHitLayer } from '../SegmentHitLayer';
import { ImageNodeObjectsLayer } from '../ImageNodeObjectsLayer';
import { CornerTicks } from './CornerTicks';
import { TopMarginalia, type MenuPrimitives } from './TopMarginalia';
import { BottomMarginalia } from './BottomMarginalia';
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

const EMPTY_WIDGETS: import('@/types/widget').Widget[] = [];

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
  const [isRenaming, setIsRenaming] = useState(false);
  // Reveal the resize corner handles on hover (not only when selected), so the
  // image node resizes the same way widgets do.
  const [hovered, setHovered] = useState(false);
  const setImageNodeName = useEditorStore((s) => s.setImageNodeName);
  // Right-click "Analyze with AI" hides once this node has been analysed —
  // the AI menu does the same via its `analysedIds.includes(id)` check.
  const isAnalysed = useAiSession((s) => s.analysedImageNodeIds.includes(id));
  // Study control condition hides the node's AI context-menu items.
  const aiAccess = useAiAccess();
  // No backend session → no AI items at all (they'd silently no-op). Matches
  // the app-wide doctrine: tools disabled when sseStatus !== 'open'.
  const offline = useBackendState((s) => s.sseStatus !== 'open');

  function openPaletteOnThisImage(mode: 'ask' | 'edit') {
    // Open the palette directly in the given mode. The image-node's first
    // layer name rides as an attached context chip so the LLM call grounds on
    // "this image" rather than the active selection at palette-open time.
    // 'ask' answers questions; 'edit' drives edits (widget proposals).
    const node = useEditorStore.getState().imageNodes[id];
    const firstLayerId = node?.layerIds[0];
    const firstLayer = firstLayerId
      ? useEditorStore.getState().layers.find((l) => l.id === firstLayerId)
      : undefined;
    const label = node?.name ?? firstLayer?.name ?? 'this image';
    window.dispatchEvent(new CustomEvent('spawn-palette:open', {
      detail: {
        mode,
        attachContext: [{ label: 'Image', value: label, sourceId: `imageNode:${id}` }],
      },
    }));
  }

  // --- Effective rotate / crop -----------------
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

  // Small / narrow images: keep the chrome from dwarfing the image.
  //  - Frame: a minimum body width so the title/footer never collapse; the
  //    image is centred within it (letterbox sides) when it's narrower.
  //  - Gutters: the fixed side margins (left balance, object markers right)
  //    shrink with the frame so a small node isn't ringed by dead space.
  // Comfortably-wide images (frame ≥ GUTTER_FULL_AT) are unchanged.
  const MIN_BODY_W = 320;
  const GUTTER_FULL_AT = 480;
  const MIN_LEFT_GUTTER = 96;   // balances the right-hand marker gutter
  const MIN_RIGHT_GUTTER = 56;  // object markers + leader line
  const frameW = Math.max(displayW, MIN_BODY_W);
  const letterbox = Math.round((frameW - displayW) / 2);
  const gutterScale = Math.min(1, frameW / GUTTER_FULL_AT);
  const leftGutter = Math.round(Math.max(MIN_LEFT_GUTTER, LEFT_MARGIN * gutterScale));
  const rightGutter = Math.round(Math.max(MIN_RIGHT_GUTTER, RIGHT_MARGIN * gutterScale));

  const documentMeta = useEditorStore((s) => s.documentMeta);
  const imageNodeMode = useEditorStore((s) => s.imageNodeMode[id]);
  const setImageNodeMode = useEditorStore((s) => s.setImageNodeMode);
  const objectSelectTool = useEditorStore((s) => s.objectSelectTool);
  const setObjectSelectTool = useEditorStore((s) => s.setObjectSelectTool);
  const objects = useImageNodeObjects(id);
  const activeObjectId = useEditorStore((s) => s.activeObjectId);
  // The "selected object" reachable from the image-node menu: the active
  // object, but only when that object belongs to one of THIS node's objects
  // (so the same context menu opening on a different node doesn't see
  // another node's selection).
  const selectedObject = useMemo(() => {
    if (activeObjectId === null) return null;
    return objects.find((o) => o.id === activeObjectId) ?? null;
  }, [activeObjectId, objects]);
  // Only set on nodes produced by "Extract to Image Node" — drives the
  // "Rejoin source image" menu item that undoes the extract.
  const sourceImageNodeId = useEditorStore(
    (s) => s.imageNodes[id]?.sourceImageNodeId,
  );
  // True while an extracted node is dragged over THIS node (its source) —
  // drives the "release to rejoin" snap pulse.
  const isRejoinTarget = useEditorStore((s) => s.rejoinTargetNodeId === id);

  // "Rejoin source image" un-does an extract by merging this node back into its
  // source — only valid once the user's edits here are APPLIED. Gate on any
  // engaged active widget (pending AI suggestions don't count as the user's
  // changes) targeting this node's layers.
  const snapshotWidgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);
  const pendingSuggestionIds = useSuggestionsUi((s) => s.pendingSuggestionIds);
  const hasUnappliedChanges = useMemo(
    () =>
      snapshotWidgets.some(
        (w) =>
          w.status === 'active' &&
          !pendingSuggestionIds.has(w.id) &&
          w.nodes.some((n) => n.layerId != null && data.layerIds.includes(n.layerId)),
      ),
    [snapshotWidgets, pendingSuggestionIds, data.layerIds],
  );

  // Default is 'layers' — no auto-flip to objects when a segmented mask
  // exists. The user opts in explicitly via the menu.
  const currentMode: 'layers' | 'objects' = imageNodeMode ?? 'layers';
  const objectsActive = currentMode === 'objects';

  const mime = documentMeta?.mimeType ?? '';
  const formatLabel = documentMeta?.format
    ?? (mime.startsWith('image/') ? mime.slice('image/'.length).toUpperCase() : 'IMG');

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
  // Merge Visible needs 2+ *visible* layers on this node. Selector returns a
  // number, so it re-renders only when a relevant layer's visibility flips.
  const visibleLayerCount = useEditorStore((s) =>
    data.layerIds.reduce(
      (n, lid) => n + (s.layers.find((l) => l.id === lid)?.visible ? 1 : 0),
      0,
    ),
  );
  const canMergeVisible = visibleLayerCount >= 2;
  function handleSplit() {
    if (!canSplit) return;
    const lastLayerId = data.layerIds[data.layerIds.length - 1];
    editorDocument.workspace.splitImageNode(id, lastLayerId);
  }
  function handleDelete() {
    editorDocument.workspace.deleteImageNode(id);
  }

  /**
   * Items rendered by both the ⋯ dropdown and the right-click ContextMenu.
   * Same set as classic ImageNode plus an Object-mode toggle (drafting-
   * specific) and a placeholder Duplicate (TODO: real clone).
   */
  const itemClass = 'px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary';
  const itemClassDim = 'px-2 py-1 text-[10px] rounded-sm cursor-not-allowed outline-none text-text-secondary opacity-60';
  // Destructive items: red text + red-tinted hover so a delete reads as a delete.
  const itemClassDanger =
    'px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none text-[var(--color-danger,#e5484d)] ' +
    'hover:bg-[color-mix(in_srgb,var(--color-danger,#e5484d)_12%,transparent)]';
  const renderMenuItems = ({ Item, Sub, SubTrigger, SubContent, Portal }: MenuPrimitives) => (
    <>
      {/* Top group: AI actions (study-gated) + the view/structure toggles
          (objects mode, rejoin). Each carries an icon; AI icons are violet,
          the structural ones neutral. A single separator divides the group
          from the editing actions below. */}
      {/* AI group: hidden entirely when offline (no session → items would
          no-op) or in the study control condition. Progression: before
          analysis only "Analyze with AI" shows; once this node has image
          context, Ask + Edit replace it (both ground on the context). */}
      {aiAccess && !offline && (
        <>
          {!isAnalysed && (
            <Item
              className={itemClass}
              onSelect={() => void analyseImageLayer(id)}
            >
              <span className="flex items-center gap-1.5">
                <Sparkles size={11} className="text-[var(--color-ai)]" />
                <span>Analyze with AI</span>
              </span>
            </Item>
          )}
          {isAnalysed && (
            <>
              <Item
                className={itemClass}
                onSelect={() => openPaletteOnThisImage('ask')}
              >
                <span className="flex items-center gap-1.5">
                  <MessageSquare size={11} className="text-[var(--color-ai)]" />
                  <span>Ask about this image</span>
                </span>
              </Item>
              <Item
                className={itemClass}
                onSelect={() => openPaletteOnThisImage('edit')}
              >
                <span className="flex items-center gap-1.5">
                  <Bot size={11} className="text-[var(--color-ai)]" />
                  <span>Edit with Atelier</span>
                </span>
              </Item>
            </>
          )}
        </>
      )}
      <Item
        className={itemClass}
        onSelect={() => {
          // Promote this node to active so the Info tab reads THIS image's
          // context (it keys off activeImageNodeId), then reveal the tab.
          useEditorStore.getState().setActiveImageNode(id);
          usePreferencesStore.getState().showImageContext();
        }}
      >
        <span className="flex items-center gap-1.5">
          <Info size={11} className="text-text-secondary" />
          <span>See info</span>
        </span>
      </Item>
      <Item
        className={itemClass}
        onSelect={() => setImageNodeMode(id, objectsActive ? 'layers' : 'objects')}
      >
        <span className="flex items-center gap-1.5">
          <ScanSearch size={11} className="text-text-secondary" />
          <span>{objectsActive ? 'Exit objects mode' : 'Enter objects mode'}</span>
        </span>
      </Item>
      {sourceImageNodeId && (
        <Item
          className={itemClass}
          onSelect={() => {
            if (hasUnappliedChanges) {
              toast.info('Apply or dismiss your changes before rejoining the source image.');
              return;
            }
            rejoinSourceImage(id);
          }}
        >
          <span className="flex items-center gap-1.5">
            <Combine size={11} className="text-text-secondary" />
            <span>Rejoin source image</span>
          </span>
        </Item>
      )}
      <div className="my-1 h-px bg-separator" />
      {selectedObject && (
        <>
          <div className="px-2 pt-1 pb-0.5 text-[9px] uppercase tracking-wide text-text-secondary">
            {selectedObject.label}
          </div>
          <Item
            className={itemClass}
            onSelect={() => startObjectRename(selectedObject.id, id)}
          >
            <span className="flex items-center gap-1.5">
              <Pencil size={11} className="text-text-secondary" />
              <span>Rename</span>
            </span>
          </Item>
          <Item
            className={itemClass}
            onSelect={() => extractObjectToImageNode(selectedObject.id, id)}
          >
            <span className="flex items-center gap-1.5">
              <SquareArrowOutUpRight size={11} className="text-text-secondary" />
              <span>Extract to Image Node</span>
            </span>
          </Item>
          <Item
            className={itemClassDanger}
            onSelect={() => void deleteObject(selectedObject.id)}
          >
            <span className="flex items-center gap-1.5">
              <Trash2 size={11} />
              <span>Delete object mask</span>
            </span>
          </Item>
          <div className="my-1 h-px bg-separator" />
        </>
      )}
      <Item
        className={itemClass}
        onSelect={() => setIsRenaming(true)}
      >
        <span className="flex items-center gap-1.5">
          <Pencil size={11} className="text-text-secondary" />
          <span>Rename</span>
        </span>
      </Item>
      <Item className={itemClass} onSelect={() => usePreferencesStore.getState().showCrop()}>
        <span className="flex items-center gap-1.5">
          <CropIcon size={11} className="text-text-secondary" />
          <span>Crop…</span>
        </span>
      </Item>
      {/* Rotate direction is carried by the curved-arrow icon, so the CW/CCW
          label suffix is dropped — both items read "Rotate 90°". */}
      <Item className={itemClass} onSelect={() => handleTransformDelta({ angle: +90 })}>
        <span className="flex items-center gap-1.5">
          <RotateCw size={11} className="text-text-secondary" />
          <span>Rotate 90°</span>
        </span>
      </Item>
      <Item className={itemClass} onSelect={() => handleTransformDelta({ angle: -90 })}>
        <span className="flex items-center gap-1.5">
          <RotateCcw size={11} className="text-text-secondary" />
          <span>Rotate 90°</span>
        </span>
      </Item>
      <Item className={itemClass} onSelect={() => handleTransformDelta({ flip_h: true })}>
        <span className="flex items-center gap-1.5">
          <FlipHorizontal2 size={11} className="text-text-secondary" />
          <span>Flip Horizontal</span>
        </span>
      </Item>
      <Item className={itemClass} onSelect={() => handleTransformDelta({ flip_v: true })}>
        <span className="flex items-center gap-1.5">
          <FlipVertical2 size={11} className="text-text-secondary" />
          <span>Flip Vertical</span>
        </span>
      </Item>
      <Item
        className={canSplit ? itemClass : itemClassDim}
        disabled={!canSplit}
        onSelect={canSplit ? handleSplit : undefined}
      >
        <span className="flex items-center gap-1.5">
          <Scissors size={11} className="text-text-secondary" />
          <span>Split last layer</span>
        </span>
      </Item>
      <Item
        className={canMergeVisible ? itemClass : itemClassDim}
        disabled={!canMergeVisible}
        onSelect={canMergeVisible ? () => editorDocument.workspace.mergeVisibleLayers(id) : undefined}
      >
        <span className="flex items-center gap-1.5">
          <Merge size={11} className="text-text-secondary" />
          <span>Merge visible layers</span>
        </span>
      </Item>
      <Item
        className={itemClass}
        onSelect={() => {
          // Promote this image-node to active so the shared duplicate
          // helper (also bound to Cmd+D) operates on it instead of
          // whatever was selected at right-click time.
          useEditorStore.getState().setActiveImageNode(id);
          void duplicateActiveImageNode();
        }}
      >
        <span className="flex items-center gap-1.5">
          <Copy size={11} className="text-text-secondary" />
          <span>Duplicate</span>
        </span>
      </Item>
      <div className="my-1 h-px bg-separator" />
      {/* The three formats collapse into one "Export as…" submenu — same
          handler per format, nested under a single Download-iconed trigger. */}
      <Sub>
        <SubTrigger className={itemClass}>
          <span className="flex w-full items-center gap-1.5">
            <Download size={11} className="text-text-secondary" />
            <span>Export as…</span>
            <ChevronRight size={11} className="ml-auto text-text-secondary" />
          </span>
        </SubTrigger>
        <Portal>
          <SubContent className="overlay min-w-[120px] z-50 p-1">
            <Item className={itemClass} onSelect={() => void exportImageNode(id, 'png')}>
              PNG
            </Item>
            <Item className={itemClass} onSelect={() => void exportImageNode(id, 'jpeg')}>
              JPEG
            </Item>
            <Item className={itemClass} onSelect={() => void exportImageNode(id, 'webp')}>
              WebP
            </Item>
          </SubContent>
        </Portal>
      </Sub>
      <div className="my-1 h-px bg-separator" />
      <Item className={itemClassDanger} onSelect={handleDelete}>
        <span className="flex items-center gap-1.5">
          <Trash2 size={11} />
          <span>Delete image</span>
        </span>
      </Item>
    </>
  );

  return (
    <div
      className="relative"
      style={{
        paddingLeft: `${leftGutter}px`,
        paddingRight: `${rightGutter}px`,
        paddingTop: '24px',
        paddingBottom: '20px',
      }}
    >
      {/* TopMarginalia — drag handle lives on the title row only. */}
      <div className="workspace-drag-handle cursor-grab active:cursor-grabbing">
        <TopMarginalia
          title={data.name ?? 'Image'}
          onCompareDown={() => setCompareHeld(true)}
          onCompareUp={() => setCompareHeld(false)}
          objectsActive={objectsActive}
          onToggleObjectsMode={() => setImageNodeMode(id, objectsActive ? 'layers' : 'objects')}
          objectSelectTool={objectSelectTool}
          onSelectObjectTool={setObjectSelectTool}
          showAnalyze={aiAccess && !offline && !isAnalysed}
          onAnalyze={() => void analyseImageLayer(id)}
          renderMenuItems={renderMenuItems}
          tight
          isRenaming={isRenaming}
          onRenameStart={() => setIsRenaming(true)}
          onRenameCommit={(next) => {
            setImageNodeName(id, next);
            setIsRenaming(false);
          }}
          onRenameCancel={() => setIsRenaming(false)}
        />
      </div>

      {/* Body row. The layers strip is no longer here — it lives on a
          standalone `layers` node (see LayerNode); the left padding remains to
          balance the right-hand object-marker gutter and keep the image centred. */}
      <div className="flex items-start gap-0">
        {/* Frame column: a minimum width so the title/footer (which span this
            column) never collapse around a narrow image. The image body is
            centred within it — the side gaps are the letterbox. */}
        <div className="flex justify-center shrink-0" style={{ width: `${frameW}px` }}>
        {/* Image body. Handles + ContextMenu + overlays all anchor here so
            tether edges touch the image rectangle (not the title). The rejoin
            snap cue rings THIS rectangle (the image), not the padded node. */}
        <div
          className={`relative ${isRejoinTarget ? 'rejoin-snap-target' : ''}`}
          style={{ width: `${displayW}px`, height: `${displayH}px` }}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
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
                {/* SegmentHitLayer lives INSIDE the image-node Trigger so an
                    empty-area right-click in layers mode bubbles naturally
                    to the image-node ContextMenu (no extra dispatch). The
                    layer hit-tests objects in both modes — click selects
                    the mask scope; right-click opens the object's menu via
                    re-dispatch to the `[data-object-id]` headless triggers
                    in ImageNodeObjectsLayer. SAM segment-on-click only runs
                    when `objectsMode` is true. */}
                <SegmentHitLayer
                  imageNodeId={id}
                  widthPx={displayW}
                  heightPx={displayH}
                  sourceWidth={data.sourceSize.w}
                  sourceHeight={data.sourceSize.h}
                  objectsMode={objectsActive}
                />
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="overlay min-w-[160px] z-50">
                <ScrollArea viewportClassName="p-1 max-h-[var(--radix-context-menu-content-available-height)]">
                  {renderMenuItems({
                    Item: ContextMenu.Item,
                    Sub: ContextMenu.Sub,
                    SubTrigger: ContextMenu.SubTrigger,
                    SubContent: ContextMenu.SubContent,
                    Portal: ContextMenu.Portal,
                  } as MenuPrimitives)}
                </ScrollArea>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>

          {/* Outlines + headless ContextMenu triggers per object. Labels are
              hidden — drafting renders the visible names in the right
              marginalia (ObjectMarkers below). The Triggers remain in the
              DOM so the SegmentHitLayer can dispatch contextmenu into them. */}
          <ImageNodeObjectsLayer
            imageNodeId={id}
            widthPx={displayW}
            heightPx={displayH}
            hideLabels
          />
          {/* Numbered markers + leader lines into the right gutter. The leader
              spans the letterbox plus the gutter so it reaches the true gutter
              column even when the image is centred in a wider frame. */}
          <ObjectMarkers
            imageNodeId={id}
            widthPx={displayW}
            heightPx={displayH}
            marginWidth={letterbox + rightGutter}
          />

          {/* Corner ticks double as the resize handles when the node is
              selected — they animate from small inset ticks to slightly
              larger handles sitting on the image-body corners. Replaces the
              old standalone bottom-right `ImageNodeResizeHandle`. */}
          <CornerTicks
            imageNodeId={id}
            displayWidth={displayW}
            displayHeight={displayH}
            selected={selected || hovered}
          />

          {/* Selection frame fades in on `selected`. Width transitions only
              opacity so the body box stays steady. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 border border-[var(--color-accent)] transition-opacity duration-200"
            style={{ opacity: selected ? 1 : 0 }}
          />


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
        </div>

        {/* Right margin gutter — object markers + leader lines land here. */}
        <div
          className="shrink-0"
          style={{ width: `${rightGutter}px`, marginRight: `-${rightGutter}px` }}
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
