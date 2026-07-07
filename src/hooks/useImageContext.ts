import { create } from 'zustand';
import { createSession, pushSessionContext } from '@/lib/ai-client';
import { backendTools } from '@/lib/backend-tools';
import { downscaleForUpload } from '@/lib/downscale-for-upload';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { pixelStore } from '@/core/pixel-store';
import { maskStore } from '@/core/mask-store';
import { maskPngBase64ToBytes } from '@/lib/sam/sam-client';
import type { ImageContext, RegionPolygon } from '@/types/image-context';

import { BACKEND_BASE_URL as BASE_URL } from '@/lib/backend-url';

type UploadSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

/** Options for the analyze pipeline. */
export interface AnalyseOptions {
  /** When true, also run the autonomous `suggest_widgets` proposals after
   *  context + region precompute. Defaults to **false** — analysis is
   *  suggestion-free; suggestions are opt-in via "Suggest something". */
  suggest?: boolean;
}

interface AiSessionState {
  sessionId: string | null;
  context: ImageContext | null;
  status: 'idle' | 'uploading' | 'analysing' | 'ready' | 'error';
  error: string | null;
  /** image-node ids whose analyse has completed at least once this session.
   *  Updated by analyseImageLayer on success. Pruned when image-nodes are
   *  removed (worst case: a stale flag pointing at a vanished id, which only
   *  affects the menu label and harmlessly shows "Re-analyze"). */
  analysedImageNodeIds: string[];
  /** Mark an image-node as having been analysed. Idempotent. */
  markAnalysed: (imageNodeId: string) => void;
  /** Upload source pixels + create a backend session. No analyze — tools
   *  that just need a session for `set_param` writes (the toolrail
   *  adjustments) become usable as soon as this resolves and SSE handshakes.
   *  Idempotent: no-op when a session is already open. */
  openSession: (source: UploadSource) => Promise<void>;
  /** Resolve once a backend session id is available, or `null` if none is
   *  coming. Returns the id immediately when already open; when a bootstrap is
   *  in flight (`status === 'uploading'`), waits for it to land (or fail);
   *  otherwise resolves `null` at once. Lets callers that run BEFORE the
   *  async `openSession` finishes (e.g. `addImage` during a multi-file drop)
   *  persist/upload under the right session instead of silently dropping it. */
  awaitSession: (timeoutMs?: number) => Promise<string | null>;
  /** Run the analyze pipeline on the CURRENT session. Requires a session
   *  to already exist (call `openSession` first or use `uploadAndAnalyse`).
   *  Pass `{ suggest: false }` to build context + regions WITHOUT the
   *  autonomous widget proposals — used when analyze is just a precursor to a
   *  user-prompt agent turn (the prompt drives the proposals, not analyze). */
  runAnalyse: (opts?: AnalyseOptions) => Promise<void>;
  /** Convenience: `openSession` then `runAnalyse`. Equivalent to the old
   *  monolithic upload-then-analyze call, kept for compat / one-shot use. */
  uploadAndAnalyse: (source: UploadSource, opts?: AnalyseOptions) => Promise<void>;
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

/**
 * Pick which image layer the AI should target. Prefers the layer of the
 * currently active ImageNode on the canvas (so the user's selection drives
 * analysis), then falls back to `activeLayerId`, then the first image layer
 * in the document. Returns null only when the document has no image layers.
 */
export function resolveTargetImageLayerId(): string | null {
  const editor = useEditorStore.getState();
  const { activeImageNodeId, imageNodes, layers, activeLayerId } = editor;
  if (activeImageNodeId) {
    const node = imageNodes[activeImageNodeId];
    if (node) {
      for (const lid of node.layerIds) {
        if (layers.find((l) => l.id === lid)?.type === 'image') return lid;
      }
    }
  }
  if (activeLayerId && layers.find((l) => l.id === activeLayerId)?.type === 'image') {
    return activeLayerId;
  }
  return layers.find((l) => l.type === 'image')?.id ?? null;
}

export const useAiSession = create<AiSessionState>((set, get, api) => ({
  sessionId: null,
  context: null,
  status: 'idle',
  error: null,
  analysedImageNodeIds: [],
  markAnalysed: (imageNodeId) =>
    set((s) => ({
      analysedImageNodeIds: s.analysedImageNodeIds.includes(imageNodeId)
        ? s.analysedImageNodeIds
        : [...s.analysedImageNodeIds, imageNodeId],
    })),
  async openSession(source) {
    // Idempotent: if a session is already alive, do nothing. Reset() must
    // run first when the caller wants a fresh session for a new image.
    if (get().sessionId) return;
    set({ status: 'uploading', error: null, context: null });
    try {
      const blob = await downscaleForUpload(source);
      const sessionId = await createSession(blob);
      // status drops back to 'idle' — the session is alive (tools usable)
      // but no AI context has been computed yet. Click "Analyze with AI"
      // to call runAnalyse() and populate context.
      set({ sessionId, status: 'idle' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ImageContext] openSession failed:', msg, err);
      set({ status: 'error', error: msg });
    }
  },
  awaitSession(timeoutMs = 15000) {
    const { sessionId, status } = get();
    if (sessionId) return Promise.resolve(sessionId);
    // Only wait when a bootstrap is actually in flight; otherwise there is no
    // session coming and we must not hang the caller.
    if (status !== 'uploading') return Promise.resolve(null);
    return new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve(value);
      };
      const timer = setTimeout(() => finish(get().sessionId ?? null), timeoutMs);
      const unsub = api.subscribe((s) => {
        if (s.sessionId) finish(s.sessionId);
        else if (s.status === 'error' || s.status === 'idle') finish(null);
      });
    });
  },
  async runAnalyse(opts) {
    // Suggestions are opt-in: "Analyze with AI" builds context + regions only.
    // Autonomous proposals fire solely via the explicit "Suggest something"
    // path (suggestForImageNode / runAnalyse({suggest:true})).
    const suggest = opts?.suggest ?? false;
    const sessionId = get().sessionId;
    if (!sessionId) {
      console.warn('[ImageContext] runAnalyse: no session — call openSession first');
      return;
    }
    set({ status: 'analysing' });
    try {
      const activeLayerId = resolveTargetImageLayerId();

      // Phase 1: prepare (cv2 + SAM embed). Required before analyze_context;
      // its output is reused server-side via doc.prepare_result.
      await backendTools.prepare_image(sessionId);
      if (get().sessionId !== sessionId) return;

      // Phase 2: Claude analyze + soft fields + region stats. This is what
      // the user perceives as "analyze done". Block on it; everything else
      // streams off the critical path.
      const ctxEnv = await backendTools.analyze_context(
        sessionId,
        activeLayerId ? { layerId: activeLayerId } : {},
      );
      if (get().sessionId !== sessionId) return;
      if (!ctxEnv.ok || !ctxEnv.output) {
        console.error('[ImageContext] runAnalyse: tool error', ctxEnv.error);
        set({
          status: 'error',
          error: ctxEnv.error?.message ?? 'analyze_context failed',
        });
        return;
      }
      // The backend emits camelCase on the wire (Phase 1 Task 1.1).
      // Cast directly — no Zod transform needed.
      const context = ctxEnv.output as ImageContext;
      console.log('[ImageContext]', context);

      if (activeLayerId) {
        await registerRegionPaths(context, activeLayerId);
      }
      set({ context, status: 'ready' });

      // Belt-and-braces snapshot refetch: the SSE deltas already populated
      // `snapshot.image_context` for the InfoTab; this picks up any widget /
      // op_graph / masks_index state that landed alongside.
      try {
        const resp = await fetch(`${BASE_URL}/api/state/${sessionId}`);
        if (resp.ok) {
          const snap = await resp.json();
          useBackendState.getState().setSnapshot(snap);
        }
      } catch {
        // SSE merges cover the user-facing fields; this is just cleanup.
      }

      // Phase 3 + 4: fire-and-forget, but SERIALIZED. Each mutate tool
      // takes the per-session document write_lock on the backend (sync
      // threading.Lock acquired from inside an async handler). If we fired
      // these in parallel, the second tool would block the event-loop
      // thread on lock.acquire() while the first was awaiting work in the
      // thread pool — classic deadlock. Chaining them keeps the lock held
      // by at most one tool at a time. SSE updates still stream into the
      // store as each completes.
      // TODO: convert backend write_lock to asyncio.Lock; remove this chain.
      //
      // `suggest_widgets` (autonomous proposals) is gated on `suggest`: when
      // analyze is just a precursor to a user-prompt agent turn, we skip it so
      // the only proposals the user sees come from their prompt. Region
      // precompute still runs either way (the agent / picker needs regions).
      void backendTools.precompute_regions(sessionId)
        .catch((err) => {
          console.warn('[ImageContext] precompute_regions failed:', err);
        })
        .then(() => {
          if (!suggest) {
            // Analysis-only: the terminal `widget_mint` phase won't fire, so
            // push the status card to its end state ourselves.
            useBackendState.getState().markAnalyzeComplete();
            return;
          }
          return backendTools.suggest_widgets(
            sessionId,
            activeLayerId ? { layerId: activeLayerId } : {},
          ).catch((err) => {
            console.warn('[ImageContext] suggest_widgets failed:', err);
          });
        });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ImageContext] runAnalyse failed:', msg, err);
      set({ status: 'error', error: msg });
    }
  },
  async uploadAndAnalyse(source, opts) {
    await get().openSession(source);
    if (get().sessionId) await get().runAnalyse(opts);
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
      set({ sessionId: null, context: null, status: 'idle', error: null });
      return;
    }
    console.log('[ImageContext] (restored from disk)', context);
    set({
      context,
      status: 'ready',
      error: null,
    });
    const activeLayerId = resolveTargetImageLayerId();
    if (activeLayerId) {
      void registerRegionPaths(context, activeLayerId);
    }
  },
  reset() {
    set({ sessionId: null, context: null, status: 'idle', error: null, analysedImageNodeIds: [] });
  },
}));

