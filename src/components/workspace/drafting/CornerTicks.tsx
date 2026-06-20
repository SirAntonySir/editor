import { useRef } from 'react';
import { useStore } from '@xyflow/react';
import { useEditorStore } from '@/store';

interface CornerTicksProps {
  imageNodeId: string;
  displayWidth: number;
  displayHeight: number;
  selected: boolean;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const CORNER_CONFIG: Record<
  Corner,
  {
    /** sign applied to the canvas-space dx when computing delta_w. */
    dxSign: 1 | -1;
    /** When true, the left edge moves with the resize (and so does position.x). */
    leftMoves: boolean;
    /** When true, the top edge moves with the resize (and so does position.y). */
    topMoves: boolean;
    /** Cursor while the handle is grabbable. */
    cursor: 'nwse-resize' | 'nesw-resize';
    /** Tailwind classes for the L-arm directions. The L hugs the corner, so
     *  the side facing INTO the image is open and the two OUTER sides carry
     *  the border. */
    armsClass: string;
  }
> = {
  tl: { dxSign: -1, leftMoves: true,  topMoves: true,  cursor: 'nwse-resize',
        armsClass: 'border-r-0 border-b-0' },
  tr: { dxSign:  1, leftMoves: false, topMoves: true,  cursor: 'nesw-resize',
        armsClass: 'border-l-0 border-b-0' },
  bl: { dxSign: -1, leftMoves: true,  topMoves: false, cursor: 'nesw-resize',
        armsClass: 'border-r-0 border-t-0' },
  br: { dxSign:  1, leftMoves: false, topMoves: false, cursor: 'nwse-resize',
        armsClass: 'border-l-0 border-t-0' },
};

/**
 * Four hairline L-shapes at the image corners. Doubles as the image-node's
 * resize affordance when the node is selected.
 *
 * Visual states:
 *  - **Unselected**: tiny 14 px L-shapes, outset 7 px beyond the body — read
 *    as identification ticks, not as interactive handles. `pointer-events:
 *    none` so they don't capture clicks meant for the body / SegmentHitLayer.
 *  - **Selected**: animate to 22 px L-shapes sitting on the body corners
 *    (inset 0 from the boundary) with a `nwse-resize` / `nesw-resize`
 *    cursor and pointer capture. Each corner resizes from its OPPOSITE
 *    corner as anchor, so the four handles offer the standard four-corner
 *    resize affordance. Width is the primary axis (the store action
 *    clamps + recomputes height from `sourceSize`); position is shifted
 *    for any corner whose top / left edge moves under the resize so the
 *    anchored corner stays in place in canvas space.
 *
 * Replaces the standalone `ImageNodeResizeHandle` which was a single
 * bottom-right pad. Mouse motion is divided by canvas zoom so 1 CSS pixel
 * of drag → 1 canvas-unit of resize.
 */
export function CornerTicks({
  imageNodeId, displayWidth, displayHeight, selected,
}: CornerTicksProps) {
  const setDisplayWidth = useEditorStore((s) => s.setImageNodeDisplayWidth);
  const setNodePosition = useEditorStore((s) => s.setNodePosition);
  const zoom = useStore((s) => s.transform[2]);
  // Per-active-handle drag state. One at a time.
  const initialRef = useRef<{
    corner: Corner;
    clientX: number;
    width: number;
    posX: number;
    posY: number;
    aspect: number;
  } | null>(null);

  function onPointerDown(corner: Corner) {
    return (e: React.PointerEvent<HTMLSpanElement>) => {
      if (!selected) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const node = useEditorStore.getState().imageNodes[imageNodeId];
      if (!node) return;
      const aspect = displayHeight > 0 ? displayWidth / displayHeight : 1;
      initialRef.current = {
        corner,
        clientX: e.clientX,
        width: displayWidth,
        posX: node.position.x,
        posY: node.position.y,
        aspect,
      };
    };
  }
  function onPointerMove(e: React.PointerEvent<HTMLSpanElement>) {
    const init = initialRef.current;
    if (!init) return;
    const cfg = CORNER_CONFIG[init.corner];
    const dx = (e.clientX - init.clientX) / Math.max(zoom, 0.001);
    const deltaW = cfg.dxSign * dx;
    const newWidth = init.width + deltaW;
    setDisplayWidth(imageNodeId, newWidth);
    // setDisplayWidth clamps; re-read for the actual delta the store applied.
    const applied = useEditorStore.getState().imageNodes[imageNodeId]?.size.w;
    const realDeltaW = applied != null ? applied - init.width : deltaW;
    const realDeltaH = realDeltaW / init.aspect;
    const newX = cfg.leftMoves ? init.posX - realDeltaW : init.posX;
    const newY = cfg.topMoves  ? init.posY - realDeltaH : init.posY;
    if (newX !== init.posX || newY !== init.posY) {
      setNodePosition(imageNodeId, { x: newX, y: newY });
    }
  }
  function onPointerUp(e: React.PointerEvent<HTMLSpanElement>) {
    if (initialRef.current === null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    initialRef.current = null;
  }

  // Size + outset of the L. Tailwind arbitrary values keep this declarative
  // and let the CSS transition animate width/height + top/left/etc when the
  // class strings change between the two states.
  const arm  = selected ? 22 : 14;
  const out  = selected ? 0  : 7;

  return (
    <div
      aria-hidden
      // pointer-events controlled per-handle below — the outer container is
      // pass-through so unselected ticks never swallow the body's clicks.
      className="pointer-events-none absolute inset-0"
      data-testid="image-node-corner-ticks"
    >
      {(Object.keys(CORNER_CONFIG) as Corner[]).map((c) => {
        const cfg = CORNER_CONFIG[c];
        const baseStyle: React.CSSProperties = {
          width: `${arm}px`,
          height: `${arm}px`,
          transition: 'width 200ms, height 200ms, top 200ms, right 200ms, bottom 200ms, left 200ms',
          // The handle should accept pointer events only while selected.
          pointerEvents: selected ? 'auto' : 'none',
          cursor: selected ? cfg.cursor : undefined,
        };
        // Position the OUTER corner of each L by sliding `out` px in the
        // appropriate axes. The inner corner of the L always lands ON the
        // image-body corner.
        if (c === 'tl') { baseStyle.top = `-${out}px`; baseStyle.left = `-${out}px`; }
        if (c === 'tr') { baseStyle.top = `-${out}px`; baseStyle.right = `-${out}px`; }
        if (c === 'bl') { baseStyle.bottom = `-${out}px`; baseStyle.left = `-${out}px`; }
        if (c === 'br') { baseStyle.bottom = `-${out}px`; baseStyle.right = `-${out}px`; }
        return (
          <span
            key={c}
            data-corner={c}
            // `nodrag nopan` so React Flow doesn't start a node drag / pan
            // when the user grabs the handle.
            className={`nodrag nopan absolute block border border-[var(--color-accent)] ${cfg.armsClass}`}
            style={baseStyle}
            onPointerDown={onPointerDown(c)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        );
      })}
    </div>
  );
}
