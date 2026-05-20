export interface ToastMessage {
  id: number;
  text: string;
  variant: 'info' | 'error';
}

let counter = 0;
const listeners = new Set<(msg: ToastMessage) => void>();

/** Subscribe to toast events. Returns an unsubscribe function. */
export function onToast(fn: (msg: ToastMessage) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Module-level toast emitter. Call from anywhere; the docked BackendStatusBar
 * subscribes (via useBackendStatus) and surfaces the latest message in the
 * topbar strip. Queue is replace-latest (length 1) — the newest message wins.
 */
export const toast = {
  info(text: string): void {
    const msg: ToastMessage = { id: ++counter, text, variant: 'info' };
    listeners.forEach((l) => l(msg));
  },
  error(text: string): void {
    const msg: ToastMessage = { id: ++counter, text, variant: 'error' };
    listeners.forEach((l) => l(msg));
  },
};