/**
 * Resolve the first photo-type layer id for the given image-node id.
 * Returns null when the node doesn't exist or has no image layers.
 */
function resolveLayerIdForImageNode(imageNodeId: string): string | null {
  const { imageNodes, layers } = useEditorStore.getState();
  const node = imageNodes[imageNodeId];
  if (!node) return null;
  for (const lid of node.layerIds) {
    if (layers.find((l) => l.id === lid)?.type === 'image') return lid;
  }
  return node.layerIds[0] ?? null;
}

/**
 * Run AI analyze for a specific image-node. If a session is already alive
 * just calls `runAnalyse` (the session's own layer resolution picks up the
 * explicit id via `resolveTargetImageLayerId`). When no session exists,
 * uploads the target layer's pixels first. This lets per-node context-menu
 * items target an image that is not the current `activeImageNodeId`.
 */
export async function analyseImageLayer(
  imageNodeId: string,
  opts?: AnalyseOptions,
): Promise<void> {
  const { setActiveImageNode, activeImageNodeId } = useEditorStore.getState();
  // Temporarily promote this node to active so `resolveTargetImageLayerId`
  // inside `runAnalyse` picks the right layer. Restore the previous active
  // node only if it was different — avoids a spurious state write on
  // re-clicking the already-active node.
  const prevActive = activeImageNodeId;
  if (prevActive !== imageNodeId) setActiveImageNode(imageNodeId);

  const ai = useAiSession.getState();
  if (ai.sessionId) {
    await ai.runAnalyse(opts);
  } else {
    const targetLayerId = resolveLayerIdForImageNode(imageNodeId);
    if (!targetLayerId) return;
    const source = pixelStore.getSource(targetLayerId);
    if (!source) return;
    const bitmap = await createImageBitmap(source);
    await ai.uploadAndAnalyse(bitmap, opts);
  }

  // Mark this node as analysed if the session completed without error.
  // Check status rather than catching — runAnalyse/uploadAndAnalyse set
  // status:'ready' on success and status:'error' on failure.
  if (useAiSession.getState().status === 'ready') {
    useAiSession.getState().markAnalysed(imageNodeId);
  }
}

