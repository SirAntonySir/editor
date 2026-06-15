import { useCallback, useEffect, useRef, useState } from 'react';
import { useAiSession } from '@/hooks/useImageContext';
import { useMobileSam } from '@/hooks/useMobileSam';
import { backendTools } from '@/lib/backend-tools';
import { maskToPngBase64 } from '@/lib/segmentation/mask-png';
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

export function SegmentHitLayer({ imageNodeId, widthPx, heightPx }: SegmentHitLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const sessionId = useAiSession((s) => s.sessionId);
  const samCapability = useMobileSam(imageNodeId);

  const [candidate, setCandidate] = useState<CandidateState | null>(null);
  // Tracks in-flight decode calls so a newer click can invalidate an older
  // decode's setState. Without this, a slow first decode would clobber a
  // faster second click's candidate after it returned.
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

      // Plain click: start a fresh candidate from a single positive point.
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
