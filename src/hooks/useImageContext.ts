import { create } from 'zustand';
import { analyzeImage, createSession, pushSessionContext } from '@/lib/ai-client';
import { downscaleForUpload } from '@/lib/downscale-for-upload';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';
import { maskStore } from '@/core/mask-store';
import { maskPngBase64ToBytes } from '@/lib/sam/sam-client';
import type { ImageContext, RegionPolygon } from '@/types/image-context';

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
 * Rasterise normalised-coordinate polygon paths into a single-channel
 * Uint8Array mask at the target resolution. Pixels inside any polygon are
 * `255`, everything else `0`. Uses Canvas2D `fill()` with even-odd rule so
 * nested polygons cut out holes.
 */
function rasterisePathsToMask(
  paths: RegionPolygon[],
  width: number,
  height: number,
): Uint8Array | null {
  if (width <= 0 || height <= 0 || paths.length === 0) return null;
  const tmp = new OffscreenCanvas(width, height);
  const ctx = tmp.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'white';
  const path = new Path2D();
  for (const poly of paths) {
    if (poly.length < 3) continue;
    path.moveTo(poly[0][0] * width, poly[0][1] * height);
    for (let i = 1; i < poly.length; i++) {
      path.lineTo(poly[i][0] * width, poly[i][1] * height);
    }
    path.closePath();
  }
  ctx.fill(path, 'evenodd');
  const imgData = ctx.getImageData(0, 0, width, height);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = imgData.data[i * 4];
  return out;
}

/**
 * Register each region's mask in `maskStore` so the existing scope/shader
 * pipeline can consume them via `maskRef`.
 *
 * Two sources, in priority order:
 *   1. `mask_png_base64` — raw SAM mask returned by `/api/analyze`.
 *      Pixel-accurate, no roundtrip. Preferred path.
 *   2. `paths` — polygon contours. Lossy fallback used only when the backend
 *      didn't ship a PNG (cached contexts predating this change).
 *
 * Regions without either are skipped (no chip will render).
 */
async function registerRegionPaths(context: ImageContext, layerId: string): Promise<void> {
  if (!context.candidateRegions) return;
  const source = pixelStore.getSource(layerId);
  if (!source) return;
  const width = source.width;
  const height = source.height;
  if (width <= 0 || height <= 0) {
    console.warn('[ImageContext] source has zero dimensions, skipping region registration', { layerId, width, height });
    return;
  }
  for (const region of context.candidateRegions) {
    if (region.maskRef && maskStore.get(region.maskRef)) continue;
    region.maskRef = undefined;

    let maskWidth = width;
    let maskHeight = height;
    let data: Uint8Array | null = null;

    if (region.maskPngBase64) {
      try {
        const decoded = await maskPngBase64ToBytes(region.maskPngBase64);
        data = decoded.data;
        maskWidth = decoded.width;
        maskHeight = decoded.height;
      } catch (err) {
        console.warn('[ImageContext] failed to decode mask PNG for region:', region.label, err);
      }
    }

    if (!data) {
      if (!region.paths || region.paths.length === 0) continue;
      data = rasterisePathsToMask(region.paths, width, height);
      maskWidth = width;
      maskHeight = height;
      if (!data) {
        console.warn('[ImageContext] failed to rasterise paths for region:', region.label);
        continue;
      }
    }

    const ref = maskStore.register({
      layerId,
      label: region.label,
      width: maskWidth,
      height: maskHeight,
      data,
      source: 'ai-proposed',
      createdAt: Date.now(),
    });
    region.maskRef = ref;
  }
}

/**
 * A cached context is considered stale if it has candidate regions but none
 * of them carry the new `paths` field — that means the cache predates the
 * polygon-paths migration and the user should re-analyse. Returning `true`
 * causes restoreContext to discard the cache so the UI can prompt a fresh run.
 */
function contextIsStale(context: ImageContext): boolean {
  const regions = context.candidateRegions ?? [];
  if (regions.length === 0) return false;
  return regions.every((r) => !r.paths || r.paths.length === 0);
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
        await registerRegionPaths(context, activeLayerId);
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
    if (contextIsStale(context)) {
      // Predates the polygon-paths migration — drop it so the UI prompts a
      // fresh analyse instead of showing a context with no usable segments.
      console.warn('[ImageContext] discarding stale cached context (no paths) — re-analyse needed');
      set({ sessionId: null, context: null, status: 'idle', error: null, lastAnalysedFingerprint: null });
      return;
    }
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
      void registerRegionPaths(context, activeLayerId);
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

