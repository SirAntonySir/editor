/**
 * Types for the MobileSAM browser client.
 *
 * MobileSAM is a TinyViT-distilled SAM that fits in ~10 MB ONNX. The
 * encoder runs once per image (~300-800 ms on WebGPU, longer on WASM);
 * the decoder runs per-click (~20 ms on WebGPU). The encoder embedding
 * is cached per `imageNodeId` for the lifetime of the session.
 */

/** Click prompt fed to the decoder. */
export interface SamPoint {
  /** Normalised [0..1] x. */
  x: number;
  /** Normalised [0..1] y. */
  y: number;
  /** 1 = include (positive), 0 = exclude (negative). */
  label: 0 | 1;
}

/** Encoder output cached per image. The actual ONNX tensor lives inside,
 *  exposed as an opaque handle the decoder consumes. */
export interface EncoderEmbedding {
  /** Source image dims at encode time — decoder needs them to rescale
   *  click coords from normalised → pixel space. */
  imageWidth: number;
  imageHeight: number;
  /** Opaque ONNX tensor. The client never lets this leak across the API. */
  embedding: unknown;
}

/** Decoder output. The mask is a Uint8Array of {0, 255} pixels at the
 *  source image resolution (not downscaled). */
export interface DecodedMask {
  data: Uint8Array;
  width: number;
  height: number;
}
