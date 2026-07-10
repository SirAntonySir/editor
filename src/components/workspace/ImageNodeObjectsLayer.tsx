import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useImageNodeObjects, type ImageObject } from '@/hooks/useImageNodeObjects';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { objectsToPaint } from '@/lib/overlay-visibility';
import {
  renameObject,
  selectInvertedObject,
  copyObjectToImageNode,
  copyObjectToLayer,
  deleteObject,
  redrawObject,
} from '@/lib/segmentation/object-actions';
import { spawnGenfillFromMask } from '@/lib/genfill-spawn';

interface ImageNodeObjectsLayerProps {
  imageNodeId: string;
  widthPx: number;
  heightPx: number;
  /** Suppress the floating HTML label bubbles. Drafting mode renders the
   *  labels as numbered markers in the right marginalia (see
   *  drafting/ObjectMarkers) and only wants the outline canvas here. */
  hideLabels?: boolean;
}

/** Trace the binary mask boundary into a single Path2D via marching squares.
 *  Each non-uniform 2×2 cell contributes 1–2 segments between edge midpoints,
 *  giving a half-pixel-offset boundary that reads as a smooth curve even at
 *  modest mask resolutions — far less staircase-y than walking per-cell
 *  rectangle edges (which clung to the integer grid).
 *
 *  Saddles (cases 5, 10) are split into the two non-crossing segments — the
 *  alternative ambiguity resolution would require sampling the cell centre,
 *  which a binary mask can't provide. Either choice is correct for closed
 *  regions; non-crossing keeps the outline planar.
 */
function appendContour(
  path: Path2D,
  mask: { data: Uint8Array; width: number; height: number },
  canvasW: number,
  canvasH: number,
): void {
  const { data, width, height } = mask;
  const cellW = canvasW / width;
  const cellH = canvasH / height;
  // Edge midpoint offsets in canvas space, relative to cell (x, y) origin.
  const dxHalf = cellW * 0.5;
  const dyHalf = cellH * 0.5;
  const seg = (x: number, y: number, e1: 0 | 1 | 2 | 3, e2: 0 | 1 | 2 | 3): void => {
    // 0=top, 1=right, 2=bottom, 3=left.
    const ox = x * cellW;
    const oy = y * cellH;
    const pt = (e: 0 | 1 | 2 | 3): [number, number] => {
      switch (e) {
        case 0: return [ox + dxHalf, oy];
        case 1: return [ox + cellW, oy + dyHalf];
        case 2: return [ox + dxHalf, oy + cellH];
        case 3: return [ox, oy + dyHalf];
      }
    };
    const [x1, y1] = pt(e1);
    const [x2, y2] = pt(e2);
    path.moveTo(x1, y1);
    path.lineTo(x2, y2);
  };
  for (let y = 0; y < height - 1; y++) {
    const row = y * width;
    const next = row + width;
    for (let x = 0; x < width - 1; x++) {
      const tl = data[row + x] === 255 ? 1 : 0;
      const tr = data[row + x + 1] === 255 ? 2 : 0;
      const br = data[next + x + 1] === 255 ? 4 : 0;
      const bl = data[next + x] === 255 ? 8 : 0;
      const idx = tl | tr | br | bl;
      switch (idx) {
        case 0: case 15: break;
        case 1:  case 14: seg(x, y, 3, 0); break;
        case 2:  case 13: seg(x, y, 0, 1); break;
        case 3:  case 12: seg(x, y, 3, 1); break;
        case 4:  case 11: seg(x, y, 1, 2); break;
        case 6:  case 9:  seg(x, y, 0, 2); break;
        case 7:  case 8:  seg(x, y, 3, 2); break;
        case 5:  seg(x, y, 3, 0); seg(x, y, 1, 2); break;
        case 10: seg(x, y, 0, 1); seg(x, y, 3, 2); break;
      }
    }
  }
}

/** Resolve the theme's `--color-accent` token to concrete sRGB bytes. The mask
 *  fill writes per-pixel RGBA and the stroke needs a plain colour, so the oklch
 *  token is rasterized through a 1×1 canvas to get real bytes. Falls back to a
 *  warm accent red if the token is missing / the color syntax is unsupported. */
