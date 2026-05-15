// src/lib/sam/sam-client.ts
import { useAiSession } from '@/hooks/useImageContext';
import { useEditorStore } from '@/store';
import { maskStore, type SamPrompt } from '@/core/mask-store';
import type { MaskRef } from '@/types/scope';

const API_BASE = '/api';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
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
export async function maskPngBase64ToBytes(
  pngBase64: string,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const dataUrl = `data:image/png;base64,${pngBase64}`;
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const tmp = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = tmp.getContext('2d');
  if (!ctx) throw new Error('maskPngBase64ToBytes: no 2d context');
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const out = new Uint8Array(bitmap.width * bitmap.height);
  for (let i = 0; i < out.length; i++) out[i] = imgData.data[i * 4];
  bitmap.close();
  return { data: out, width: bitmap.width, height: bitmap.height };
}

export const samClient = {
  async ensureEmbedding(_layerId: string): Promise<void> {
    const sessionId = useAiSession.getState().sessionId;
    if (!sessionId) throw new Error('samClient.ensureEmbedding: no AI session');
    useEditorStore.getState().setEncoderState('encoding');
    try {
      await postJson('/segment/embed', { session_id: sessionId });
      useEditorStore.getState().setEncoderState('ready');
    } catch (err) {
      useEditorStore.getState().setEncoderState('error');
      throw err;
    }
  },

  async segment(args: {
    layerId: string;
    prompts: SamPrompt[];
    label?: string;
  }): Promise<MaskRef> {
    const sessionId = useAiSession.getState().sessionId;
    if (!sessionId) throw new Error('samClient.segment: no AI session');

    const res = await postJson<{
      mask_png_base64: string;
      width: number;
      height: number;
      model: string;
    }>('/segment/decode', {
      session_id: sessionId,
      prompts: args.prompts,
    });

    const { data, width, height } = await maskPngBase64ToBytes(res.mask_png_base64);
    return maskStore.register({
      layerId: args.layerId,
      label: args.label,
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
