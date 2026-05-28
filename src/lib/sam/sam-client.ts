// src/lib/sam/sam-client.ts
import { bindSessionFromFirstImageLayer, useAiSession } from '@/hooks/useImageContext';
import { useEditorStore } from '@/store';
import { maskStore, type Mask, type SamPrompt } from '@/core/mask-store';
import { pixelStore } from '@/core/pixel-store';
import { findBestRegionMatch } from '@/lib/mask-overlap';
import type { MaskRef } from '@/types/scope';

const BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

/**
 * The backend embeds a downscaled copy of the image (longest edge clamped
 * to `UPLOAD_MAX_EDGE`). Prompts must be in that downscaled coordinate
 * space, not the original. Keep this value in sync with
 * `downscale-for-upload.ts:MAX_EDGE`.
 */
const UPLOAD_MAX_EDGE = 1024;

/** Compute the upload-time downscale factor for a layer's source canvas. */
function uploadScaleForLayer(layerId: string): number {
  const source = pixelStore.getSource(layerId);
  if (!source || source.width <= 0 || source.height <= 0) return 1;
  return Math.min(1, UPLOAD_MAX_EDGE / Math.max(source.width, source.height));
}

/**
 * Scale prompt coordinates from the original-image pixel space to the
 * downscaled embedding's pixel space. Labels (the third entry on point
 * prompts) are not scaled.
 */
function scalePromptsForUpload(prompts: SamPrompt[], scale: number): SamPrompt[] {
  if (scale === 1) return prompts;
  return prompts.map((p) => {
    if (p.kind === 'point') {
      const [x, y, label] = p.data;
      return { kind: 'point', data: [x * scale, y * scale, label] };
    }
    // box: [x1, y1, x2, y2]
    return { kind: 'box', data: p.data.map((v) => v * scale) };
  });
}

/**
 * Resolve a backend session id, lazily re-binding from the cached ImageContext
 * if the page was reloaded (context restored from disk, sessionId still null).
 * Mirrors the Cmd+K palette pattern in App.tsx.
 */
async function requireSession(): Promise<string> {
  let sid = useAiSession.getState().sessionId;
  if (sid) return sid;
  if (useAiSession.getState().context) {
    await bindSessionFromFirstImageLayer();
    sid = useAiSession.getState().sessionId;
  }
  if (!sid) throw new Error('samClient: no AI session and no cached context to rebind');
  return sid;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

/**
 * Decode a base64 PNG (single-channel grayscale; backend writes 0 or 255)
 * into a Uint8Array of length width*height.
 */
/**
 * Decode a base64 PNG via an HTMLImageElement. More permissive across browsers
 * than `createImageBitmap` for some edge-case PNG payloads (e.g. mode "L"
 * single-channel PNGs).
 */
function decodeViaImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decodeViaImage: <img> failed to load PNG'));
    img.src = dataUrl;
  });
}

export async function maskPngBase64ToBytes(
  pngBase64: string,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const cleaned = pngBase64.replace(/\s+/g, '');
  if (!cleaned.startsWith('iVBORw0KGgo')) {
    console.warn('[maskPngBase64ToBytes] base64 does not start with PNG signature', cleaned.slice(0, 16));
  }
  const dataUrl = `data:image/png;base64,${cleaned}`;

  // Try createImageBitmap first; fall back to <img> if it produces a 0×0
  // bitmap (some browsers silently fail rather than throw on mode-L PNGs).
  let width = 0;
  let height = 0;
  let drawSource: ImageBitmap | HTMLImageElement | null = null;
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width > 0 && bitmap.height > 0) {
      drawSource = bitmap;
      width = bitmap.width;
      height = bitmap.height;
    } else {
      console.warn('[maskPngBase64ToBytes] createImageBitmap returned 0×0, falling back to <img>');
      bitmap.close();
    }
  } catch (err) {
    console.warn('[maskPngBase64ToBytes] createImageBitmap threw, falling back to <img>:', err);
  }

  if (!drawSource) {
    const img = await decodeViaImage(dataUrl);
    width = img.naturalWidth;
    height = img.naturalHeight;
    drawSource = img;
  }

  if (width === 0 || height === 0) {
    if (drawSource instanceof ImageBitmap) drawSource.close();
    throw new Error(`maskPngBase64ToBytes: decoded image is 0×0 (input ${cleaned.length} chars)`);
  }

  const tmp = new OffscreenCanvas(width, height);
  const ctx = tmp.getContext('2d');
  if (!ctx) throw new Error('maskPngBase64ToBytes: no 2d context');
  ctx.drawImage(drawSource, 0, 0);
  const imgData = ctx.getImageData(0, 0, width, height);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = imgData.data[i * 4];
  if (drawSource instanceof ImageBitmap) drawSource.close();
  return { data: out, width, height };
}

// Per-session embed promise. Dedupes concurrent ensureEmbedding calls so
// rapid tool-activate + click sequences don't fire parallel embed requests
// or race the first decode against an in-flight embed. Invalidated on
// failure or backend-side cache loss (see "not embedded" recovery in
// segment()).
const embedPromises = new Map<string, Promise<void>>();

