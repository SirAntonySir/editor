import { useCallback, useEffect, useRef, useState } from 'react';
import { useAiSession } from '@/hooks/useImageContext';
import { useMobileSam } from '@/hooks/useMobileSam';
import { backendTools } from '@/lib/backend-tools';
import { maskToPngBase64 } from '@/lib/segmentation/mask-png';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { Kbd } from '@/components/ui/kbd';
import { toast } from '@/components/ui/Toast';
import { useImageNodeObjects } from '@/hooks/useImageNodeObjects';
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
  const existingObjects = useImageNodeObjects(imageNodeId);

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
    const autoName = `Object ${existingObjects.length + 1}`;
    const env = await backendTools.propose_mask(sessionId, {
      imageNodeId,
      pngBase64,
      paths: [],
      label: autoName,
      origin: hasNegativePoint ? 'client_refinement' : 'client_new',
    });
    if (env.ok) {
      // Record the imageNodeId-for-this-mask mapping on the client. The
      // SSE event doesn't carry it, so without this the objects layer
      // can't filter masksIndex per image-node.
      const maskId = env.output?.maskId;
      if (maskId) objectOwnership.set(maskId, imageNodeId);
      toast.info(`Saved as "${autoName}"`);
      setCandidate(null);
    } else {
      toast.info(`Save failed: ${env.error?.message ?? 'unknown error'}`);
    }
  }, [candidate, sessionId, imageNodeId, existingObjects.length]);

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

      // Shift-click while a candidate is live: append a refinement point.
      // Positive (label 1) if outside the current mask, negative (label 0)
      // if inside — mirrors the SAM convention for click-driven refinement.
      if (e.shiftKey && candidate) {
        const insideMask = isInsideMask(nx, ny, candidate.mask);
        const point: SamPoint = { x: nx, y: ny, label: insideMask ? 0 : 1 };
        void runDecode([...candidate.points, point]);
        return;
      }

      // Plain click (or shift without a candidate): start a fresh candidate.
      void runDecode([{ x: nx, y: ny, label: 1 }]);
    },
    [candidate, runDecode],
  );

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
      {candidate && (
        <div
          data-testid="segment-candidate-hint"
          data-state={candidate.mask ? 'ready' : 'pending'}
          className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-[4px] bg-surface text-text-primary text-[10px] leading-none border border-separator shadow-sm whitespace-nowrap flex items-center gap-1.5"
        >
          {candidate.mask ? (
            <>
              <Kbd keys="enter" className="ml-0" />
              <span>commit</span>
              <span className="opacity-40">·</span>
              <Kbd keys="esc" className="ml-0" />
              <span>cancel</span>
              <span className="opacity-40">·</span>
              <Kbd keys="shift" className="ml-0" />
              <span>+ click to refine</span>
            </>
          ) : (
            <span>Segmenting…</span>
          )}
        </div>
      )}
    </div>
  );
}
