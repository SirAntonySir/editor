import { useRef } from 'react';
import { useStore } from '@xyflow/react';
import { useEditorStore } from '@/store';

interface Props {
  imageNodeId: string;
  displayWidth: number;
}

/**
 * Corner-drag handle that resizes the image node's display width. Aspect is
 * locked to the source bitmap (the store action recomputes height from
 * sourceSize), so a single horizontal drag is all that's needed — vertical
 * delta is ignored. Mouse motion is divided by canvas zoom so 1 CSS pixel of
 * drag → 1 canvas-unit of resize.
 *
 * Only rendered when the image node is selected.
 */
export function ImageNodeResizeHandle({ imageNodeId, displayWidth }: Props) {
  const setDisplayWidth = useEditorStore((s) => s.setImageNodeDisplayWidth);
  const zoom = useStore((s) => s.transform[2]);
  const initialRef = useRef<{ x: number; w: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    initialRef.current = { x: e.clientX, w: displayWidth };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const init = initialRef.current;
    if (!init) return;
    const dx = (e.clientX - init.x) / Math.max(zoom, 0.001);
    setDisplayWidth(imageNodeId, init.w + dx);
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (initialRef.current === null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    initialRef.current = null;
  }

  return (
    <div
      role="slider"
      aria-label="Resize image node"
      // `nodrag nopan` opts this handle out of React Flow's pointer handling.
      // A React synthetic stopPropagation can't stop d3-zoom's native listener
      // on the viewport, so without `nopan` a left press-drag passes the pan
      // filter and the canvas pans the instant you grab the handle.
      className="nodrag nopan"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'absolute',
        right: -6,
        bottom: -6,
        width: 12,
        height: 12,
        borderRadius: 3,
        background: 'var(--color-accent)',
        cursor: 'nwse-resize',
        touchAction: 'none',
        zIndex: 5,
      }}
    />
  );
}
