import * as Comlink from 'comlink';
import type { EncodeResult, PromptInput, DecodeResult } from '@/workers/sam.worker';
import { pixelStore } from '@/core/pixel-store';
import { maskStore, type SamPrompt } from '@/core/mask-store';
import { useEditorStore } from '@/store';
import type { MaskRef } from '@/types/scope';

interface SamWorkerApi {
  encode(imageData: ImageData): Promise<EncodeResult>;
  decode(args: {
    embedding: Float32Array;
    embeddingShape: number[];
    prompts: PromptInput;
    outputSize: [number, number];
  }): Promise<DecodeResult>;
}

let workerProxy: Comlink.Remote<SamWorkerApi> | null = null;

function ensureWorker(): Comlink.Remote<SamWorkerApi> {
  if (!workerProxy) {
    const w = new Worker(new URL('../../workers/sam.worker.ts', import.meta.url), { type: 'module' });
    workerProxy = Comlink.wrap<SamWorkerApi>(w);
  }
  return workerProxy;
}

interface CachedEmbedding {
  embedding: Float32Array;
  embeddingShape: number[];
  originalSize: [number, number];
}

const embeddingCache = new Map<string, CachedEmbedding>();

function embeddingKey(layerId: string, hash: string): string {
  return `${layerId}:${hash}`;
}

/** Cheap content hash: dimensions + corner pixel. */
function sourceHash(source: OffscreenCanvas): string {
  const ctx = source.getContext('2d');
  if (!ctx) return `${source.width}x${source.height}`;
  const px = ctx.getImageData(0, 0, 1, 1).data;
  return `${source.width}x${source.height}:${px[0]},${px[1]},${px[2]},${px[3]}`;
}

const SAM_INPUT_SIZE = 1024;

function resizeToInput(source: OffscreenCanvas): ImageData {
  const tmp = new OffscreenCanvas(SAM_INPUT_SIZE, SAM_INPUT_SIZE);
  const ctx = tmp.getContext('2d');
  if (!ctx) throw new Error('samClient: 2d context unavailable for resize');
  ctx.drawImage(source, 0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE);
  return ctx.getImageData(0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE);
}

export const samClient = {
  async ensureEmbedding(layerId: string): Promise<void> {
    const source = pixelStore.getSource(layerId);
    if (!source) throw new Error(`samClient: no source for layer ${layerId}`);
    const hash = sourceHash(source);
    const key = embeddingKey(layerId, hash);
    if (embeddingCache.has(key)) return;

    useEditorStore.getState().setEncoderState('loading-model');
    const worker = ensureWorker();
    useEditorStore.getState().setEncoderState('encoding');
    try {
      const resized = resizeToInput(source);
      const result = await worker.encode(resized);
      embeddingCache.set(key, {
        embedding: result.embedding,
        embeddingShape: result.embeddingShape,
        originalSize: [source.width, source.height],
      });
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
    const source = pixelStore.getSource(args.layerId);
    if (!source) throw new Error(`samClient: no source for layer ${args.layerId}`);
    const hash = sourceHash(source);
    const key = embeddingKey(args.layerId, hash);
    const cached = embeddingCache.get(key);
    if (!cached) {
      await this.ensureEmbedding(args.layerId);
      return this.segment(args);
    }

    const pointArr: number[] = [];
    const labelArr: number[] = [];
    for (const p of args.prompts) {
      if (p.kind === 'point') {
        pointArr.push(p.data[0], p.data[1]);
        labelArr.push(p.data[2]);
      } else {
        // Box: 4 points encoded as two corner-pair points with labels 2 (top-left) and 3 (bottom-right)
        pointArr.push(p.data[0], p.data[1], p.data[2], p.data[3]);
        labelArr.push(2, 3);
      }
    }

    // SAM expects prompt coords in the resized 1024×1024 space.
    const sx = SAM_INPUT_SIZE / cached.originalSize[0];
    const sy = SAM_INPUT_SIZE / cached.originalSize[1];
    const scaledCoords = new Float32Array(pointArr.length);
    for (let i = 0; i < pointArr.length; i += 2) {
      scaledCoords[i] = pointArr[i] * sx;
      scaledCoords[i + 1] = pointArr[i + 1] * sy;
    }

    const worker = ensureWorker();
    const result = await worker.decode({
      embedding: cached.embedding,
      embeddingShape: cached.embeddingShape,
      prompts: {
        pointCoords: scaledCoords,
        pointLabels: Float32Array.from(labelArr),
        origImageSize: cached.originalSize,
      },
      outputSize: cached.originalSize,
    });

    const maskRef = maskStore.register({
      layerId: args.layerId,
      label: args.label,
      width: result.width,
      height: result.height,
      data: result.maskData,
      source: args.prompts.length > 1
        ? 'sam-points'
        : args.prompts[0]?.kind === 'box'
        ? 'sam-box'
        : 'sam-point',
      prompts: args.prompts,
      createdAt: Date.now(),
    });
    return maskRef;
  },
};
