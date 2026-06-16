import { useEffect, useRef, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useImageNodeObjects, type ImageObject } from '@/hooks/useImageNodeObjects';
import { toast } from '@/components/ui/Toast';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';
import { backendTools } from '@/lib/backend-tools';
import { maskStore } from '@/core/mask-store';
import { pixelStore } from '@/core/pixel-store';
import { extractLayerFromMask } from '@/store/segment-actions';
import { UI } from '@/config';

interface ImageNodeObjectsLayerProps {
  imageNodeId: string;
  widthPx: number;
  heightPx: number;
}

/** Sum the outline of every object into a single canvas — one paint pass
 *  for the whole image-node instead of one canvas per mask. Cell size is
 *  the canvas/mask ratio, so the stroke aligns with the underlying mask
 *  grid even when CSS scales the canvas to display size. */
function paintAllOutlines(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  objects: ImageObject[],
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.beginPath();
  for (const obj of objects) {
    const { mask } = obj;
    const cellW = canvasW / mask.width;
    const cellH = canvasH / mask.height;
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        const i = y * mask.width + x;
        if (mask.data[i] !== 255) continue;
        const up = y > 0 && mask.data[i - mask.width] === 255;
        const dn = y < mask.height - 1 && mask.data[i + mask.width] === 255;
        const lt = x > 0 && mask.data[i - 1] === 255;
        const rt = x < mask.width - 1 && mask.data[i + 1] === 255;
        const px = x * cellW;
        const py = y * cellH;
        if (!up) { ctx.moveTo(px, py); ctx.lineTo(px + cellW, py); }
        if (!dn) { ctx.moveTo(px, py + cellH); ctx.lineTo(px + cellW, py + cellH); }
        if (!lt) { ctx.moveTo(px, py); ctx.lineTo(px, py + cellH); }
        if (!rt) { ctx.moveTo(px + cellW, py); ctx.lineTo(px + cellW, py + cellH); }
      }
    }
  }
  // Marching-ants outline over arbitrary image content: deliberately
  // *not* themed. The black-then-white stroke pair guarantees contrast
  // against both bright and dark areas of the underlying photo. Theme
  // tokens (which target chrome, not image overlays) would lose
  // visibility on light-on-light or dark-on-dark images.
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(0,0,0,0.40)';
  ctx.stroke();
  ctx.lineWidth = 1.25;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

async function commitRename(maskId: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  // Optimistic — local snapshot patch + maskStore label, before the SSE echo.
  useBackendState.getState().pushMaskRename(maskId, trimmed);
  const sessionId = useAiSession.getState().sessionId;
  if (!sessionId) return;
  const env = await backendTools.rename_mask(sessionId, { maskId, label: trimmed });
  if (!env.ok) toast.info(`Rename failed: ${env.error?.message ?? 'unknown error'}`);
}

function convertToLayerMask(obj: ImageObject): void {
  // The mask's layerId points at the layer it was created on (set by
  // registerMaskFromPng resolving via image_node_id). That's the natural
  // owner of the mask — set it as that layer's layerMask. Compositor reads
  // `layer.layerMask` and multiplies alpha at render time.
  const editor = useEditorStore.getState();
  const layerId = obj.mask.layerId;
  if (!editor.layers.find((l) => l.id === layerId)) {
    toast.info('Convert to Layer Mask: owning layer no longer exists.');
    return;
  }
  editor.updateLayer(layerId, { layerMask: obj.id });
  toast.info(`Applied "${obj.label}" as layer mask.`);
}

