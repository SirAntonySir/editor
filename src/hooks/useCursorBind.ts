import { useEffect } from 'react';
import { useCursorBindStore } from '@/store/cursor-bind-slice';

/**
 * Mount once at the app shell. While a cursor-bind is pending, tracks the
 * cursor position (so the ghost can follow) and binds ESC to cancel.
 */
export function useCursorBind(): void {
  const pending = useCursorBindStore((s) => s.pending);

  useEffect(() => {
    if (!pending) return;
    const onMove = (e: PointerEvent) => {
      useCursorBindStore.getState().updateCursor(e.clientX, e.clientY);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        useCursorBindStore.getState().cancel();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
    };
  }, [pending]);
}
