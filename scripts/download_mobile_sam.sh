#!/usr/bin/env bash
set -euo pipefail

# Vendors MobileSAM ONNX files for browser-side click-to-segment.
# Source: https://huggingface.co/Acly/MobileSAM (community export of ChaoningZhang/MobileSAM)
# Output: public/models/mobile-sam/{encoder,decoder}.onnx — paths must match
# the constants in src/lib/segmentation/mobile-sam-client.ts (ENCODER_URL, DECODER_URL).

cd "$(dirname "$0")/.."
DEST="public/models/mobile-sam"
mkdir -p "$DEST"

ENCODER_URL="${MOBILE_SAM_ENCODER_URL:-https://huggingface.co/Acly/MobileSAM/resolve/main/mobile_sam_image_encoder.onnx}"
DECODER_URL="${MOBILE_SAM_DECODER_URL:-https://huggingface.co/Acly/MobileSAM/resolve/main/sam_mask_decoder_single.onnx}"

download() {
  local url="$1"
  local out="$2"
  if [ -f "$out" ]; then
    echo "✓ $out already present — skipping"
    return 0
  fi
  local size_hint
  if echo "$url" | grep -q encoder; then size_hint="~28 MB"; else size_hint="~16 MB"; fi
  echo "↓ Downloading $(basename "$out") ($size_hint)..."
  curl -L --fail --progress-bar -o "$out.partial" "$url"
  mv "$out.partial" "$out"
  echo "✓ $out"
}

download "$ENCODER_URL" "$DEST/encoder.onnx"
download "$DECODER_URL" "$DEST/decoder.onnx"

echo
echo "MobileSAM ONNX files ready at $DEST"
