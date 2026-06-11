import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '@/store';
import { polygonsAtPoint } from '@/lib/segmentation/mask-utils';
import { useAiSession } from '@/hooks/useImageContext';
import { useMobileSam } from '@/hooks/useMobileSam';
import { backendTools } from '@/lib/backend-tools';
import { SegmentOverlay } from './SegmentOverlay';
import type { RegionPolygon } from '@/types/image-context';
import type { SamPoint, DecodedMask } from '@/lib/segmentation/mobile-sam-types';

interface SegmentHitLayerProps {
  imageNodeId: string;
  widthPx: number;
  heightPx: number;
}

interface HitRegion {
  id: string;
  label: string;
  paths: RegionPolygon[];
}

interface CandidateState {
  points: SamPoint[];
  mask: DecodedMask | null;
}

function findRegionByMaskId(regions: HitRegion[], maskId: string | undefined): HitRegion | null {
  if (!maskId) return null;
  return regions.find((x) => x.id === maskId) ?? null;
}

function clientToNormalised(
  evt: { clientX: number; clientY: number },
  el: HTMLElement,
): [number, number] {
  const rect = el.getBoundingClientRect();
  return [(evt.clientX - rect.left) / rect.width, (evt.clientY - rect.top) / rect.height];
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
  // Read regions straight from useAiSession. Previously we went through
  // `segmentStore`, but that was a non-reactive Map written from
  // `useSegmentInteraction`'s useEffect — so the memo here would evaluate
  // before the effect populated the store, hover/click only started working
  // after a mode-toggle remounted this component. Reading useAiSession
  // directly removes the race; the store can be reintroduced later if we
  // need divergent regions per ImageNode (which is why we keep the prop).
  const candidateRegions = useAiSession((s) => s.context?.candidateRegions);
  const regions = useMemo<HitRegion[]>(() => {
    if (!candidateRegions) return [];
    return candidateRegions
      .filter((r) => r.maskRef && r.paths && r.paths.length > 0)
      .map((r) => ({ id: r.maskRef!, label: r.label, paths: r.paths! }));
  }, [candidateRegions]);

  const sessionId = useAiSession((s) => s.sessionId);
  const samCapability = useMobileSam(imageNodeId);

  const activeScope = useEditorStore((s) => s.activeScope);
  const hoveredScope = useEditorStore((s) => s.hoveredScope);
  const clickAt = useEditorStore((s) => s.clickAt);
  const setHoveredScope = useEditorStore((s) => s.setHoveredScope);

  const activeMaskId =
    activeScope.kind === 'mask' ? activeScope.mask_id : undefined;
  const hoveredMaskId =
    hoveredScope?.kind === 'mask' ? hoveredScope.mask_id : undefined;

  const hoveredRegion = findRegionByMaskId(regions, hoveredMaskId);
  const selectedRegion = findRegionByMaskId(regions, activeMaskId);

  // Cursor position in local layer coordinates (px) for the tooltip. Null
  // when the cursor isn't over a region.
  const [cursorPx, setCursorPx] = useState<[number, number] | null>(null);

  // Live candidate from MobileSAM (shift/cmd-click flow).
  const [candidate, setCandidate] = useState<CandidateState | null>(null);

  const cancelCandidate = useCallback(() => setCandidate(null), []);

  const commitCandidate = useCallback(async () => {
    if (!candidate?.mask || !sessionId) return;
    const pngBase64 = await maskToPngBase64(candidate.mask);
    const hasNegativePoint = candidate.points.some((p) => p.label === 0);
    const env = await backendTools.propose_mask(sessionId, {
      imageNodeId,
      pngBase64,
      paths: [],
      origin: hasNegativePoint ? 'client_refinement' : 'client_new',
    });
    if (env.ok) {
      // Drop the candidate; the new mask will appear via SSE
      // `mask.proposed` event merging into snapshot.masksIndex.
      setCandidate(null);
    }
  }, [candidate, sessionId, imageNodeId]);

  // Esc / Enter shortcuts when a candidate is live.
  useEffect(() => {
    if (!candidate) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancelCandidate(); }
      if (e.key === 'Enter') { e.preventDefault(); void commitCandidate(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [candidate, commitCandidate, cancelCandidate]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = layerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const [nx, ny] = clientToNormalised(e, el);
      const hits = polygonsAtPoint([nx, ny], regions);
      if (hits.length === 0) {
        setHoveredScope(null);
        setCursorPx(null);
        return;
      }
      setHoveredScope({ kind: 'mask', mask_id: hits[0] });
      setCursorPx([localX, localY]);
    },
    [regions, setHoveredScope],
  );

  const handlePointerLeave = useCallback(() => {
    setHoveredScope(null);
    setCursorPx(null);
  }, [setHoveredScope]);

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      const el = layerRef.current;
      if (!el) return;
      const [nx, ny] = clientToNormalised(e, el);
      const hits = polygonsAtPoint([nx, ny], regions);

      // Shift-click: start a new candidate with one positive point.
      if (e.shiftKey) {
        const point: SamPoint = { x: nx, y: ny, label: 1 };
        const points = [point];
        const mask = await samCapability.decode(points);
        setCandidate({ points, mask });
        // If we got a mask, immediately commit (skip Enter step for single-click new).
        if (mask && sessionId) {
          const pngBase64 = await maskToPngBase64(mask);
          const env = await backendTools.propose_mask(sessionId, {
            imageNodeId,
            pngBase64,
            paths: [],
            origin: 'client_new',
          });
          if (env.ok) {
            setCandidate(null);
          }
        }
        return;
      }

      // Cmd-click (or Ctrl-click on non-mac): if a candidate is live, refine it.
      if ((e.metaKey || e.ctrlKey) && candidate) {
        const isInsideExisting = hits.length > 0;
        const point: SamPoint = { x: nx, y: ny, label: isInsideExisting ? 0 : 1 };
        const points = [...candidate.points, point];
        const mask = await samCapability.decode(points);
        setCandidate({ points, mask });
        return;
      }

      // Plain click — default behavior unchanged.
      clickAt(nx, ny, hits);
    },
    [regions, clickAt, candidate, samCapability, sessionId, imageNodeId],
  );

  return (
    <div
      ref={layerRef}
      data-testid="segment-hit-layer"
      data-image-node-id={imageNodeId}
      // `nodrag` tells React Flow not to start a node-drag from this layer's
      // pointerdown — without it, RF eats the pointer events and click/hover
      // here never fires while we're inside a draggable node.
      // `nopan` is the same opt-out for pane-pan (RF v11+).
      className="nodrag nopan absolute inset-0 cursor-crosshair"
      style={{ pointerEvents: 'auto', zIndex: 5 }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={handleClick}
    >
      <SegmentOverlay
        widthPx={widthPx}
        heightPx={heightPx}
        hoveredPolygons={hoveredRegion?.paths ?? []}
        selectedPolygons={selectedRegion?.paths ?? []}
      />
      {hoveredRegion && cursorPx && (
        <div
          className="pointer-events-none absolute px-1.5 py-0.5 rounded-[3px] bg-surface text-text-primary text-[10px] leading-none border border-separator shadow-sm whitespace-nowrap"
          // Offset slightly down-right of the cursor so it doesn't sit
          // under the pointer. Translate avoids re-measuring on every move.
          style={{
            left: cursorPx[0] + 10,
            top: cursorPx[1] + 12,
          }}
        >
          {hoveredRegion.label}
        </div>
      )}
      {candidate && (
        <div
          className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-[4px] bg-surface text-text-primary text-[10px] leading-none border border-separator shadow-sm whitespace-nowrap"
        >
          {candidate.mask ? 'Enter to commit · Esc to cancel · Cmd+click to refine' : 'Segmenting…'}
        </div>
      )}
    </div>
  );
}
