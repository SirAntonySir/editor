#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p models

CKPT_URL="https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
CKPT_PATH="models/sam_vit_b_01ec64.pth"

if [ -f "$CKPT_PATH" ]; then
  echo "SAM checkpoint already present at $CKPT_PATH"
  exit 0
fi

echo "Downloading SAM ViT-B checkpoint (~375 MB)..."
curl -L --fail -o "$CKPT_PATH.partial" "$CKPT_URL"
mv "$CKPT_PATH.partial" "$CKPT_PATH"
echo "Done: $CKPT_PATH"
