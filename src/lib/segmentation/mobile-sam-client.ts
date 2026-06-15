/**
 * MobileSAM client — ONNX Runtime Web wrapper.
 *
 * Two ONNX sessions: encoder (~10 MB) and decoder (~16 MB INT8). Both
 * load lazily via dynamic import when the first call comes in, keeping
 * them out of the initial bundle.
 *
 * Asset paths: `public/models/mobile-sam/{encoder,decoder}.onnx`.
 * Users without these files will see `loadSessions()` reject with a
 * clear error; downstream consumers (useMobileSam) fall back to
 * backend SAM via the `propose_mask` MCP tool.
 */
import type {
  DecodedMask, EncoderEmbedding, SamPoint,
} from './mobile-sam-types';

type OrtModule = typeof import('onnxruntime-web');
type InferenceSession = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>;

interface Sessions {
  ort: OrtModule;
  encoder: InferenceSession;
  decoder: InferenceSession;
}

const ENCODER_URL = '/models/mobile-sam/encoder.onnx';
const DECODER_URL = '/models/mobile-sam/decoder.onnx';

let _sessionsPromise: Promise<Sessions> | null = null;

/** Load ORT + the two ONNX sessions once per page lifetime. Idempotent. */
export async function loadSessions(): Promise<Sessions> {
  if (!_sessionsPromise) {
    _sessionsPromise = (async () => {
      const ort = await import('onnxruntime-web');
      ort.env.wasm.numThreads = 1;
      // ORT-Web fetches its bundled WASM/glue at runtime. Vite doesn't serve
      // them by default, so they're copied to public/ort/ by
      // scripts/download_mobile_sam.sh. Setting wasmPaths points ORT at that
      // mirror; otherwise the streaming compile pulls index.html and dies
      // with "expected magic word 00 61 73 6d, found 3c 21 64 6f".
      ort.env.wasm.wasmPaths = '/ort/';
      const [encoder, decoder] = await Promise.all([
        ort.InferenceSession.create(ENCODER_URL, {
          executionProviders: ['webgpu', 'wasm'],
        }),
        ort.InferenceSession.create(DECODER_URL, {
          executionProviders: ['webgpu', 'wasm'],
        }),
      ]);
      return { ort, encoder, decoder };
    })();
  }
  return _sessionsPromise;
}

/** Run the encoder on an image. Returns an opaque embedding the decoder
 *  consumes. Caller is responsible for caching per imageNodeId — this
 *  function always runs the encoder when called. */
export async function encode(image: ImageBitmap): Promise<EncoderEmbedding> {
  const { ort, encoder } = await loadSessions();
  // MobileSAM encoder expects 1024×1024 float32 RGB in CHW order.
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const tensor = await imageToTensor(ort, image, 1024);
  const output = await encoder.run({ input_image: tensor });
  // The encoder's output key depends on the export. The official
  // ChaoningZhang/MobileSAM export uses "image_embeddings".
  const embedding = output.image_embeddings ?? Object.values(output)[0];
  return { imageWidth: sourceWidth, imageHeight: sourceHeight, embedding };
}

/** Decode a mask from click prompts against a cached encoder embedding. */
export async function decode(
  embedding: EncoderEmbedding,
  points: SamPoint[],
): Promise<DecodedMask> {
  if (points.length === 0) {
    return {
      data: new Uint8Array(embedding.imageWidth * embedding.imageHeight),
      width: embedding.imageWidth,
      height: embedding.imageHeight,
    };
  }
  const { ort, decoder } = await loadSessions();
  // The decoder expects:
  //   - image_embeddings: cached encoder output
  //   - point_coords: float32 [1, N, 2] in 1024-pixel space
  //   - point_labels: float32 [1, N]
  //   - mask_input + has_mask_input: zeros + 0 for a fresh decode
  //   - orig_im_size: float32 [2]
  const N = points.length;
  const coords = new Float32Array(N * 2);
  const labels = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // Click coords already in normalised 0..1; scale to 1024 for the model.
    coords[i * 2] = points[i].x * 1024;
    coords[i * 2 + 1] = points[i].y * 1024;
    labels[i] = points[i].label;
  }
  const maskInput = new Float32Array(1 * 1 * 256 * 256);
  const hasMaskInput = new Float32Array([0]);
  const origImSize = new Float32Array([embedding.imageHeight, embedding.imageWidth]);

  const feeds: Record<string, unknown> = {
    image_embeddings: embedding.embedding,
    point_coords: new ort.Tensor('float32', coords, [1, N, 2]),
    point_labels: new ort.Tensor('float32', labels, [1, N]),
    mask_input: new ort.Tensor('float32', maskInput, [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor('float32', hasMaskInput, [1]),
    orig_im_size: new ort.Tensor('float32', origImSize, [2]),
  };
  const output = await decoder.run(feeds as Record<string, never>);
  // The decoder returns "masks" as a float32 tensor of [N_masks, H, W].
  // Pick the highest-IoU mask (index 0 is typically the multi-mask mode's best).
  const masksTensor = (output.masks ?? Object.values(output)[0]) as unknown as {
    data: Float32Array;
    dims: readonly number[];
  };
  const [, height, width] = [masksTensor.dims[0], masksTensor.dims[1], masksTensor.dims[2]];
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    // Threshold logits at 0 (SAM convention).
    data[i] = masksTensor.data[i] > 0 ? 255 : 0;
  }
  return { data, width, height };
}

/** Reset state — useful for tests; not part of the public production API. */
export function _resetForTests(): void {
  _sessionsPromise = null;
}

// ---------------------------------------------------------------------------
// helpers

async function imageToTensor(
  ort: OrtModule,
  bitmap: ImageBitmap,
  side: number,
): Promise<InstanceType<OrtModule['Tensor']>> {
  const canvas = new OffscreenCanvas(side, side);
  const ctx = canvas.getContext('2d')!;
  // Letterbox preserve aspect ratio.
  const scale = Math.min(side / bitmap.width, side / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, side, side);
  // CHW float32, mean-normalised per ImageNet (MobileSAM uses ImageNet stats).
  const mean = [123.675, 116.28, 103.53];
  const std = [58.395, 57.12, 57.375];
  const arr = new Float32Array(3 * side * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const i = (y * side + x) * 4;
      for (let c = 0; c < 3; c++) {
        arr[c * side * side + y * side + x] =
          (imgData.data[i + c] - mean[c]) / std[c];
      }
    }
  }
  return new ort.Tensor('float32', arr, [1, 3, side, side]);
}
