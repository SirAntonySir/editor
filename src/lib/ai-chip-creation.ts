/**
 * Take a freshly produced SAM mask and turn it into an AI chip.
 * Handles auto-naming (heuristic-from-context first, Claude fallback) and
 * duplicate detection (skip + activate existing chip when an equivalent
 * mask is already in the list).
 */
import { maskStore, type Mask } from '@/core/mask-store';
import { maskIoU } from '@/lib/mask-overlap';
import { useAiSession } from '@/hooks/useImageContext';
import { useAiChips, type AiChip } from '@/store/ai-chips-store';
import type { MaskRef } from '@/types/scope';
import type { CandidateRegion } from '@/types/image-context';

const BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

// Two new chips with IoU above this threshold are considered the same
// selection — keep the original, surface that one as active.
const DUPLICATE_IOU = 0.85;

/** Convert a Uint8Array mask into a base64 PNG (1-channel, 0/255). */
async function maskToPngBase64(mask: Mask): Promise<string> {
  const canvas = new OffscreenCanvas(mask.width, mask.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('maskToPngBase64: no 2d context');
  const imgData = ctx.createImageData(mask.width, mask.height);
  const d = imgData.data;
  for (let i = 0; i < mask.data.length; i++) {
    const v = mask.data[i] > 0 ? 255 : 0;
    d[i * 4] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Heuristic match — does the new mask contain any candidate region's
 * representative point? If so, reuse that region's label.
 */
function heuristicLabel(
  mask: Mask,
  regions: CandidateRegion[],
): string | null {
  const matches: { label: string; coverage: number }[] = [];
  for (const region of regions) {
    if (!region.representativePoint) continue;
    const [nx, ny] = region.representativePoint;
    const px = Math.max(0, Math.min(mask.width - 1, Math.round(nx * mask.width)));
    const py = Math.max(0, Math.min(mask.height - 1, Math.round(ny * mask.height)));
    if (mask.data[py * mask.width + px] > 0) {
      // The mask covers this region's seed point. Record a confidence proxy:
      // the bbox size — smaller bbox → more specific label preferred over a
      // generic "whole composite" sweep.
      const bboxArea = region.bbox
        ? Math.max(1e-6, region.bbox[2] * region.bbox[3])
        : 1;
      matches.push({ label: region.label, coverage: 1 / bboxArea });
    }
  }
  if (matches.length === 0) return null;
  // Smallest matching bbox wins (most specific region the mask contains).
  matches.sort((a, b) => b.coverage - a.coverage);
  return matches[0].label;
}

/** Ask the backend's /api/name-region endpoint to label the mask via Claude. */
async function claudeLabel(mask: Mask, sessionId: string): Promise<string> {
  const mask_png_base64 = await maskToPngBase64(mask);
  const res = await fetch(`${BASE_URL}/api/name-region`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, mask_png_base64 }),
  });
  if (!res.ok) throw new Error(`/api/name-region → ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { label: string };
  return body.label;
}

/**
 * Public entry point. Called by Point / Multi-point / Box select tools after
 * they produce a maskRef. Returns the resulting (possibly pre-existing) chip.
 */
export async function createChipFromMask(args: {
  maskRef: MaskRef;
  sourceLayerId: string;
  preferredLabel?: string;
}): Promise<AiChip | null> {
  const mask = maskStore.get(args.maskRef);
  if (!mask) return null;

  // Duplicate detection: if a chip already covers nearly the same pixels,
  // activate it instead of creating a near-twin.
  const chipStore = useAiChips.getState();
  const duplicate = chipStore.findOverlappingChip((c) => {
    const otherMask = maskStore.get(c.maskRef);
    if (!otherMask) return false;
    return maskIoU(mask, otherMask) >= DUPLICATE_IOU;
  });
  if (duplicate) {
    chipStore.setActiveTarget('chip', duplicate.id);
    return duplicate;
  }

  // Naming.
  let label = args.preferredLabel?.trim() || '';
  if (!label) {
    const ctx = useAiSession.getState().context;
    if (ctx?.candidateRegions) {
      const heuristic = heuristicLabel(mask, ctx.candidateRegions);
      if (heuristic) label = heuristic;
    }
  }
  if (!label) {
    const sid = useAiSession.getState().sessionId;
    if (sid) {
      try {
        label = await claudeLabel(mask, sid);
      } catch (err) {
        console.warn('[createChipFromMask] /api/name-region failed:', err);
      }
    }
  }
  if (!label) {
    // Last-resort placeholder so the chip is still creatable + renameable.
    label = `Selection ${chipStore.chips.length + 1}`;
  }

  const chip: AiChip = {
    id: crypto.randomUUID(),
    label,
    maskRef: args.maskRef,
    sourceLayerId: args.sourceLayerId,
    createdAt: Date.now(),
  };
  chipStore.addChip(chip);
  chipStore.setActiveTarget('chip', chip.id);
  return chip;
}