function resolveAccentRgb(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-accent')
    .trim();
  if (raw) {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const pctx = probe.getContext('2d');
    if (pctx) {
      pctx.fillStyle = raw;
      pctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    }
  }
  return [214, 69, 47];
}

/** Paint one object's translucent fill. The mask is drawn at its native
 *  resolution into a scratch canvas (per-pixel accent + alpha) then bilinearly
 *  upscaled onto the display canvas, so the fill edge reads as a soft curve —
 *  the same treatment the live segmentation preview uses. */
function paintMaskFill(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  obj: ImageObject,
  rgb: [number, number, number],
  alpha: number,
): void {
  const { data, width, height } = obj.mask;
  const off = document.createElement('canvas');
  off.width = width;
  off.height = height;
  const octx = off.getContext('2d');
  if (!octx) return;
  const img = octx.createImageData(width, height);
  const [r, g, b] = rgb;
  for (let i = 0; i < data.length; i++) {
    const j = i * 4;
    img.data[j] = r;
    img.data[j + 1] = g;
    img.data[j + 2] = b;
    img.data[j + 3] = data[i] === 255 ? alpha : 0;
  }
  octx.putImageData(img, 0, 0);
  ctx.drawImage(off, 0, 0, canvasW, canvasH);
}

/** Paint every committed object mask like the live segmentation preview — a
 *  translucent fill plus a soft blurred outline — but tinted with the system
 *  accent (`--color-accent`) instead of the AI violet. A faint dark underlay
 *  keeps the outline legible over any photo content. */
function paintObjectMasks(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  objects: ImageObject[],
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);
  if (objects.length === 0) return;

  const rgb = resolveAccentRgb();
  const [r, g, b] = rgb;

  // Translucent accent fill per object (bilinear upscale → soft edges).
  const FILL_ALPHA = 110;
  ctx.imageSmoothingEnabled = true;
  for (const obj of objects) {
    paintMaskFill(ctx, canvasW, canvasH, obj, rgb, FILL_ALPHA);
  }

  // Soft accent outline traced via marching squares, over a dark underlay.
  const path = new Path2D();
  for (const obj of objects) {
    appendContour(path, obj.mask, canvasW, canvasH);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  // Blur rounds the boundary and softens the seam against the upscaled fill.
  ctx.filter = 'blur(0.7px)';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.30)';
  ctx.stroke(path);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.stroke(path);
  ctx.filter = 'none';
}

