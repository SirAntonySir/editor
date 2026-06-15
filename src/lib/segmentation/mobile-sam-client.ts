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
  const { encoder } = await loadSessions();
  // MobileSAM encoder expects HWC float32 in 0–255 range. The model normalises,
  // permutes to CHW, and pads to 1024×1024 internally (see Acly README).
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const tensor = await imageToTensor(image, 1024);
  const inputKey = encoder.inputNames[0] ?? 'input_image';
  const output = await encoder.run({ [inputKey]: tensor });
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
  // Cap orig_im_size at 1024 max edge. The decoder upsamples its internal
  // mask to orig_im_size exactly — for a 3867x5152 source we'd get a 3867x5152
  // float32 mask (~80MB), then allocate a 3867x5152 canvas downstream, which
  // OOMs the second click. The model's coord transform uses
  // scale = 1024 / max(origH, origW), so a 1024-max orig_im_size means
  // scale = 1 and point_coords are already in model-space. Aspect preserved.
  const sourceMax = Math.max(embedding.imageWidth, embedding.imageHeight);
  const capScale = sourceMax > 1024 ? 1024 / sourceMax : 1;
  const capW = Math.round(embedding.imageWidth * capScale);
  const capH = Math.round(embedding.imageHeight * capScale);
  const N = points.length;
  const coords = new Float32Array(N * 2);
  const labels = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // Decoder expects point coords in orig_im_size pixel space. Normalised → capped pixel.
    coords[i * 2] = points[i].x * capW;
    coords[i * 2 + 1] = points[i].y * capH;
    labels[i] = points[i].label;
  }
  const maskInput = new Float32Array(1 * 1 * 256 * 256);
  const hasMaskInput = new Float32Array([0]);
  const origImSize = new Float32Array([capH, capW]);

  // NOTE: decoder.inputNames lists `image_embedings` (one 'd') for the Acly
  // export, but ORT's run() actually validates against `image_embeddings`
  // (two 'd') — apparent name-mismatch inside the loader. We pass the
  // canonical SAM spelling that ORT.run() accepts.
  const feeds: Record<string, unknown> = {
    image_embeddings: embedding.embedding,
    point_coords: new ort.Tensor('float32', coords, [1, N, 2]),
    point_labels: new ort.Tensor('float32', labels, [1, N]),
    mask_input: new ort.Tensor('float32', maskInput, [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor('float32', hasMaskInput, [1]),
    orig_im_size: new ort.Tensor('float32', origImSize, [2]),
  };
  const output = await decoder.run(feeds as Record<string, never>);
  // Acly's single-mask decoder returns "masks" with dims [B, 1, H, W] at the
  // original image resolution (because we passed orig_im_size). We take the
  // single mask in [B=0, C=0]. Strides: data is row-major across the last two
  // dims, so the H*W floats live contiguously starting at offset 0.
  const masksTensor = (output.masks ?? Object.values(output)[0]) as unknown as {
    data: Float32Array;
    dims: readonly number[];
  };
  // dims = [batch, n_masks, H, W] for rank 4; [n_masks, H, W] for rank 3.
  const d = masksTensor.dims;
  const height = d.length === 4 ? d[2] : d[1];
  const width = d.length === 4 ? d[3] : d[2];
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
  bitmap: ImageBitmap,
  side: number,
): Promise<InstanceType<OrtModule['Tensor']>> {
  const { ort } = await loadSessions();
  const canvas = new OffscreenCanvas(side, side);
  const ctx = canvas.getContext('2d')!;
  // Letterbox preserve aspect ratio.
  const scale = Math.min(side / bitmap.width, side / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, side, side);
  // Acly/MobileSAM encoder expects HWC float32 with raw 0–255 values — the
  // model does ImageNet mean/std normalisation, padding, and HWC→NCHW
  // internally (see Acly/MobileSAM/mobile_sam_encoder_onnx/onnx_image_encoder.py).
  // If you swap in the ChaoningZhang export, switch back to CHW with explicit
  // mean/std normalisation. ORT throws a clear "Invalid rank/dimensions"
  // error if the shape is wrong, so the mismatch is loud, not silent.
  const arr = new Float32Array(side * side * 3);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const i = (y * side + x) * 4;
      const o = (y * side + x) * 3;
      arr[o] = imgData.data[i];
      arr[o + 1] = imgData.data[i + 1];
      arr[o + 2] = imgData.data[i + 2];
    }
  }
  return new ort.Tensor('float32', arr, [side, side, 3]);
}
