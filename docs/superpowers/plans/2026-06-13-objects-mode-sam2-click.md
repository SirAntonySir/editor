# Objects-Mode: plain-click → SAM 2 ONNX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plain click in Objects-Mode runs MobileSAM directly in the browser (ONNX Runtime Web), shows a candidate preview, commits via `propose_mask` on Enter. The analyze-derived `candidateRegions` path is removed from `SegmentHitLayer`.

**Architecture:** Vendor MobileSAM ONNX files (encoder + single-mask decoder) via a download script. Replace `SegmentOverlay` (polygon SVG) with a new `SegmentMaskPreview` (canvas alpha-mask). Rewire `SegmentHitLayer.handleClick`: plain click → `useMobileSam.decode([{x, y, label: 1}])`; cmd-click while a candidate exists → append point (positive outside / negative inside); Enter → `propose_mask`; Esc → discard.

**Tech Stack:** React 19, Vite, TypeScript strict, Vitest + @testing-library/react, ONNX Runtime Web (already a dep, used via `src/lib/segmentation/mobile-sam-client.ts`), Tailwind, Zustand.

**Spec:** `docs/superpowers/specs/2026-06-13-objects-mode-sam2-click.md`

---

## File Map

**Create:**
- `scripts/download_mobile_sam.sh` — vendoring script
- `src/components/workspace/SegmentMaskPreview.tsx` — canvas-based mask overlay
- `src/components/workspace/SegmentMaskPreview.test.tsx` — mount + dimensions test

**Modify:**
- `Makefile` — add `download-sam` target
- `.gitignore` — ignore `public/models/`
- `README.md` — setup section for ONNX download
- `src/components/workspace/SegmentHitLayer.tsx` — rewrite handleClick + drop polygon overlay
- `src/components/workspace/SegmentHitLayer.test.tsx` — replace hover/select tests with SAM flow tests

**Delete:**
- `src/components/workspace/SegmentOverlay.tsx`
- `src/components/workspace/SegmentOverlay.test.tsx`

---

## Task 1: Vendor MobileSAM ONNX files

**Files:**
- Create: `scripts/download_mobile_sam.sh`
- Modify: `Makefile`, `.gitignore`, `README.md`

- [ ] **Step 1.1: Create the download script**

Create `scripts/download_mobile_sam.sh`:

```bash
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
  echo "↓ Downloading $(basename "$out") (~$(echo "$url" | grep -q encoder && echo 28 || echo 16) MB)..."
  curl -L --fail --progress-bar -o "$out.partial" "$url"
  mv "$out.partial" "$out"
  echo "✓ $out"
}

download "$ENCODER_URL" "$DEST/encoder.onnx"
download "$DECODER_URL" "$DEST/decoder.onnx"

echo
echo "MobileSAM ONNX files ready at $DEST"
```

- [ ] **Step 1.2: Make the script executable**

Run: `chmod +x scripts/download_mobile_sam.sh`

- [ ] **Step 1.3: Update `.gitignore`**

Append to the existing `.gitignore` (preserve all other content):

```
# Vendored ML models (download via `make download-sam`)
public/models/
```

- [ ] **Step 1.4: Add Makefile target**

Edit `Makefile`. Update the `.PHONY` line to include `download-sam`, add the help line, add the rule.

Replace the first line:
```
.PHONY: help install dev dev-backend electron build electron-build lint test test-run check preview clean
```
with:
```
.PHONY: help install dev dev-backend electron build electron-build lint test test-run check preview clean download-sam
```

In the help block, after the `make clean` line, insert:
```
	@echo "  make download-sam    Vendor MobileSAM ONNX files (~45 MB, one-time)"
```

At the end of the file append:
```
download-sam:
	./scripts/download_mobile_sam.sh
```

- [ ] **Step 1.5: Update `README.md`**

Find the existing "Getting started" or "Setup" section (run `grep -n "## " README.md` to locate). After the existing setup steps, insert a new subsection (use the same heading level as neighboring subsections):

