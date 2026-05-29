import { useEffect } from 'react';
import { useEditorStore } from '@/store';

/**
 * Mount once at the app shell. While a cursor-bind is pending, tracks the
 * cursor position (so the ghost can follow) and binds ESC to cancel.
 */
export function useCursorBind(): void {
  const pending = useEditorStore((s) => s.pendingBind);

  useEffect(() => {
    if (!pending) return;
    const onMove = (e: PointerEvent) => {
      useEditorStore.getState().updateCursor(e.clientX, e.clientY);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        useEditorStore.getState().cancelBind();
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