/**
 * Explicit "Suggest something" trigger for a specific image-node. Autonomous
 * suggestions are opt-in (analyze no longer fires them), so this is the sole
 * user-facing path to the SuggestionChips stack.
 *
 * When the image hasn't been analyzed yet, runs a full analyze-with-suggest for
 * the node. When context already exists, skips the (expensive) re-analyze and
 * just asks the backend to (re)suggest for that node's image layer.
 */
export async function suggestForImageNode(imageNodeId: string): Promise<void> {
  const ai = useAiSession.getState();
  if (!ai.context || !ai.sessionId) {
    await analyseImageLayer(imageNodeId, { suggest: true });
    return;
  }
  const { setActiveImageNode, activeImageNodeId } = useEditorStore.getState();
  if (activeImageNodeId !== imageNodeId) setActiveImageNode(imageNodeId);
  const layerId = resolveTargetImageLayerId();
  await backendTools.suggest_widgets(ai.sessionId, layerId ? { layerId } : {});
}

/**
 * Run AI analyze for the active image layer (the one belonging to the
 * currently selected ImageNode on the canvas, falling back to activeLayerId
 * or the document's first image layer). If a session is already alive
 * (the normal case now — `editorDocument.openImage` opens one on image
 * load), just call `runAnalyse`. Otherwise upload pixels first via
 * `uploadAndAnalyse`. Used by the Info tab "Analyze with AI" CTA, by
 * `.edp` open, and by IndexedDB session-restore.
 */
