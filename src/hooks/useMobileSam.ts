import { useCallback, useEffect, useRef, useState } from 'react';
import { decode as samDecode, encode as samEncode } from '@/lib/segmentation/mobile-sam-client';
import { detectSamCapability } from '@/lib/segmentation/sam-capability';
import type { DecodedMask, EncoderEmbedding, SamPoint } from '@/lib/segmentation/mobile-sam-types';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { useEditorStore } from '@/store';

const _cache = new Map<string, EncoderEmbedding>();

export interface UseMobileSam {
  ready: boolean;
  error: Error | null;
  decode: (points: SamPoint[]) => Promise<DecodedMask | null>;
}

export function useMobileSam(imageNodeId: string | null): UseMobileSam {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const capabilityRef = useRef<'webgpu' | 'wasm' | 'backend' | null>(null);
  const embeddingRef = useRef<EncoderEmbedding | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!imageNodeId) {
      setReady(false);
      embeddingRef.current = null;
      return;
    }
    setReady(false);
    setError(null);

    (async () => {
      try {
        const cap = await detectSamCapability();
        if (cancelled) return;
        capabilityRef.current = cap;
        if (cap === 'backend') {
          // Backend fallback path — decode() returns null; caller hits
          // propose_mask MCP tool instead.
          setReady(true);
          return;
        }

        // Check cache.
        const cached = _cache.get(imageNodeId);
        if (cached) {
          embeddingRef.current = cached;
          setReady(true);
          return;
        }

        // Find this imageNode's first image layer, load the bitmap, run encoder.
        const imageNode = useEditorStore.getState().imageNodes[imageNodeId];
        const layerId = imageNode?.layerIds[0];
        if (!layerId) {
          throw new Error(`imageNode ${imageNodeId} has no layers`);
        }
        const source = CanvasRegistry.getSource(layerId);
        if (!source) {
          throw new Error(`no pixel source for layer ${layerId}`);
        }
        const bitmap = await createImageBitmap(source);
        try {
          const emb = await samEncode(bitmap);
          if (cancelled) {
            bitmap.close();
            return;
          }
          _cache.set(imageNodeId, emb);
          embeddingRef.current = emb;
          setReady(true);
        } finally {
          bitmap.close();
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setReady(false);
      }
    })();

    return () => { cancelled = true; };
  }, [imageNodeId]);

  const decode = useCallback(async (points: SamPoint[]): Promise<DecodedMask | null> => {
    if (capabilityRef.current === 'backend') return null;
    if (!embeddingRef.current) return null;
    return samDecode(embeddingRef.current, points);
  }, []);

  return { ready, error, decode };
}

/** Drop the cached embedding for one image node. Call when the layer is
 *  removed or pixels are replaced. */
export function clearMobileSamCache(imageNodeId: string): void {
  _cache.delete(imageNodeId);
}

/** Test-only: clear the entire cache. */
export function _resetMobileSamCacheForTests(): void {
  _cache.clear();
}
