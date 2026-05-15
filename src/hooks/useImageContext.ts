import { create } from 'zustand';
import { analyzeImage, createSession, pushSessionContext } from '@/lib/ai-client';
import { downscaleForUpload } from '@/lib/downscale-for-upload';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';
import type { ImageContext } from '@/types/image-context';

type UploadSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

interface AiSessionState {
  sessionId: string | null;
  context: ImageContext | null;
  status: 'idle' | 'uploading' | 'analysing' | 'ready' | 'error';
  error: string | null;
  /** Fingerprint of the base-image state when the current context was produced. */
  lastAnalysedFingerprint: string | null;
  uploadAndAnalyse: (source: UploadSource) => Promise<void>;
  bindCachedSession: (source: UploadSource) => Promise<void>;
  restoreContext: (context: ImageContext) => void;
  reset: () => void;
}

/**
 * Fingerprint the user's manual base-image edits (crop + non-AI adjustments)
 * across all non-`ai-panel` layers. Excluding ai-panel layers is deliberate:
 * adding AI suggestions should NOT invalidate the cached context — otherwise
 * every multi-panel flow would trigger a fresh analyse and break the
 * thesis-spec's ≥80% prompt-cache exit criterion.
 */
export function currentImageFingerprint(): string {
  const layers = useEditorStore
    .getState()
    .layers.filter((l) => l.type !== 'ai-panel');
  return JSON.stringify(
    layers.map((l) => ({
      id: l.id,
      type: l.type,
      visible: l.visible,
      opacity: l.opacity,
      blendMode: l.blendMode,
      cropMeta: l.cropMeta ?? null,
      adjustments: l.adjustmentStack.adjustments.map((a) => ({
        type: a.type,
        params: a.params,
        enabled: a.enabled,
        opacity: a.opacity,
        blendMode: a.blendMode,
      })),
    })),
  );
}

export const useAiSession = create<AiSessionState>((set, get) => ({
  sessionId: null,
  context: null,
  status: 'idle',
  error: null,
  lastAnalysedFingerprint: null,
  async uploadAndAnalyse(source) {
    const fingerprint = currentImageFingerprint();
    set({ status: 'uploading', error: null, context: null, sessionId: null });
    try {
      const blob = await downscaleForUpload(source);
      const sessionId = await createSession(blob);
      set({ sessionId, status: 'analysing' });
      const context = await analyzeImage(sessionId);
      console.log('[ImageContext]', context);
      if (get().sessionId !== sessionId) return;
      set({ context, status: 'ready', lastAnalysedFingerprint: fingerprint });
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
   * lazy `bindCachedSession`. Fingerprint is set to the current state on the
   * assumption that the document hasn't been edited since the save that
   * produced this cached context.
   */
  restoreContext(context) {
    console.log('[ImageContext] (restored from disk)', context);
    set({
      context,
      status: 'ready',
      error: null,
      lastAnalysedFingerprint: currentImageFingerprint(),
    });
  },
  reset() {
    set({ sessionId: null, context: null, status: 'idle', error: null, lastAnalysedFingerprint: null });
  },
}));

/**
 * Kick off `uploadAndAnalyse` from the first image-type layer's source pixels.
 * Used after `.edp` open and after IndexedDB session-restore, both of which
 * hydrate the canvas without going through the fresh-file upload path.
 * No-op if there is no image layer or source canvas, or a session is already
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

/**
 * Re-analyse using the current composited canvas (= what the user sees,
 * including crop + base-image adjustments). Called automatically on Cmd+K
 * when the fingerprint indicates the cached context is stale.
 */
export async function reanalyseFromComposite(): Promise<void> {
  // Dynamic-import so this module stays loadable in a node test env where
  // `document` (used by LayerCompositor's constructor) is undefined.
  const { LayerCompositor } = await import('@/lib/layer-compositor');
  const canvas = LayerCompositor.compositeSync();
  if (!canvas || canvas.width === 0 || canvas.height === 0) {
    console.warn('[ImageContext] reanalyseFromComposite: empty composite, skipping');
    return;
  }
  console.log('[ImageContext] reanalyseFromComposite: uploading composite', {
    w: canvas.width,
    h: canvas.height,
  });
  await useAiSession.getState().uploadAndAnalyse(canvas);
  console.log('[ImageContext] reanalyseFromComposite: done');
}