```
### Objects-Mode (SAM 2 click-to-segment)

Before first use of the Objects-Mode panel, vendor the MobileSAM ONNX model files
(one-time, ~45 MB):

    make download-sam

The files land in `public/models/mobile-sam/{encoder,decoder}.onnx` and are
gitignored. If the default HuggingFace source is unreachable, override with:

    MOBILE_SAM_ENCODER_URL=... MOBILE_SAM_DECODER_URL=... make download-sam
```

- [ ] **Step 1.6: Run the script and verify**

Run: `make download-sam`

Expected: two `↓ Downloading` progress bars, ending with `MobileSAM ONNX files ready at public/models/mobile-sam`. Verify:

```bash
ls -la public/models/mobile-sam/
# encoder.onnx  ~28 MB
# decoder.onnx  ~16 MB
file public/models/mobile-sam/encoder.onnx
# Should report a binary file (not HTML — HTML means the URL 404'd into a redirect page)
```

If either file looks wrong (e.g. <1 MB, or `file` reports HTML/text), the URL is broken — re-export from `ChaoningZhang/MobileSAM` using `scripts/export_onnx_model.py --single-mask` and set the env vars before re-running.

- [ ] **Step 1.7: Commit**

```bash
git add scripts/download_mobile_sam.sh Makefile .gitignore README.md
git commit -m "build(segmentation): vendor MobileSAM ONNX via download script

Adds scripts/download_mobile_sam.sh + 'make download-sam' target. Files
land in public/models/mobile-sam/{encoder,decoder}.onnx (gitignored).
Source: Acly/MobileSAM on HuggingFace, override via env vars."
```

---

## Task 2: SegmentMaskPreview component

A canvas-based overlay that renders a `DecodedMask` (Uint8Array of 0/255) as a translucent accent-color overlay scaled to display size.

**Files:**
- Create: `src/components/workspace/SegmentMaskPreview.tsx`
- Test: `src/components/workspace/SegmentMaskPreview.test.tsx`

- [ ] **Step 2.1: Write the failing test**

Create `src/components/workspace/SegmentMaskPreview.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SegmentMaskPreview } from './SegmentMaskPreview';
import type { DecodedMask } from '@/lib/segmentation/mobile-sam-types';

function makeMask(w: number, h: number): DecodedMask {
  const data = new Uint8Array(w * h);
  // Fill a centered rectangle with 255 so the canvas has non-zero alpha
  for (let y = h / 4; y < (3 * h) / 4; y++) {
    for (let x = w / 4; x < (3 * w) / 4; x++) {
      data[y * w + x] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe('SegmentMaskPreview', () => {
  it('mounts a canvas matching the mask dimensions and applies display size', () => {
    const mask = makeMask(64, 48);
    const { container } = render(
      <SegmentMaskPreview mask={mask} widthPx={400} heightPx={300} />,
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    // Drawing buffer matches mask resolution
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(48);
    // CSS scales to display
    expect(canvas.style.width).toBe('400px');
    expect(canvas.style.height).toBe('300px');
  });

  it('renders nothing when mask is null', () => {
    const { container } = render(
      <SegmentMaskPreview mask={null} widthPx={400} heightPx={300} />,
    );
    expect(container.querySelector('canvas')).toBeNull();
  });
});
```

- [ ] **Step 2.2: Run the test, expect FAIL**

Run: `npx vitest run src/components/workspace/SegmentMaskPreview.test.tsx`

Expected: FAIL with `Cannot find module './SegmentMaskPreview'`.

- [ ] **Step 2.3: Implement the component**

Create `src/components/workspace/SegmentMaskPreview.tsx`:

```typescript
import { useEffect, useRef } from 'react';
import type { DecodedMask } from '@/lib/segmentation/mobile-sam-types';

interface SegmentMaskPreviewProps {
  mask: DecodedMask | null;
  widthPx: number;
  heightPx: number;
}

// Hardcoded accent — getComputedStyle would require theme propagation and re-paint
// on every theme switch. The preview is transient (lives <2 s) so a fixed tint is fine.
const TINT_R = 124;
const TINT_G = 58;
const TINT_B = 237;
const TINT_ALPHA = 115;

export function SegmentMaskPreview({ mask, widthPx, heightPx }: SegmentMaskPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!mask) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      const on = mask.data[i] === 255;
      const j = i * 4;
      img.data[j] = TINT_R;
      img.data[j + 1] = TINT_G;
      img.data[j + 2] = TINT_B;
      img.data[j + 3] = on ? TINT_ALPHA : 0;
    }
    ctx.putImageData(img, 0, 0);
  }, [mask]);

  if (!mask) return null;
  return (
    <canvas
      ref={canvasRef}
      width={mask.width}
      height={mask.height}
      className="pointer-events-none absolute inset-0"
      style={{
        width: `${widthPx}px`,
        height: `${heightPx}px`,
        imageRendering: 'pixelated',
      }}
      aria-hidden
    />
  );
}
```

