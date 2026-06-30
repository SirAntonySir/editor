import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow } from '@xyflow/react';
import { useEditorStore } from '@/store';
import { exceedsDragThreshold, isOutsideRect } from '@/lib/workspace-drag';

interface ExtractDragOptions {
  /** Image node the segment currently belongs to (the drag origin). */
  sourceImageNodeId: string;
  /** Label shown in the drag ghost. */
  label: string;
  /** Invoked once, on drop OUTSIDE the source node's bounds, with the drop
   *  point in flow (canvas) coordinates. Dropping inside is a no-op (cancel),
   *  as is a press that never passes the drag threshold (that stays a click). */
  onExtract: (dropFlow: { x: number; y: number }) => void;
}

interface ExtractDragHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

/**
 * Pointer-drag gesture for pulling a segment off its image into a new node.
 * Reuses the pure `exceedsDragThreshold` / `isOutsideRect` decisions and React
 * Flow's `screenToFlowPosition`. Attach the returned handlers to the grab
 * element (marker or mask) and render `ghost` somewhere in the same tree — it
 * portals a cursor-following chip while dragging.
 */
export function useSegmentExtractDrag(opts: ExtractDragOptions): ExtractDragHandlers & {
  dragging: boolean;
  ghost: ReactNode;
  /** True once immediately after a completed drag (then resets). Call at the
   *  top of the grab element's onClick so a drag doesn't also fire its click
   *  (select / SAM-pick). */
  consumeDragClick: () => boolean;
} {
  const { screenToFlowPosition } = useReactFlow();
  const start = useRef<{ x: number; y: number } | null>(null);
  const justDragged = useRef(false);
  // Screen-space cursor while dragging (drives the ghost); null when idle.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY };
    justDragged.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (cursor || exceedsDragThreshold(dx, dy)) {
      setCursor({ x: e.clientX, y: e.clientY });
    }
  }, [cursor]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const wasDragging = cursor !== null;
    start.current = null;
    setCursor(null);
    if (!wasDragging) return; // never passed threshold → a click, leave it alone
    justDragged.current = true; // suppress the click that follows this pointerup
    e.stopPropagation();
    const dropFlow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const node = useEditorStore.getState().imageNodes[opts.sourceImageNodeId];
    if (!node) return;
    if (isOutsideRect(dropFlow, { position: node.position, size: node.size })) {
      opts.onExtract(dropFlow);
    }
  }, [cursor, screenToFlowPosition, opts]);

  const ghost = cursor
    ? createPortal(
        <div
          aria-hidden
          style={{ position: 'fixed', left: cursor.x + 10, top: cursor.y + 10, zIndex: 9999, pointerEvents: 'none' }}
          className="px-1.5 py-0.5 rounded-[4px] text-[11px] font-medium
            bg-surface text-[var(--color-accent)] border border-[var(--color-accent)] shadow-overlay
            flex items-center gap-1 whitespace-nowrap"
        >
          <span className="opacity-70">↗</span>
          <span className="truncate max-w-[140px]">{opts.label}</span>
        </div>,
        document.body,
      )
    : null;

  const consumeDragClick = useCallback(() => {
    const v = justDragged.current;
    justDragged.current = false;
    return v;
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, dragging: cursor !== null, ghost, consumeDragClick };
}