function embedOnce(sessionId: string): Promise<void> {
  const cached = embedPromises.get(sessionId);
  if (cached) return cached;
  const p = (async () => {
    useEditorStore.getState().setEncoderState('encoding');
    try {
      await postJson('/api/segment/embed', { session_id: sessionId });
      useEditorStore.getState().setEncoderState('ready');
    } catch (err) {
      useEditorStore.getState().setEncoderState('error');
      embedPromises.delete(sessionId);
      throw err;
    }
  })();
  embedPromises.set(sessionId, p);
  return p;
}

export const samClient = {
  async ensureEmbedding(_layerId: string): Promise<void> {
    const sessionId = await requireSession();
    return embedOnce(sessionId);
  },

  async segment(args: {
    layerId: string;
    prompts: SamPrompt[];
    label?: string;
  }): Promise<MaskRef> {
    const sessionId = await requireSession();

    // Wait for the embedding before issuing decode. If onActivate already
    // kicked one off, we await the same promise; if not, this fires the
    // embed lazily. Either way decode never runs before the embed lands,
    // so the "click faster than embed" race is gone.
    await embedOnce(sessionId);

    const scale = uploadScaleForLayer(args.layerId);
    const scaledPrompts = scalePromptsForUpload(args.prompts, scale);

    // Backend can still report "not embedded" if uvicorn --reload dropped
    // its in-memory cache while our frontend kept the (now-stale) resolved
    // embed promise. Invalidate + re-embed + retry once.
    let res: {
      mask_png_base64: string;
      width: number;
      height: number;
      model: string;
    };
    try {
      res = await postJson('/api/segment/decode', {
        session_id: sessionId,
        prompts: scaledPrompts,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('not embedded')) throw err;
      console.warn('[samClient] backend lost embedding — re-embedding and retrying');
      embedPromises.delete(sessionId);
      await embedOnce(sessionId);
      res = await postJson('/api/segment/decode', {
        session_id: sessionId,
        prompts: scaledPrompts,
      });
    }

    if (!res.mask_png_base64 || res.mask_png_base64.length === 0) {
      console.error('[samClient] /api/segment/decode returned empty mask_png_base64', res);
      throw new Error('Segment decode returned an empty mask. The backend likely failed to load the SAM model.');
    }

    console.log('[samClient] decode response', {
      base64Length: res.mask_png_base64.length,
      base64Prefix: res.mask_png_base64.slice(0, 24),
      responseWidth: res.width,
      responseHeight: res.height,
      model: res.model,
    });

    const { data, width, height } = await maskPngBase64ToBytes(res.mask_png_base64);
    if (width === 0 || height === 0) {
      console.error('[samClient] decoded mask has zero dimensions', { responseMeta: { width: res.width, height: res.height, model: res.model } });
      throw new Error(`Segment decode produced a 0×0 mask (backend said ${res.width}×${res.height}).`);
    }

    // Region-aware fusion (Plan 3): if the freshly produced mask significantly
    // overlaps a Claude-named region for this layer, inherit that region's
    // label. Lets the LLM and user see "subject" / "sky" instead of an
    // anonymous SAM blob. Explicit caller label still wins.
    const fusedLabel = args.label ?? fuseLabelFromRegions(
      args.layerId,
      { width, height, data },
    );

    return maskStore.register({
      layerId: args.layerId,
      label: fusedLabel,
      width,
      height,
      data,
      source: args.prompts.length > 1
        ? 'sam-points'
        : args.prompts[0]?.kind === 'box'
        ? 'sam-box'
        : 'sam-point',
      prompts: args.prompts,
      createdAt: Date.now(),
    });
  },
};

/**
 * Compare a freshly produced SAM mask against every Claude-named region
 * registered for the same layer. If one overlaps significantly, return
 * its label. Returns `undefined` when no region passes the thresholds.
 */
function fuseLabelFromRegions(
  layerId: string,
  newMask: { width: number; height: number; data: Uint8Array },
): string | undefined {
  const context = useAiSession.getState().context;
  if (!context?.candidateRegions) return undefined;

  const candidates: Array<{ label: string; mask: Mask; maskRef: string }> = [];
  for (const region of context.candidateRegions) {
    if (!region.maskRef) continue;
    const mask = maskStore.get(region.maskRef);
    if (!mask || mask.layerId !== layerId) continue;
    candidates.push({ label: region.label, mask, maskRef: region.maskRef });
  }
  if (candidates.length === 0) return undefined;

  const probe: Mask = {
    id: 'probe',
    layerId,
    width: newMask.width,
    height: newMask.height,
    data: newMask.data,
    source: 'sam-point',
    createdAt: 0,
  };
  const match = findBestRegionMatch(probe, candidates);
  if (!match) return undefined;
  console.log('[samClient] region fusion:', {
    label: match.label,
    iou: match.iou.toFixed(3),
    containment: match.containment.toFixed(3),
    matchedBy: match.matchedBy,
  });
  return match.label;
}