- [ ] **Step 2.4: Run the test, expect PASS**

Run: `npx vitest run src/components/workspace/SegmentMaskPreview.test.tsx`

Expected: PASS, 2 tests.

- [ ] **Step 2.5: Commit**

```bash
git add src/components/workspace/SegmentMaskPreview.tsx src/components/workspace/SegmentMaskPreview.test.tsx
git commit -m "feat(segmentation): SegmentMaskPreview canvas overlay

Renders a DecodedMask as a translucent accent-color overlay scaled to
display size. Replaces SegmentOverlay's polygon path for the candidate
preview in Objects-Mode."
```

---

## Task 3: Rewrite SegmentHitLayer + delete SegmentOverlay

**Files:**
- Modify: `src/components/workspace/SegmentHitLayer.tsx`
- Modify: `src/components/workspace/SegmentHitLayer.test.tsx`
- Delete: `src/components/workspace/SegmentOverlay.tsx`
- Delete: `src/components/workspace/SegmentOverlay.test.tsx`

- [ ] **Step 3.1: Rewrite the test (TDD — describe new behavior)**

Replace the entire contents of `src/components/workspace/SegmentHitLayer.test.tsx` with:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SegmentHitLayer } from './SegmentHitLayer';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { backendTools } from '@/lib/backend-tools';
import type { DecodedMask, SamPoint } from '@/lib/segmentation/mobile-sam-types';

const decodeMock = vi.fn<(points: SamPoint[]) => Promise<DecodedMask | null>>();

vi.mock('@/hooks/useMobileSam', () => ({
  useMobileSam: () => ({ ready: true, error: null, decode: decodeMock }),
}));

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    propose_mask: vi.fn(async () => ({ ok: true, output: { maskId: 'new-mask' } })),
  },
}));

function fakeMask(width = 4, height = 4): DecodedMask {
  // 4×4 mask, top-left 2×2 quadrant is "on"
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height / 2; y++) {
    for (let x = 0; x < width / 2; x++) {
      data[y * width + x] = 255;
    }
  }
  return { data, width, height };
}

