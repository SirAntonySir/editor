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

    // Detect capability EAGERLY but defer the encoder run. ORT-Web's WASM
    // runtime + the ~26 MB ONNX weights only load when the user actually
    // invokes refinement (first shift/cmd-click). This matches the design
    // spec's "dynamic import behind first object-mode entry" — entering
    // object mode no longer pays the bundle cost.
    (async () => {
      try {
        const cap = await detectSamCapability();
        if (cancelled) return;
        capabilityRef.current = cap;
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => { cancelled = true; };
  }, [imageNodeId]);

  const decode = useCallback(async (points: SamPoint[]): Promise<DecodedMask | null> => {
    if (capabilityRef.current === 'backend') return null;
    if (!imageNodeId) return null;

    // Lazy encoder: on the first decode call for this imageNodeId, fetch
    // the bitmap from CanvasRegistry, run the encoder, cache the embedding.
    // Subsequent decodes reuse the cached embedding (~20 ms each).
    if (!embeddingRef.current) {
      const cached = _cache.get(imageNodeId);
      if (cached) {
        embeddingRef.current = cached;
      } else {
        const imageNode = useEditorStore.getState().imageNodes[imageNodeId];
        const layerId = imageNode?.layerIds[0];
        if (!layerId) return null;
        const source = CanvasRegistry.getSource(layerId);
        if (!source) return null;
        const bitmap = await createImageBitmap(source);
        try {
          const emb = await samEncode(bitmap);
          _cache.set(imageNodeId, emb);
          embeddingRef.current = emb;
        } catch (err) {
          setError(err instanceof Error ? err : new Error(String(err)));
          return null;
        } finally {
          bitmap.close();
        }
      }
    }
    return samDecode(embeddingRef.current, points);
  }, [imageNodeId]);

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