export async function analyseActiveImageLayer(opts?: AnalyseOptions): Promise<void> {
  const activeImageNodeId = useEditorStore.getState().activeImageNodeId;
  if (activeImageNodeId) {
    return analyseImageLayer(activeImageNodeId, opts);
  }
  const ai = useAiSession.getState();
  if (ai.sessionId) {
    await ai.runAnalyse(opts);
    return;
  }
  const targetLayerId = resolveTargetImageLayerId();
  if (!targetLayerId) return;
  const source = pixelStore.getSource(targetLayerId);
  if (!source) return;
  const bitmap = await createImageBitmap(source);
  await ai.uploadAndAnalyse(bitmap, opts);
}

/**
 * Lazy-bind a backend session from the active image layer's pixels, using
 * the cached `ImageContext` if available (no Claude call). Falls back to a
 * full `uploadAndAnalyse` if no cached context.
 *
 * Called from `handlePaletteSubmit` when the user invokes Cmd+K after a
 * reload — the cached context is on disk but the backend session has died.
 */
export async function bindSessionFromActiveImageLayer(): Promise<void> {
  if (useAiSession.getState().sessionId) return;
  const targetLayerId = resolveTargetImageLayerId();
  if (!targetLayerId) return;
  const source = pixelStore.getSource(targetLayerId);
  if (!source) return;
  const bitmap = await createImageBitmap(source);
  await useAiSession.getState().bindCachedSession(bitmap);
}

/**
 * Read the latest analysis context from the backend snapshot. Replaces
 * the deleted `useImageContextFull`. Prefer this over `useAiSession.context`
 * when you want SSE-merged partial updates (e.g. soft fields arriving
 * mid-analyze); use `useAiSession.context` when you want the final
 * post-runAnalyse value.
 */
export function useImageContextSnapshot(): ImageContext | null {
  return useBackendState((s) => s.snapshot?.imageContext ?? null);
}