function extractToImageNode(obj: ImageObject, sourceImageNodeId: string): void {
  const editor = useEditorStore.getState();
  const srcNode = editor.imageNodes[sourceImageNodeId];
  if (!srcNode) return;
  try {
    const newLayerId = extractLayerFromMask({
      sourceLayerId: obj.mask.layerId,
      maskRef: obj.id,
    });
    const baked = pixelStore.getSource(newLayerId);
    const sourceSize = baked
      ? { w: baked.width, h: baked.height }
      : srcNode.sourceSize;
    const position = {
      x: srcNode.position.x + srcNode.size.w + UI.splitGapPx,
      y: srcNode.position.y,
    };
    const newNodeId = editor.addImageNode([newLayerId], position, sourceSize);
    editor.setActiveImageNode(newNodeId);
  } catch (err) {
    toast.info(`Extract failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function deleteObject(maskId: string): Promise<void> {
  // Optimistic — strip locally so the menu closes onto an already-gone
  // object. The SSE echo is idempotent (handler filters by id).
  useBackendState.getState().pushMaskDeleted(maskId);
  const sessionId = useAiSession.getState().sessionId;
  if (!sessionId) return;
  const env = await backendTools.delete_mask(sessionId, { maskId });
  if (!env.ok) toast.info(`Delete failed: ${env.error?.message ?? 'unknown error'}`);
}

function ObjectLabel({
  obj,
  imageNodeId,
  widthPx,
  heightPx,
}: {
  obj: ImageObject;
  imageNodeId: string;
  widthPx: number;
  heightPx: number;
}) {
  const mask = obj.mask;
  const left = (obj.bbox.minX / mask.width) * widthPx;
  const top = (obj.bbox.minY / mask.height) * heightPx;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(obj.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  function startEdit(): void {
    setDraft(obj.label);
    setEditing(true);
  }

  function finishEdit(): void {
    if (!editing) return;
    setEditing(false);
    if (draft.trim() && draft.trim() !== obj.label) {
      // Update maskStore eagerly so the chip text doesn't flicker back to
      // the old label while the optimistic snapshot patch settles.
      maskStore.setLabel(obj.id, draft.trim());
      void commitRename(obj.id, draft);
    }
  }

  function cancelEdit(): void {
    setEditing(false);
    setDraft(obj.label);
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          data-object-id={obj.id}
          // pointer-events-auto so the right-click hits this label and not
          // the React Flow node beneath it. The label sits in a sibling
          // subtree of the image-node's ContextMenu.Trigger, so we do NOT
          // need to stopPropagation on contextmenu — doing so would also
          // kill Radix's own bubble-phase handler on this element and the
          // object's menu would never open (including re-dispatches from
          // SegmentHitLayer's contextmenu hit-test path).
          className="pointer-events-auto absolute px-1.5 py-0.5 rounded-[3px] bg-surface/95 text-text-primary text-[10px] leading-none border border-separator shadow-sm cursor-default select-none"
          style={{ left: `${left}px`, top: `${Math.max(0, top - 18)}px` }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => { e.stopPropagation(); startEdit(); }}
        >
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={finishEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); finishEdit(); }
                if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-transparent text-text-primary text-[10px] leading-none outline-none w-[10ch]"
            />
          ) : (
            obj.label
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="overlay p-1 min-w-[180px] z-50">
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={startEdit}
          >
            Rename
          </ContextMenu.Item>
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={() => convertToLayerMask(obj)}
          >
            Convert to Layer Mask
          </ContextMenu.Item>
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={() => extractToImageNode(obj, imageNodeId)}
          >
            Extract to Image Node
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-separator" />
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none text-text-secondary"
            onSelect={() => void deleteObject(obj.id)}
          >
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function ImageNodeObjectsLayer({
  imageNodeId,
  widthPx,
  heightPx,
}: ImageNodeObjectsLayerProps) {
  const objects = useImageNodeObjects(imageNodeId);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintAllOutlines(ctx, canvas.width, canvas.height, objects);
  }, [objects, widthPx, heightPx]);

  if (objects.length === 0) return null;

  return (
    <div
      data-testid="image-node-objects-layer"
      // zIndex sits ABOVE SegmentHitLayer (z=5) so right-clicks on a label
      // land here instead of being swallowed by the hit-test surface — and
      // bubbling up the (covered) image body then opening the image-node's
      // ContextMenu instead of the object's. The canvas itself stays
      // pointer-events-none so only the labels capture input.
      className="nodrag nopan pointer-events-none absolute inset-0"
      style={{ zIndex: 6 }}
    >
      <canvas
        ref={canvasRef}
        width={Math.round(widthPx)}
        height={Math.round(heightPx)}
        className="absolute inset-0 pointer-events-none"
        style={{ width: `${widthPx}px`, height: `${heightPx}px` }}
        aria-hidden
      />
      {objects.map((obj) => (
        <ObjectLabel
          key={obj.id}
          obj={obj}
          imageNodeId={imageNodeId}
          widthPx={widthPx}
          heightPx={heightPx}
        />
      ))}
    </div>
  );
}
