/** Accept/Discard for genfill widgets. Accept fetches the result asset,
 *  optionally clips it by the SAME mask that was sent to Bria, and lands the
 *  pixels on a NEW layer (never mutating the original). Spec:
 *  docs/superpowers/specs/2026-07-02-genfill-widget-design.md */
import { toast } from '@/components/ui/Toast';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';
import { maskStore } from '@/core/mask-store';
import { pixelStore } from '@/core/pixel-store';
import { putSource } from '@/core/pixel-source-store';
import { backendTools } from '@/lib/backend-tools';
import { editorDocument } from '@/core/document';
import { genfillAssetUrl } from '@/lib/genfill-asset';

interface MaskBitmapLike {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Persist an OffscreenCanvas as a Blob in IDB so Cmd+R reload can rehydrate
 * the layer. Mirrors segment-actions' persistCanvasSource — fire-and-forget.
 */
function persistCanvasSource(layerId: string, canvas: OffscreenCanvas): void {
  const sid =
    useAiSession.getState().sessionId ?? useBackendState.getState().sessionId;
  if (!sid) return;
  void canvas
    .convertToBlob({ type: 'image/png' })
    .then((blob) => putSource(sid, layerId, blob))
    .catch((err) => console.warn('[genfill-actions] persist source failed:', err));
}

/** Zero out alpha outside the mask (destination-in composite with a
 *  white-on-transparent mask canvas, scaled to the target). Exported for
 *  tests only. */
export function __clipCanvasWithMask(canvas: OffscreenCanvas, mask: MaskBitmapLike): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('genfill clip: unable to acquire 2D context');
  const maskCanvas = new OffscreenCanvas(mask.width, mask.height);
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) throw new Error('genfill clip: unable to acquire mask 2D context');
  const maskImg = maskCtx.createImageData(mask.width, mask.height);
  const md = maskImg.data;
  for (let i = 0; i < mask.data.length; i++) {
    const j = i * 4;
    md[j] = 255;
    md[j + 1] = 255;
    md[j + 2] = 255;
    md[j + 3] = mask.data[i];
  }
  maskCtx.putImageData(maskImg, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Aspect ratios equal within a small tolerance. Bria returns the SAME
 *  framing at a capped resolution, so aspect match (not exact dims) is the
 *  correct gate for scale-then-clip. Exported for tests + the widget body. */
export function genfillAspectMatches(
  a: { width: number; height: number },
  b: { width: number; height: number },
): boolean {
  if (a.height === 0 || b.height === 0) return false;
  return Math.abs(a.width / a.height - b.width / b.height) < 0.02;
}

/** Source-image dimensions for an image node: the first image layer's canvas. */
export function genfillNodeDims(
  imageNodeId: string,
): { width: number; height: number } | null {
  const editor = useEditorStore.getState();
  const node = editor.imageNodes[imageNodeId];
  const layerId = node?.layerIds.find(
    (lid) => editor.layers.find((l) => l.id === lid)?.type === 'image',
  );
  const canvas = layerId ? pixelStore.get(layerId) : null;
  return canvas ? { width: canvas.width, height: canvas.height } : null;
}

/** Register the accepted pixels as a new layer ON the source image node —
 *  addLayer alone leaves the layer orphaned (no node's layerIds references
 *  it, so it never renders). Mirrors copyObjectToLayer's attach step.
 *  Exported for tests (canvas-free). */
export function __attachGenfillLayer(
  imageNodeId: string,
  layerId: string,
  name: string,
): void {
  editorDocument.workspace.batch('Genfill layer', () => {
    const editor = useEditorStore.getState();
    editor.addLayer({
      id: layerId,
      type: 'genfill',
      name,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    useEditorStore.setState((s) => {
      const node = s.imageNodes[imageNodeId];
      if (node && !node.layerIds.includes(layerId)) {
        node.layerIds.push(layerId);
      }
    });
    editor.setActiveLayer(layerId);
  });
}

export async function acceptGenfill(
  widgetId: string,
  opts: { clip: boolean },
): Promise<string | null> {
  const snapshot = useBackendState.getState().snapshot;
  const widget = snapshot?.widgets.find((w) => w.id === widgetId);
  const g = widget?.genfill;
  if (!snapshot || !g || g.status !== 'ready' || !g.result) return null;

  const url = genfillAssetUrl(snapshot.sessionId, g.result.assetId);
  let bitmap: ImageBitmap;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`asset fetch → ${resp.status}`);
    bitmap = await createImageBitmap(await resp.blob());
  } catch (err) {
    toast.info(`Generative fill: could not load result — ${String(err)}`);
    return null;
  }

  // Bria caps output resolution, so the result usually comes back SMALLER
  // than the source at the same aspect ratio. Normalize to source dimensions
  // so the layer aligns pixel-for-pixel on the image node; only keep the raw
  // result size when the aspect genuinely differs (can't align — no scaling).
  const nodeDims = genfillNodeDims(g.imageNodeId);
  const scaleToSource = !!nodeDims && genfillAspectMatches(bitmap, nodeDims);
  const width = scaleToSource ? nodeDims.width : bitmap.width;
  const height = scaleToSource ? nodeDims.height : bitmap.height;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);

  if (opts.clip) {
    const mask = maskStore.get(g.maskId);
    if (mask) {
      __clipCanvasWithMask(canvas, mask);
    } else {
      toast.info('Generative fill: mask no longer exists — placing full image.');
    }
  }

  const newId = crypto.randomUUID();
  pixelStore.register(newId, canvas);
  persistCanvasSource(newId, canvas);

  __attachGenfillLayer(g.imageNodeId, newId, `Genfill: ${truncate(g.prompt, 32)}`);

  const env = await backendTools.accept_widget(snapshot.sessionId, { widgetId });
  if (!env.ok) {
    toast.info(`Generative fill: accept failed — ${env.error?.message ?? 'unknown'}`);
  }
  return newId;
}

export async function discardGenfill(widgetId: string): Promise<void> {
  const sessionId = useBackendState.getState().snapshot?.sessionId;
  if (!sessionId) return;
  const env = await backendTools.delete_widget(sessionId, {
    widgetId,
    suppressSimilar: false,
  });
  if (!env.ok) {
    toast.info(`Generative fill: discard failed — ${env.error?.message ?? 'unknown'}`);
  }
}
