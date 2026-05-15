import * as Comlink from 'comlink';
import * as ort from 'onnxruntime-web';
import { getEncoder, getDecoder } from '@/lib/sam/model-loader';

export interface EncodeResult {
  embedding: Float32Array;
  embeddingShape: number[];
  imageSize: [number, number];
}

export interface PromptInput {
  pointCoords: Float32Array;
  pointLabels: Float32Array;
  origImageSize: [number, number];
}

export interface DecodeResult {
  maskData: Uint8Array;
  width: number;
  height: number;
}

class SamWorker {
  async encode(imageData: ImageData): Promise<EncodeResult> {
    const encoder = await getEncoder();
    const { width: w, height: h, data } = imageData;
    const chw = new Float32Array(3 * w * h);
    const SAM_MEAN = [123.675, 116.28, 103.53];
    const SAM_STD = [58.395, 57.12, 57.375];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          chw[c * w * h + y * w + x] = (data[p + c] - SAM_MEAN[c]) / SAM_STD[c];
        }
      }
    }
    const tensor = new ort.Tensor('float32', chw, [1, 3, h, w]);
    // Use first input name to be robust against ONNX export naming differences.
    const inputName = encoder.inputNames[0];
    const out = await encoder.run({ [inputName]: tensor });
    const embKey = encoder.outputNames[0];
    const emb = out[embKey] as ort.Tensor;
    return {
      embedding: emb.data as Float32Array,
      embeddingShape: Array.from(emb.dims),
      imageSize: [w, h],
    };
  }

  async decode(args: {
    embedding: Float32Array;
    embeddingShape: number[];
    prompts: PromptInput;
    outputSize: [number, number];
  }): Promise<DecodeResult> {
    const decoder = await getDecoder();

    const embTensor = new ort.Tensor('float32', args.embedding, args.embeddingShape);
    const coordsTensor = new ort.Tensor('float32', args.prompts.pointCoords,
      [1, args.prompts.pointCoords.length / 2, 2]);
    const labelsTensor = new ort.Tensor('float32', args.prompts.pointLabels,
      [1, args.prompts.pointLabels.length]);
    const maskInput = new ort.Tensor('float32', new Float32Array(1 * 1 * 256 * 256), [1, 1, 256, 256]);
    const hasMaskInput = new ort.Tensor('float32', new Float32Array([0]), [1]);
    const origImSize = new ort.Tensor('float32',
      new Float32Array([args.prompts.origImageSize[1], args.prompts.origImageSize[0]]), [2]);

    // Decoder input names per Xenova SlimSAM ONNX export. If the actual model
    // has different names, this needs to be adapted by reading decoder.inputNames.
    const feeds: Record<string, ort.Tensor> = {
      image_embeddings: embTensor,
      point_coords: coordsTensor,
      point_labels: labelsTensor,
      mask_input: maskInput,
      has_mask_input: hasMaskInput,
      orig_im_size: origImSize,
    };
    const out = await decoder.run(feeds);

    const masks = out.masks as ort.Tensor;
    const iou = out.iou_predictions as ort.Tensor;
    const iouArr = iou.data as Float32Array;
    let bestIdx = 0;
    for (let i = 1; i < iouArr.length; i++) if (iouArr[i] > iouArr[bestIdx]) bestIdx = i;

    const dims = masks.dims as number[];
    const mh = dims[dims.length - 2];
    const mw = dims[dims.length - 1];
    const logits = masks.data as Float32Array;
    const offset = bestIdx * mh * mw;

    const targetW = args.outputSize[0];
    const targetH = args.outputSize[1];
    const result = new Uint8Array(targetW * targetH);
    const sx = mw / targetW;
    const sy = mh / targetH;
    for (let y = 0; y < targetH; y++) {
      const fy = y * sy;
      const y0 = Math.floor(fy);
      const y1 = Math.min(mh - 1, y0 + 1);
      const ay = fy - y0;
      for (let x = 0; x < targetW; x++) {
        const fx = x * sx;
        const x0 = Math.floor(fx);
        const x1 = Math.min(mw - 1, x0 + 1);
        const ax = fx - x0;
        const v00 = logits[offset + y0 * mw + x0];
        const v01 = logits[offset + y0 * mw + x1];
        const v10 = logits[offset + y1 * mw + x0];
        const v11 = logits[offset + y1 * mw + x1];
        const v0 = v00 * (1 - ax) + v01 * ax;
        const v1 = v10 * (1 - ax) + v11 * ax;
        const v = v0 * (1 - ay) + v1 * ay;
        const sig = 1 / (1 + Math.exp(-v));
        result[y * targetW + x] = sig > 0.5 ? 255 : 0;
      }
    }
    return { maskData: result, width: targetW, height: targetH };
  }
}

Comlink.expose(new SamWorker());