function stubRect(layer: HTMLElement) {
  layer.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

describe('SegmentHitLayer — plain-click SAM 2 flow', () => {
  beforeEach(() => {
    decodeMock.mockReset();
    decodeMock.mockResolvedValue(fakeMask());
    (backendTools.propose_mask as ReturnType<typeof vi.fn>).mockClear();
    useEditorStore.getState().clearSelection();
    useAiSession.setState({ sessionId: 'sess-1', context: null, status: 'idle', error: null });
  });

  it('plain click calls decode with one positive point', async () => {
    const { container, findByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    // Wait a microtask for the async decode call
    await Promise.resolve();
    expect(decodeMock).toHaveBeenCalledTimes(1);
    const points = decodeMock.mock.calls[0][0];
    expect(points).toHaveLength(1);
    expect(points[0].label).toBe(1);
    expect(points[0].x).toBeCloseTo(0.25);
    expect(points[0].y).toBeCloseTo(0.25);
  });

  it('Enter after a successful decode commits via propose_mask with origin client_new', async () => {
    const { findByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    // Let decode + setCandidate settle
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.keyDown(window, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 0));
    expect(backendTools.propose_mask).toHaveBeenCalledTimes(1);
    const [sessionId, input] = (backendTools.propose_mask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sessionId).toBe('sess-1');
    expect(input.imageNodeId).toBe('in-1');
    expect(input.origin).toBe('client_new');
    expect(typeof input.pngBase64).toBe('string');
    expect(input.pngBase64.length).toBeGreaterThan(0);
  });

  it('cmd-click after a candidate appends a refinement point (label 0 if inside mask)', async () => {
    const { findByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    // 1) plain click to establish a candidate
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    await new Promise((r) => setTimeout(r, 0));
    decodeMock.mockClear();
    // 2) cmd-click on the same spot — that point falls inside the fake mask's
    //    top-left "on" quadrant, so the new point's label must be 0 (negative).
    fireEvent.click(layer, { clientX: 100, clientY: 75, metaKey: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(decodeMock).toHaveBeenCalledTimes(1);
    const points = decodeMock.mock.calls[0][0];
    expect(points).toHaveLength(2);
    expect(points[1].label).toBe(0);
  });

  it('Enter after a refinement commits with origin client_refinement', async () => {
    const { findByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(layer, { clientX: 100, clientY: 75, metaKey: true });
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.keyDown(window, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 0));
    const [, input] = (backendTools.propose_mask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input.origin).toBe('client_refinement');
  });

  it('Esc discards the candidate (Enter after Esc does not commit)', async () => {
    const { findByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 0));
    expect(backendTools.propose_mask).not.toHaveBeenCalled();
  });

  it('new plain click while a candidate exists starts a fresh decode (one more call)', async () => {
    const { findByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    await new Promise((r) => setTimeout(r, 0));
    decodeMock.mockClear();
    fireEvent.click(layer, { clientX: 200, clientY: 150 });
    await new Promise((r) => setTimeout(r, 0));
    expect(decodeMock).toHaveBeenCalledTimes(1);
    const points = decodeMock.mock.calls[0][0];
    expect(points).toHaveLength(1);
    expect(points[0].label).toBe(1);
  });
});
```

- [ ] **Step 3.2: Run the test, expect FAIL**

Run: `npx vitest run src/components/workspace/SegmentHitLayer.test.tsx`

Expected: tests fail (old SegmentHitLayer still does hover/select; new tests expect SAM flow). Multiple assertion failures + likely `decodeMock not called`.

- [ ] **Step 3.3: Rewrite `SegmentHitLayer.tsx`**

Replace the entire contents of `src/components/workspace/SegmentHitLayer.tsx` with:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAiSession } from '@/hooks/useImageContext';
import { useMobileSam } from '@/hooks/useMobileSam';
import { backendTools } from '@/lib/backend-tools';
import { SegmentMaskPreview } from './SegmentMaskPreview';
import type { SamPoint, DecodedMask } from '@/lib/segmentation/mobile-sam-types';

interface SegmentHitLayerProps {
  imageNodeId: string;
  widthPx: number;
  heightPx: number;
}

interface CandidateState {
  points: SamPoint[];
  mask: DecodedMask | null;
}

function clientToNormalised(
  evt: { clientX: number; clientY: number },
  el: HTMLElement,
): [number, number] {
  const rect = el.getBoundingClientRect();
  return [(evt.clientX - rect.left) / rect.width, (evt.clientY - rect.top) / rect.height];
}

function isInsideMask(nx: number, ny: number, mask: DecodedMask | null): boolean {
  if (!mask) return false;
  const x = Math.min(mask.width - 1, Math.max(0, Math.floor(nx * mask.width)));
  const y = Math.min(mask.height - 1, Math.max(0, Math.floor(ny * mask.height)));
  return mask.data[y * mask.width + x] === 255;
}

async function maskToPngBase64(mask: DecodedMask): Promise<string> {
  const canvas = new OffscreenCanvas(mask.width, mask.height);
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i++) {
    const v = mask.data[i];
    imgData.data[i * 4] = v;
    imgData.data[i * 4 + 1] = v;
    imgData.data[i * 4 + 2] = v;
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function SegmentHitLayer({ imageNodeId, widthPx, heightPx }: SegmentHitLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const sessionId = useAiSession((s) => s.sessionId);
  const samCapability = useMobileSam(imageNodeId);

  const [candidate, setCandidate] = useState<CandidateState | null>(null);
  // Track in-flight decode so Esc / re-click can cancel its setState effect.
  const decodeSeqRef = useRef(0);

  const cancelCandidate = useCallback(() => setCandidate(null), []);

  const commitCandidate = useCallback(async () => {
    const c = candidate;
    if (!c?.mask || !sessionId) return;
    const pngBase64 = await maskToPngBase64(c.mask);
    const hasNegativePoint = c.points.some((p) => p.label === 0);
    const env = await backendTools.propose_mask(sessionId, {
      imageNodeId,
      pngBase64,
      paths: [],
      origin: hasNegativePoint ? 'client_refinement' : 'client_new',
    });
    if (env.ok) {
      // Drop the candidate; the new mask appears via SSE `mask.proposed`
      // merging into snapshot.masksIndex.
      setCandidate(null);
    }
  }, [candidate, sessionId, imageNodeId]);

  // Esc / Enter while a candidate is live.
  useEffect(() => {
    if (!candidate) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancelCandidate(); }
      if (e.key === 'Enter') { e.preventDefault(); void commitCandidate(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [candidate, commitCandidate, cancelCandidate]);

  const runDecode = useCallback(async (points: SamPoint[]) => {
    const seq = ++decodeSeqRef.current;
    setCandidate({ points, mask: null });
    const mask = await samCapability.decode(points);
    if (seq !== decodeSeqRef.current) return; // superseded by a newer click
    setCandidate({ points, mask });
  }, [samCapability]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = layerRef.current;
      if (!el) return;
      const [nx, ny] = clientToNormalised(e, el);

      // Cmd-click while a candidate is live: append a refinement point.
      // Positive (label 1) if outside the current mask, negative (label 0)
      // if inside — mirrors the SAM convention for click-driven refinement.
      if ((e.metaKey || e.ctrlKey) && candidate) {
        const insideMask = isInsideMask(nx, ny, candidate.mask);
        const point: SamPoint = { x: nx, y: ny, label: insideMask ? 0 : 1 };
        void runDecode([...candidate.points, point]);
        return;
      }

      // Plain click (or shift, or cmd without candidate): start a new candidate.
      void runDecode([{ x: nx, y: ny, label: 1 }]);
    },
    [candidate, runDecode],
  );

  const statusText = !candidate
    ? null
    : candidate.mask
      ? 'Enter to commit · Esc to cancel · Cmd-click to refine'
      : 'Segmenting…';

  return (
    <div
      ref={layerRef}
      data-testid="segment-hit-layer"
      data-image-node-id={imageNodeId}
      // `nodrag` / `nopan` opt-out so React Flow doesn't swallow pointer events.
      className="nodrag nopan absolute inset-0 cursor-crosshair"
      style={{ pointerEvents: 'auto', zIndex: 5 }}
      onClick={handleClick}
    >
      <SegmentMaskPreview
        mask={candidate?.mask ?? null}
        widthPx={widthPx}
        heightPx={heightPx}
      />
      {statusText && (
        <div
          className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-[4px] bg-surface text-text-primary text-[10px] leading-none border border-separator shadow-sm whitespace-nowrap"
        >
          {statusText}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3.4: Delete `SegmentOverlay.tsx` and its test**

```bash
git rm src/components/workspace/SegmentOverlay.tsx src/components/workspace/SegmentOverlay.test.tsx
```

- [ ] **Step 3.5: Run the SegmentHitLayer test, expect PASS**

Run: `npx vitest run src/components/workspace/SegmentHitLayer.test.tsx`

Expected: PASS, 6 tests.

- [ ] **Step 3.6: Run the full check, expect PASS**

Run: `npm run check`

Expected: tsc clean, eslint clean (the existing CurveEditor warnings persist — those are pre-existing, not introduced here), all 113 test files green.

If tsc complains about an unused import in `SegmentHitLayer` (e.g. `polygonsAtPoint`, `RegionPolygon`, `useEditorStore`, `findRegionByMaskId`), they were already removed in the rewrite above. If tsc complains about a missing import in another file referencing `SegmentOverlay`, search for it: `grep -rn "SegmentOverlay" src/` — only the now-deleted SegmentHitLayer should have referenced it; any straggler import must be removed.

- [ ] **Step 3.7: Commit**

```bash
git add src/components/workspace/SegmentHitLayer.tsx src/components/workspace/SegmentHitLayer.test.tsx src/components/workspace/SegmentOverlay.tsx src/components/workspace/SegmentOverlay.test.tsx
git commit -m "feat(segmentation): plain-click → MobileSAM in Objects-Mode

SegmentHitLayer drops the candidateRegions / polygon-overlay path.
Plain click runs MobileSAM with one positive point; cmd-click appends
a refinement point (negative if inside the current mask, positive if
outside). Enter commits via propose_mask, Esc discards. SegmentOverlay
is deleted — replaced by SegmentMaskPreview as the visual layer."
```

---

## Task 4: Manual verification

- [ ] **Step 4.1: Confirm ONNX files are present**

Run: `ls -la public/models/mobile-sam/`

Expected: `encoder.onnx` (~28 MB) + `decoder.onnx` (~16 MB). If missing, run `make download-sam` from Task 1.

- [ ] **Step 4.2: Start dev server + backend**

In one terminal: `make dev-backend`
In another: `make dev`

Expected: Vite serves `localhost:5173` (or similar), backend serves `127.0.0.1:8787`.

- [ ] **Step 4.3: Test the click-to-segment flow**

1. Open an image (Cmd+O or "Open Image" button).
2. Wait for backend session creation (`Uploading image…` → status badge shows `ready` or SSE-connected).
3. In the image node footer, click `Objects` to switch the mode.
4. Click on a subject in the image.

Expected:
- First click: footer shows `Segmenting…` for ~600 ms (one-time encoder run), then a translucent purple overlay appears on the clicked subject, footer changes to `Enter to commit · Esc to cancel · Cmd-click to refine`.
- Press `Enter`: overlay disappears, a new mask appears in the masks list / snapshot (visible in Layers panel as a child of the image layer if your layer panel shows masks).

- [ ] **Step 4.4: Test refinement**

1. Click again on a different subject.
2. Wait for the overlay.
3. Cmd-click *inside* the overlay (a region the SAM mask currently covers).

Expected: overlay re-decodes — typically shrinks because the negative point excluded that region.

4. Cmd-click *outside* the current overlay but on the intended subject.

Expected: overlay grows to include the new positive point's region.

5. Press `Enter` → commits as `client_refinement` (visible in network tab: `POST /api/tools/propose_mask` body should have `"origin":"client_refinement"`).

- [ ] **Step 4.5: Test the error path (missing model)**

1. Stop dev server.
2. Move the ONNX files aside: `mv public/models/mobile-sam public/models/mobile-sam.bak`
3. Restart dev server, repeat the click test.

Expected: candidate-state still appears (`Segmenting…`) but stays there — decode rejects because the encoder/decoder fail to load. Check DevTools console for `[useMobileSam] error`-style messages or a 404 on `/models/mobile-sam/encoder.onnx`. No crash; the rest of the editor remains usable.

4. Restore: `mv public/models/mobile-sam.bak public/models/mobile-sam`

---

## Self-review notes

Spec → plan coverage:

- ✅ Plain click invokes SAM with one positive point — Task 3, test 1.
- ✅ Cmd-click appends positive/negative point — Task 3, test 3.
- ✅ Enter commits with correct `origin` — Task 3, tests 2 + 4.
- ✅ Esc discards — Task 3, test 5.
- ✅ New click while candidate exists = discard + fresh decode — Task 3, test 6 + `decodeSeqRef` invalidation in the component.
- ✅ `candidateRegions` / polygon overlay / hover removed from SegmentHitLayer — rewrite drops them entirely.
- ✅ SegmentMaskPreview as new visual layer — Task 2.
- ✅ ONNX vendoring via download script — Task 1.
- ✅ `.gitignore`, Makefile target, README setup note — Task 1, steps 1.3–1.5.
- ✅ Error handling for missing model files — Task 4.5 manual verification (no automated test for fetch failures; the existing `useMobileSam` already catches and sets `error`).

Out-of-scope from the spec (intentionally not in this plan): touch / drag-box prompts, multi-mask SAM output, backend fallback for no-WebGPU-and-no-WASM, auto-traced polygons, shift-click rebinding, auto-analyze re-enable.
