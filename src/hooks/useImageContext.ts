import { create } from 'zustand';
import { analyzeImage, createSession, pushSessionContext } from '@/lib/ai-client';
import { downscaleForUpload } from '@/lib/downscale-for-upload';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';
import { maskStore } from '@/core/mask-store';
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
 * Hash of the source-image pixels for the document.
 * Used to decide when to re-analyse the base image (e.g. user replaced the source).
 * Adjustments, new layers, ai-step output do NOT invalidate this.
 */
export function currentImageFingerprint(): string {
  const editor = useEditorStore.getState();
  const firstImage = editor.layers.find((l) => l.type === 'image');
  if (!firstImage) return 'empty';
  const source = pixelStore.getSource(firstImage.id);
  if (!source) return `nopixels:${firstImage.id}`;
  // Use width × height × an arbitrary corner pixel as a cheap content hash.
  // The expensive option (full pixel digest) is unnecessary — we only need to
  // catch source replacement, not adjustment drift.
  const ctx = source instanceof HTMLCanvasElement
    ? source.getContext('2d')
    : (source as OffscreenCanvas).getContext('2d');
  if (!ctx) return `${firstImage.id}:${source.width}x${source.height}`;
  const px = ctx.getImageData(0, 0, 1, 1).data;
  return `${firstImage.id}:${source.width}x${source.height}:${px[0]},${px[1]},${px[2]},${px[3]}`;
}

/**
 * Decode a base64 PNG mask into a Uint8Array of length width×height.
 * Inlined here to avoid a circular import with sam-client (which imports
 * useAiSession from this module).
 */
async function decodeMaskPng(
  pngBase64: string,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const dataUrl = `data:image/png;base64,${pngBase64}`;
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const tmp = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = tmp.getContext('2d');
  if (!ctx) throw new Error('decodeMaskPng: no 2d context');
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const out = new Uint8Array(bitmap.width * bitmap.height);
  for (let i = 0; i < out.length; i++) out[i] = imgData.data[i * 4];
  bitmap.close();
  return { data: out, width: bitmap.width, height: bitmap.height };
}

/**
 * Register backend-refined region masks from an analysed context into
 * the maskStore. Skips regions that have no mask or are already registered.
 * Mutations to `region.maskRef` are intentional — CandidateRegion objects
 * are plain data (not frozen) and this avoids needing a full context clone.
 */
async function registerRegionMasks(context: ImageContext, layerId: string): Promise<void> {
  if (!context.candidateRegions) return;
  for (const region of context.candidateRegions) {
    if (!region.mask || region.maskRef) continue;
    try {
      const { data, width, height } = await decodeMaskPng(region.mask.pngBase64);
      const ref = maskStore.register({
        layerId,
        label: region.label,
        width,
        height,
        data,
        source: 'ai-proposed',
        createdAt: Date.now(),
      });
      region.maskRef = ref;
    } catch (err) {
      console.error('[ImageContext] failed to register region mask:', region.label, err);
    }
  }
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
      const activeLayerId = useEditorStore.getState().activeLayerId
        ?? useEditorStore.getState().layers.find((l) => l.type === 'image')?.id;
      if (activeLayerId) {
        await registerRegionMasks(context, activeLayerId);
      }
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
    const activeLayerId = useEditorStore.getState().activeLayerId
      ?? useEditorStore.getState().layers.find((l) => l.type === 'image')?.id;
    if (activeLayerId) {
      // fire-and-forget: masks are non-blocking enhancements; failures logged inside helper
      void registerRegionMasks(context, activeLayerId);
    }
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

