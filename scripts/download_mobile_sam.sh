#!/usr/bin/env bash
set -euo pipefail

# Vendors MobileSAM ONNX files for browser-side click-to-segment.
# Source: https://huggingface.co/Acly/MobileSAM (community export of ChaoningZhang/MobileSAM)
# Output: public/models/mobile-sam/{encoder,decoder}.onnx — paths must match
# the constants in src/lib/segmentation/mobile-sam-client.ts (ENCODER_URL, DECODER_URL).

cd "$(dirname "$0")/.."
DEST="public/models/mobile-sam"
mkdir -p "$DEST"

# Primary: HuggingFace (canonical source). Fallback: a GitHub release mirror
# on this repo (models-v1) — HF gateway 504s killed a Vercel deploy, and a
# build must not depend on a single upstream. Env vars override the primary.
ENCODER_URL="${MOBILE_SAM_ENCODER_URL:-https://huggingface.co/Acly/MobileSAM/resolve/main/mobile_sam_image_encoder.onnx}"
DECODER_URL="${MOBILE_SAM_DECODER_URL:-https://huggingface.co/Acly/MobileSAM/resolve/main/sam_mask_decoder_single.onnx}"
MIRROR_BASE="https://github.com/SirAntonySir/editor/releases/download/models-v1"

fetch() {
  local url="$1"
  local out="$2"
  # --retry-all-errors: also retry HTTP 5xx. 4 tries × 5s ≈ 30s per source.
  curl -L --fail --progress-bar \
    --retry 4 --retry-delay 5 --retry-all-errors --retry-max-time 120 \
    -o "$out.partial" "$url" && mv "$out.partial" "$out"
}

download() {
  local url="$1"
  local mirror="$2"
  local out="$3"
  if [ -f "$out" ]; then
    echo "✓ $out already present — skipping"
    return 0
  fi
  local size_hint
  if echo "$out" | grep -q encoder; then size_hint="~28 MB"; else size_hint="~16 MB"; fi
  echo "↓ Downloading $(basename "$out") ($size_hint)..."
  if fetch "$url" "$out"; then
    echo "✓ $out"
    return 0
  fi
  echo "⚠ primary failed ($url) — trying mirror..."
  fetch "$mirror" "$out"
  echo "✓ $out (mirror)"
}

download "$ENCODER_URL" "$MIRROR_BASE/encoder.onnx" "$DEST/encoder.onnx"
download "$DECODER_URL" "$MIRROR_BASE/decoder.onnx" "$DEST/decoder.onnx"

# Copy ONNX Runtime Web's bundled WASM assets into public/ort/. ORT-Web fetches
# these at runtime via `ort.env.wasm.wasmPaths`; without them Vite returns
# index.html and the wasm streaming-compile fails with
# "expected magic word 00 61 73 6d, found 3c 21 64 6f" (which is "<!do…").
ORT_SRC="node_modules/onnxruntime-web/dist"
ORT_DEST="public/ort"
if [ ! -d "$ORT_SRC" ]; then
  echo "✗ $ORT_SRC missing — run 'npm install' first"
  exit 1
fi
mkdir -p "$ORT_DEST"
# jsep = WebGPU EP, plain = CPU WASM fallback. The two combos mobile-sam-client
# requests via executionProviders: ['webgpu', 'wasm'].
for base in ort-wasm-simd-threaded.jsep ort-wasm-simd-threaded; do
  for ext in wasm mjs; do
    src="$ORT_SRC/$base.$ext"
    dst="$ORT_DEST/$base.$ext"
    if [ -f "$dst" ] && [ "$src" -ot "$dst" ]; then
      continue
    fi
    cp "$src" "$dst"
    echo "✓ $dst"
  done
done

echo
echo "MobileSAM ONNX files ready at $DEST"
echo "ONNX Runtime Web assets ready at $ORT_DEST"
