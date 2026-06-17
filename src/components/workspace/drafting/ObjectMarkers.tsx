import { useEffect, useMemo, useRef, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { useImageNodeObjects, type ImageObject } from '@/hooks/useImageNodeObjects';
import {
  renameObject,
  selectInvertedObject,
  convertObjectToLayerMask,
  extractObjectToImageNode,
  deleteObject,
} from '@/lib/segmentation/object-actions';

interface ObjectMarkersProps {
  imageNodeId: string;
  /** Image body display width — defines the SVG viewport for leader lines. */
  widthPx: number;
  /** Image body display height — defines the SVG viewport. */
  heightPx: number;
  /** Pixel width of the right-margin gutter the markers sit in. The SVG
   *  uses `overflow: visible` so leader lines reach this column. */
  marginWidth: number;
}

const MARKER_SIZE = 22;
const MARKER_GAP = 6;
const MARKER_X_OFFSET = 18; // distance from image right edge to marker centre

interface PlacedMarker {
  obj: ImageObject;
  index: number; // 1-based ordinal shown in the marker
  cx: number;     // mask centroid in image-body display px
  cy: number;
  markerY: number; // top-edge y of the marker in image-body display px
}

/** Compute marker positions. Markers preferentially sit at their object's
 *  centroid y, with a greedy non-overlap pass top-down: each marker is
 *  pushed down until it clears the previous marker by `MARKER_GAP`. The
 *  final column stays within `[0, heightPx - MARKER_SIZE]` so nothing
 *  bleeds outside the image body. */
function placeMarkers(objects: ImageObject[], heightPx: number): PlacedMarker[] {
  // Centroid in display px. Bbox centre is a cheap stand-in for the true
  // pixel-weighted centroid; visually indistinguishable for marker anchors.
  const items = objects.map((obj, i) => {
    const cx = ((obj.bbox.minX + obj.bbox.maxX) / 2 / obj.mask.width);
    const cy = ((obj.bbox.minY + obj.bbox.maxY) / 2 / obj.mask.height);
    return { obj, index: i + 1, cxNorm: cx, cyNorm: cy };
  });
  // Sort by centroid y so the column ordering follows the image's top-to-bottom flow.
  items.sort((a, b) => a.cyNorm - b.cyNorm);

  const placed: PlacedMarker[] = [];
  let cursor = 0;
  for (const it of items) {
    const targetY = it.cyNorm * heightPx - MARKER_SIZE / 2;
    const markerY = Math.max(cursor, Math.min(heightPx - MARKER_SIZE, Math.max(0, targetY)));
    placed.push({
      obj: it.obj,
      index: it.index,
      cx: it.cxNorm * (heightPx * (it.obj.mask.width / it.obj.mask.height)), // tmp, overwritten in component
      cy: it.cyNorm * heightPx,
      markerY,
    });
    cursor = markerY + MARKER_SIZE + MARKER_GAP;
  }
  return placed;
}

/**
 * Right-margin numbered markers for committed objects, with dashed ochre
 * leader lines from each mask centroid to its marker. Replaces the
 * floating HTML label bubbles that used to sit on the image in classic
 * mode — pulling the labels out of the photo and into the marginalia is
 * the central move of Direction A.
 *
 * The right-click ContextMenu on each marker exposes the same Rename /
 * Convert to Layer Mask / Extract to Image Node / Delete actions the
 * classic surface had, so muscle memory transfers.
 */
export function ObjectMarkers({ imageNodeId, widthPx, heightPx, marginWidth }: ObjectMarkersProps) {
  const objects = useImageNodeObjects(imageNodeId);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const placed = useMemo(() => {
    const out = placeMarkers(objects, heightPx);
    // Overwrite cx with display px (placeMarkers ran without widthPx in
    // scope to keep the helper testable in isolation).
    for (const p of out) {
      const cxNorm = (p.obj.bbox.minX + p.obj.bbox.maxX) / 2 / p.obj.mask.width;
      p.cx = cxNorm * widthPx;
    }
    return out;
  }, [objects, widthPx, heightPx]);

  if (objects.length === 0) return null;

  // SVG sized to image body but with overflow visible so leader lines
  // reach into the right gutter (where markers live).
  return (
    <div
      data-testid="object-markers"
      className="absolute pointer-events-none"
      style={{ top: 0, left: 0, width: `${widthPx}px`, height: `${heightPx}px`, zIndex: 7 }}
    >
      <svg
        className="absolute inset-0 overflow-visible"
        width={widthPx}
        height={heightPx}
        viewBox={`0 0 ${widthPx} ${heightPx}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {placed.map((p) => {
          const markerCenterX = widthPx + MARKER_X_OFFSET + MARKER_SIZE / 2;
          const markerCenterY = p.markerY + MARKER_SIZE / 2;
          const isHover = hoveredId === p.obj.id;
          return (
            <g key={p.obj.id}>
              <line
                x1={p.cx}
                y1={p.cy}
                x2={markerCenterX}
                y2={markerCenterY}
                stroke="var(--color-accent)"
                strokeWidth={0.9}
                strokeDasharray="2 3"
                opacity={isHover ? 1 : 0.5}
              />
              <circle
                cx={p.cx}
                cy={p.cy}
                r={2.4}
                fill="var(--color-accent)"
                opacity={isHover ? 1 : 0.7}
              />
            </g>
          );
        })}
      </svg>

      {/* Marker column lives outside the image body's right edge. Each
          marker is absolutely positioned within the right-gutter slot so
          the leader line's terminus aligns with the marker centre. */}
      <div
        className="absolute"
        style={{ top: 0, left: `${widthPx + MARKER_X_OFFSET}px`, width: `${marginWidth - MARKER_X_OFFSET}px`, height: `${heightPx}px`, pointerEvents: 'none' }}
      >
        {placed.map((p) => (
          <ObjectMarker
            key={p.obj.id}
            obj={p.obj}
            index={p.index}
            imageNodeId={imageNodeId}
            top={p.markerY}
            onHover={setHoveredId}
          />
        ))}
      </div>
    </div>
  );
}

interface ObjectMarkerProps {
  obj: ImageObject;
  index: number;
  imageNodeId: string;
  top: number;
  onHover: (id: string | null) => void;
}

function ObjectMarker({ obj, index, imageNodeId, top, onHover }: ObjectMarkerProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(obj.label);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRenameId = useEditorStore((s) => s.pendingObjectRenameId);
  const clearRenameRequest = useEditorStore((s) => s.clearObjectRenameRequest);

  function startEdit(): void {
    setDraft(obj.label);
    setEditing(true);
  }

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  useEffect(() => {
    if (pendingRenameId !== obj.id) return;
    startEdit();
    clearRenameRequest(obj.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRenameId, obj.id, clearRenameRequest]);

  function finishEdit(): void {
    if (!editing) return;
    setEditing(false);
    if (draft.trim() && draft.trim() !== obj.label) {
      maskStore.setLabel(obj.id, draft.trim());
      void renameObject(obj.id, draft);
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
          data-object-marker={obj.id}
          className="absolute flex items-center gap-2 pointer-events-auto cursor-default select-none"
          style={{ top: `${top}px`, left: 0 }}
          onMouseEnter={() => onHover(obj.id)}
          onMouseLeave={() => onHover(null)}
          onDoubleClick={(e) => { e.stopPropagation(); startEdit(); }}
          onClick={(e) => e.stopPropagation()}
          onContextMenuCapture={(e) => e.stopPropagation()}
        >
          <span
            aria-hidden
            className="flex items-center justify-center w-[22px] h-[22px] rounded-full bg-surface border border-[var(--color-accent)] text-[var(--color-accent)] font-[var(--font-mono)] text-[10px] tabular-nums leading-none"
          >
            {index}
          </span>
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
              className="bg-transparent text-text-primary font-[var(--font-display,Fraunces)] italic text-[14px] leading-none outline-none w-[10ch] border-b border-[var(--color-accent)]"
            />
          ) : (
            <span className="font-[var(--font-display,Fraunces)] italic text-[14px] leading-none text-text-primary">
              {obj.label}
            </span>
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
            onSelect={() => selectInvertedObject(obj.id)}
          >
            Select Inverted
          </ContextMenu.Item>
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={() => convertObjectToLayerMask(obj.id, imageNodeId)}
          >
            Convert to Layer Mask
          </ContextMenu.Item>
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={() => extractObjectToImageNode(obj.id, imageNodeId)}
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
