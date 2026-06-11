import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '@/store';
import { polygonsAtPoint } from '@/lib/segmentation/mask-utils';
import { useAiSession } from '@/hooks/useImageContext';
import { SegmentOverlay } from './SegmentOverlay';
import type { RegionPolygon } from '@/types/image-context';

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
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = layerRef.current;
      if (!el) return;
      const [nx, ny] = clientToNormalised(e, el);
      const hits = polygonsAtPoint([nx, ny], regions);
      clickAt(nx, ny, hits);
    },
    [regions, clickAt],
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
    </div>
  );
}
