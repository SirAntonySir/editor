import { create } from 'zustand';
import { analyzeImage, createSession, pushSessionContext } from '@/lib/ai-client';
import { downscaleForUpload } from '@/lib/downscale-for-upload';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';
import type { ImageContext } from '@/types/image-context';

interface AiSessionState {
  sessionId: string | null;
  context: ImageContext | null;
  status: 'idle' | 'uploading' | 'analysing' | 'ready' | 'error';
  error: string | null;
  uploadAndAnalyse: (source: ImageBitmap) => Promise<void>;
  bindCachedSession: (source: ImageBitmap) => Promise<void>;
  restoreContext: (context: ImageContext) => void;
  reset: () => void;
}

export const useAiSession = create<AiSessionState>((set, get) => ({
  sessionId: null,
  context: null,
  status: 'idle',
  error: null,
  async uploadAndAnalyse(source) {
    set({ status: 'uploading', error: null, context: null, sessionId: null });
    try {
      const blob = await downscaleForUpload(source);
      const sessionId = await createSession(blob);
      set({ sessionId, status: 'analysing' });
      const context = await analyzeImage(sessionId);
      console.log('[ImageContext]', context);
      // Guard against the user loading another image while this resolves.
      if (get().sessionId !== sessionId) return;
      set({ context, status: 'ready' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ImageContext] uploadAndAnalyse failed:', msg, err);
      set({ status: 'error', error: msg });
    }
  },
  /**
   * Re-upload the image to /api/session and push the locally-cached context
   * to the new session — no Claude call. Used to lazily bind a session after
   * a page-reload when the user invokes Cmd+K and the cached context is
   * still valid. Falls back to `uploadAndAnalyse` if no cached context.
   */
  async bindCachedSession(source) {
    const ctx = get().context;
    if (!ctx) return get().uploadAndAnalyse(source);
    set({ status: 'uploading', error: null, sessionId: null });
    try {
      const blob = await downscaleForUpload(source);
      const sessionId = await createSession(blob);
      set({ sessionId, status: 'analysing' });
      await pushSessionContext(sessionId, ctx);
      if (get().sessionId !== sessionId) return;
      set({ status: 'ready' });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },
  /**
   * Restore a previously-cached context from disk (e.g. .edp open or session
   * restore). Sets status to 'ready' so the AI surface treats context as
   * available without re-invoking Claude. `sessionId` stays null until the
   * user explicitly re-uploads (via "Re-analyze image") OR Cmd+K triggers a
   * lazy `bindCachedSession`.
   */
  restoreContext(context) {
    console.log('[ImageContext] (restored from disk)', context);
    set({ context, status: 'ready', error: null });
  },
  reset() {
    set({ sessionId: null, context: null, status: 'idle', error: null });
  },
}));

/**
 * Kick off `uploadAndAnalyse` from the first image-type layer's source pixels.
 * Used after `.edp` open and after IndexedDB session-restore, both of which
 * hydrate the canvas without going through the fresh-file upload path.
 * No-op if there is no image layer, no source canvas, or a session is already
 * active.
 */
export async function analyseFirstImageLayer(): Promise<void> {
  if (useAiSession.getState().sessionId) return;
  const firstImage = useEditorStore.getState().layers.find((l) => l.type === 'image');
  if (!firstImage) return;
  const source = pixelStore.getSource(firstImage.id);
  if (!source) return;
  const bitmap = await createImageBitmap(source);
  await useAiSession.getState().uploadAndAnalyse(bitmap);
}

/**
 * Lazy-bind a backend session from the first image layer's pixels, using the
 * cached `ImageContext` if available (no Claude call). Falls back to a full
 * `uploadAndAnalyse` if no cached context.
 *
 * Called from `handlePaletteSubmit` when the user invokes Cmd+K after a
 * reload — the cached context is on disk but the backend session has died.
 */
export async function bindSessionFromFirstImageLayer(): Promise<void> {
  if (useAiSession.getState().sessionId) return;
  const firstImage = useEditorStore.getState().layers.find((l) => l.type === 'image');
  if (!firstImage) return;
  const source = pixelStore.getSource(firstImage.id);
  if (!source) return;
  const bitmap = await createImageBitmap(source);
  await useAiSession.getState().bindCachedSession(bitmap);
}
