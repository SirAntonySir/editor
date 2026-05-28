import { useEffect, useRef } from 'react';
import { useSegmentSelection } from '@/store/segment-selection-slice';
import { maskStore } from '@/core/mask-store';

/**
 * Pointer state machine wired to the active Fabric canvas. Hover updates
 * segment hover; click sets selection (with smallest-first / cycle-on-repeat);
 * shift+click selects the segment AND opens SpawnPaletteWidget so the user
 * types the prompt (scope auto-fills from the just-selected segment).
 * ⌘/Ctrl+K dispatches the same 'spawn-palette:open' event.
 */
export function useSegmentInteraction(canvasRef: React.RefObject<HTMLCanvasElement | null>): void {
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

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
        const rect = el!.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * el!.width;
        const y = ((e.clientY - rect.top) / rect.height) * el!.height;
        const hits = massiveHitTest(x, y);
        const smallest = hits[0] ?? null;
        useSegmentSelection.getState().setHovered(smallest);
      });
    }

    function onClick(e: PointerEvent) {
      const rect = el!.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * el!.width;
      const y = ((e.clientY - rect.top) / rect.height) * el!.height;
      const hits = massiveHitTest(x, y);
      if (e.shiftKey) {
        const maskId = useSegmentSelection.getState().shiftClickAt(x, y, hits);
        if (maskId) {
          window.dispatchEvent(new CustomEvent('spawn-palette:open'));
        }
      } else {
        useSegmentSelection.getState().clickAt(x, y, hits);
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
  }, [canvasRef]);
}
