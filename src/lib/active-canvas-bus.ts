/**
 * Tiny pub/sub for "image node X has finished a composite into canvas Y".
 *
 * `useImageNodeRender` calls `publish` at the tail of every effect run; the
 * Info tab subscribes via `useActiveImageNodeCanvas` and filters by the
 * editor store's `activeImageNodeId`. Decouples the inspector from the
 * canvas render path without threading refs through React Flow.
 */

type Listener = (imageNodeId: string, canvas: HTMLCanvasElement) => void;

const listeners = new Set<Listener>();
let last: { imageNodeId: string; canvas: HTMLCanvasElement } | null = null;
// Per-id registry so a consumer can pull ANY node's latest canvas by id (not
// just the global last frame). Used by the source-node mirror preview to draw
// an extracted child's edited pixels back onto the source.
const byId = new Map<string, HTMLCanvasElement>();

export const activeCanvasBus = {
  publish(imageNodeId: string, canvas: HTMLCanvasElement): void {
    last = { imageNodeId, canvas };
    byId.set(imageNodeId, canvas);
    for (const cb of listeners) cb(imageNodeId, canvas);
  },
  /** Latest published canvas for a specific image node, or null. */
  get(imageNodeId: string): HTMLCanvasElement | null {
    return byId.get(imageNodeId) ?? null;
  },
  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    // Replay the last frame so a fresh subscriber gets the current canvas
    // immediately rather than waiting for the next render.
    if (last) cb(last.imageNodeId, last.canvas);
    return () => { listeners.delete(cb); };
  },
};