function ObjectLabel({
  obj,
  imageNodeId,
  widthPx,
  heightPx,
  headless = false,
}: {
  obj: ImageObject;
  imageNodeId: string;
  widthPx: number;
  heightPx: number;
  /** Render only the hidden Radix Trigger (no visible chip / no pointer
   *  capture). Drafting mode renders names in the right marginalia and
   *  doesn't want chips on the canvas — but the SegmentHitLayer still
   *  needs a `[data-object-id]` element to dispatch contextmenu into for
   *  the object's menu to open. */
  headless?: boolean;
}) {
  const mask = obj.mask;
  const left = (obj.bbox.minX / mask.width) * widthPx;
  const top = (obj.bbox.minY / mask.height) * heightPx;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(obj.label);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRenameId = useEditorStore((s) => s.pendingObjectRenameId);
  const clearRenameRequest = useEditorStore((s) => s.clearObjectRenameRequest);

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

  // Image-node menu → "Rename" stamps `pendingObjectRenameId` and flips the
  // node into objects mode. When this label mounts (or the pending id
  // changes to ours), enter edit and consume the request.
  useEffect(() => {
    if (pendingRenameId !== obj.id) return;
    startEdit();
    clearRenameRequest(obj.id);
    // startEdit is stable (closure on setEditing/setDraft) — exhaustive-deps
    // wants it listed but that would re-fire every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRenameId, obj.id, clearRenameRequest]);

  function finishEdit(): void {
    if (!editing) return;
    setEditing(false);
    if (draft.trim() && draft.trim() !== obj.label) {
      // Update maskStore eagerly so the chip text doesn't flicker back to
      // the old label while the optimistic snapshot patch settles.
      maskStore.setLabel(obj.id, draft.trim());
      void renameObject(obj.id, draft);
    }
  }

  function cancelEdit(): void {
    setEditing(false);
    setDraft(obj.label);
  }

  const visibleChipClass =
    'pointer-events-auto absolute px-1.5 py-0.5 rounded-[3px] bg-surface/95 ' +
    'text-text-primary text-[10px] leading-none border border-separator ' +
    'shadow-sm cursor-default select-none';
  const headlessClass = 'pointer-events-none absolute w-0 h-0 overflow-hidden';

  return (
    <ContextMenu.Root
      // Track the open menu in the store so the hover-only mask stays painted
      // while the pointer is ON the menu (hover clears the moment it leaves
      // the object's pixels) — see objectsToPaint in lib/overlay-visibility.
      onOpenChange={(open) =>
        useEditorStore.getState().setContextMenuObjectId(open ? obj.id : null)
      }
    >
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
          //
          // headless mode keeps the element in the DOM so SegmentHitLayer's
          // contextmenu dispatch can target it via `data-object-id`, but
          // hides it visually and stops it from capturing pointer events —
          // drafting-mode renders the visible name in the marginalia.
          className={headless ? headlessClass : visibleChipClass}
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
            onSelect={() => selectInvertedObject(obj.id, imageNodeId)}
          >
            Select Inverted
          </ContextMenu.Item>
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={() => copyObjectToLayer(obj.id, imageNodeId)}
          >
            Copy to new layer
          </ContextMenu.Item>
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={() => copyObjectToImageNode(obj.id, imageNodeId)}
          >
            Copy to image node
          </ContextMenu.Item>
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={() => void spawnGenfillFromMask(obj.id, imageNodeId)}
          >
            Generative fill…
          </ContextMenu.Item>
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={() => void redrawObject(obj.id, imageNodeId)}
          >
            Draw it myself
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-separator" />
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] cursor-pointer outline-none text-[var(--color-danger,#e5484d)] hover:bg-[color-mix(in_srgb,var(--color-danger,#e5484d)_12%,transparent)]"
            onSelect={() => void deleteObject(obj.id)}
          >
            Delete object mask
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
  hideLabels = false,
}: ImageNodeObjectsLayerProps) {
  const objects = useImageNodeObjects(imageNodeId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Masks are hover-only: paint just the hovered object so the photo (and
  // its edits) stays unobscured. The name shows in SegmentHitLayer's cursor
  // tooltip while hovering — no persistent chrome on or beside the image.
  // An object with its context menu open stays painted for the menu's
  // lifetime (the pointer sits on the menu, which clears hover).
  const hoveredObjectId = useEditorStore((s) => s.hoveredObjectId);
  const contextMenuObjectId = useEditorStore((s) => s.contextMenuObjectId);

  // Layout effect (not passive): the canvas width/height attributes are set
  // from widthPx/heightPx in this same render, so painting must run BEFORE the
  // browser paints — a passive effect leaves one stale frame (old dims) on node
  // resize, which reads as an outline flicker.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintObjectMasks(
      ctx, canvas.width, canvas.height,
      objectsToPaint(objects, hoveredObjectId, contextMenuObjectId),
    );
  }, [objects, hoveredObjectId, contextMenuObjectId, widthPx, heightPx]);

  if (objects.length === 0) return null;

  return (
    <div
      data-testid="image-node-objects-layer"
      // zIndex sits BELOW SegmentHitLayer (z=5): the hover tooltip lives in
      // that layer's stacking context and must render ABOVE the mask canvas.
      // Labels are headless in drafting mode (the only variant), and the
      // object context menu opens via SegmentHitLayer's programmatic
      // contextmenu dispatch (data-object-id), which needs no z-order.
      className="nodrag nopan pointer-events-none absolute inset-0"
      style={{ zIndex: 4 }}
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
          headless={hideLabels}
        />
      ))}
    </div>
  );
}
