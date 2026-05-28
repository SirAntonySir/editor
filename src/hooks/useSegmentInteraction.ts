import { useEffect, useRef } from 'react';
import * as fabric from 'fabric';
import { useSegmentSelection } from '@/store/segment-selection-slice';
import { maskStore } from '@/core/mask-store';

/**
 * Pointer state machine wired to the active Fabric canvas. Hover updates
 * segment hover; click sets selection (with smallest-first / cycle-on-repeat);
 * shift+click selects the segment AND opens SpawnPaletteWidget so the user
 * types the prompt (scope auto-fills from the just-selected segment).
 * ⌘/Ctrl+K dispatches the same 'spawn-palette:open' event.
 *
 * Coords:
 * - The browser delivers pointer events in client (viewport) pixels.
 * - We need image-pixel coords to index into mask.data, which is sized at
 *   the image's original resolution. The Fabric image is drawn at scale +
 *   offset within the canvas viewport, so we apply that inverse transform.
 */
export function useSegmentInteraction(
  fabricCanvasRef: React.RefObject<fabric.Canvas | null>,
): void {
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const fcanvas = fabricCanvasRef.current;
    if (!fcanvas) return;
    const el = (fcanvas as fabric.Canvas & { upperCanvasEl?: HTMLCanvasElement }).upperCanvasEl;
    if (!el) return;

    /** Convert a pointer event into image-pixel coordinates by walking through
     *  canvas-pixel and scene space and undoing the FabricImage transform. */
    function pointerToImagePx(e: PointerEvent): { x: number; y: number } | null {
      const f = fabricCanvasRef.current;
      if (!f || !el) return null;
      const img = f.getObjects().find((o) => o instanceof fabric.FabricImage) as fabric.FabricImage | undefined;
      if (!img) return null;

      // Client → canvas-pixel
      const rect = el.getBoundingClientRect();
      const canvasX = ((e.clientX - rect.left) / rect.width) * el.width;
      const canvasY = ((e.clientY - rect.top) / rect.height) * el.height;

      // Canvas-pixel → scene (apply inverse viewport transform if zoom/pan in use)
      const vpt = f.viewportTransform;
      let sceneX = canvasX;
      let sceneY = canvasY;
      if (vpt) {
        // vpt is [a, b, c, d, e, f] — scale + translate. Inverse:
        // sceneX = (canvasX - e) / a;  sceneY = (canvasY - f) / d
        // (b, c are 0 for axis-aligned transforms which this editor uses.)
        const a = vpt[0] || 1;
        const d = vpt[3] || 1;
        const tx = vpt[4] || 0;
        const ty = vpt[5] || 0;
        sceneX = (canvasX - tx) / a;
        sceneY = (canvasY - ty) / d;
      }

      // Scene → image-pixel via FabricImage transform (originX/Y default to 'center')
      const scaleX = img.scaleX ?? 1;
      const scaleY = img.scaleY ?? 1;
      const imgLeft = (img.left ?? 0) - ((img.width ?? 0) * scaleX) / 2;
      const imgTop = (img.top ?? 0) - ((img.height ?? 0) * scaleY) / 2;
      return {
        x: (sceneX - imgLeft) / scaleX,
        y: (sceneY - imgTop) / scaleY,
      };
    }

    function massiveHitTest(imageX: number, imageY: number): string[] {
      const hits: string[] = [];
      for (const mask of maskStore.all()) {
        if (imageX < 0 || imageY < 0 || imageX >= mask.width || imageY >= mask.height) continue;
        if (mask.data[Math.floor(imageY) * mask.width + Math.floor(imageX)]) {
          hits.push(mask.id);
        }
      }
      return hits;
    }

    function onPointerMove(e: PointerEvent) {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const p = pointerToImagePx(e);
        if (!p) {
          useSegmentSelection.getState().setHovered(null);
          return;
        }
        const hits = massiveHitTest(p.x, p.y);
        const smallest = hits[0] ?? null;
        useSegmentSelection.getState().setHovered(smallest);
      });
    }

    function onClick(e: PointerEvent) {
      const p = pointerToImagePx(e);
      if (!p) return;
      const hits = massiveHitTest(p.x, p.y);
      if (e.shiftKey) {
        const maskId = useSegmentSelection.getState().shiftClickAt(p.x, p.y, hits);
        if (maskId) {
          window.dispatchEvent(new CustomEvent('spawn-palette:open'));
        }
      } else {
        useSegmentSelection.getState().clickAt(p.x, p.y, hits);
      }
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') useSegmentSelection.getState().clear();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('spawn-palette:open'));
      }
    }

    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onClick);
      window.removeEventListener('keydown', onKey);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [fabricCanvasRef]);
}
