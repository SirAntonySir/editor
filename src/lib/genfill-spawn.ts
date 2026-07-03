/** Genfill spawn funnel — every entry point (context menus, Cmd+K) resolves
 *  its source to a maskId and lands here. Spec:
 *  docs/superpowers/specs/2026-07-02-genfill-widget-design.md */
import { toast } from '@/components/ui/Toast';
import { backendTools } from '@/lib/backend-tools';
import { maskStore } from '@/core/mask-store';
import { pixelStore } from '@/core/pixel-store';
import { maskToPngBase64 } from '@/lib/segmentation/mask-png';
import { useAiSession } from '@/hooks/useImageContext';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';

function requireSession(): string | null {
  if (useBackendState.getState().sseStatus !== 'open') {
    toast.info('Backend disconnected — generative fill unavailable.');
    return null;
  }
  // Canonical session id lives on useBackendState (set on connection).
  // useAiSession.sessionId only mirrors it AFTER AI analysis runs, so read
  // the backend store first and fall back to the AI store.
  const sessionId =
    useBackendState.getState().sessionId ?? useAiSession.getState().sessionId;
  if (!sessionId) {
    toast.info('Backend session not ready.');
    return null;
  }
  return sessionId;
}

/** Spawn a genfill widget targeting an existing mask. Empty prompt = compose
 *  state (the widget's prompt field is focused; generation starts on submit). */
export async function spawnGenfillFromMask(
  maskId: string,
  imageNodeId: string,
  prompt = '',
  origin: 'tool_invoked' | 'mcp_user_prompt' = 'tool_invoked',
): Promise<string | null> {
  const sessionId = requireSession();
  if (!sessionId) return null;
  const env = await backendTools.genfill_create(sessionId, {
    imageNodeId,
    maskId,
    prompt,
    origin,
  });
  if (!env.ok) {
    toast.info(`Generative fill failed: ${env.error?.message ?? 'unknown error'}`);
    return null;
  }
  return env.output?.widgetId ?? null;
}

/** Spawn genfill for an object layer: use its layerMask if present, else
 *  rasterize the layer's alpha channel into a new registered mask. */
export async function spawnGenfillFromLayer(
  layerId: string,
  imageNodeId: string,
): Promise<string | null> {
  const sessionId = requireSession();
  if (!sessionId) return null;
  const editor = useEditorStore.getState();
  const layer = editor.layers.find((l) => l.id === layerId);
  if (!layer) return null;

  if (layer.layerMask && maskStore.get(layer.layerMask)) {
    return spawnGenfillFromMask(layer.layerMask, imageNodeId);
  }

  const maskId = await registerLayerAlphaMask(sessionId, layerId, imageNodeId);
  if (!maskId) return null;
  return spawnGenfillFromMask(maskId, imageNodeId);
}

/** Rasterize a layer's alpha channel (alpha ≥ 128 → 255) into a mask and
 *  register it via propose_mask. Returns the new maskId or null. */
async function registerLayerAlphaMask(
  sessionId: string,
  layerId: string,
  imageNodeId: string,
): Promise<string | null> {
  const canvas = pixelStore.getSource(layerId) ?? pixelStore.get(layerId);
  if (!canvas) {
    toast.info('Generative fill: layer has no pixel data.');
    return null;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height);
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] = img.data[i * 4 + 3] >= 128 ? 255 : 0;
  }
  const pngBase64 = await maskToPngBase64({ width, height, data });
  const editor = useEditorStore.getState();
  const layerName = editor.layers.find((l) => l.id === layerId)?.name ?? 'layer';
  const env = await backendTools.propose_mask(sessionId, {
    imageNodeId,
    pngBase64,
    paths: [],
    label: `${layerName} footprint`,
    origin: 'client_new',
  });
  if (!env.ok || !env.output?.maskId) {
    toast.info(`Generative fill: could not register mask — ${env.error?.message ?? 'unknown error'}`);
    return null;
  }
  const maskId = env.output.maskId;
  maskStore.injectWithId({
    id: maskId,
    layerId,
    label: `${layerName} footprint`,
    width,
    height,
    data,
    source: 'brush',
    createdAt: Date.now(),
  });
  return maskId;
}
