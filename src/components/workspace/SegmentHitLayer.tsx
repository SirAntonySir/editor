import { useCallback, useMemo, useRef } from 'react';
import { useEditorStore } from '@/store';
import { segmentStore } from '@/lib/segmentation/segment-store';
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
  paths: RegionPolygon[];
}

function readHitRegions(imageNodeId: string): HitRegion[] {
  return segmentStore
    .getRegions(imageNodeId)
    .filter((r) => r.maskRef && r.paths && r.paths.length > 0)
    .map((r) => ({ id: r.maskRef!, paths: r.paths! }));
}

function findPolygonsForMaskId(regions: HitRegion[], maskId: string | undefined): RegionPolygon[] {
  if (!maskId) return [];
  const r = regions.find((x) => x.id === maskId);
  return r ? r.paths : [];
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
  // Subscribe to AI context version so we re-pull regions whenever the
  // backend analyze pass produces new ones for the active layer.
  const aiContextVersion = useAiSession((s) => s.context?.generatedAt);
  // aiContextVersion is a version cookie: it isn't referenced inside the
  // callback but must invalidate the memo when the backend emits a new
  // context (segmentStore is then repopulated).
  const regions = useMemo<HitRegion[]>(
    () => readHitRegions(imageNodeId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imageNodeId, aiContextVersion],
  );

  const activeScope = useEditorStore((s) => s.activeScope);
  const hoveredScope = useEditorStore((s) => s.hoveredScope);
  const clickAt = useEditorStore((s) => s.clickAt);
  const setHoveredScope = useEditorStore((s) => s.setHoveredScope);

  const activeMaskId =
    activeScope.kind === 'mask' ? activeScope.mask_id : undefined;
  const hoveredMaskId =
    hoveredScope?.kind === 'mask' ? hoveredScope.mask_id : undefined;

  const hoveredPolys = findPolygonsForMaskId(regions, hoveredMaskId);
  const selectedPolys = findPolygonsForMaskId(regions, activeMaskId);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = layerRef.current;
      if (!el) return;
      const [nx, ny] = clientToNormalised(e, el);
      const hits = polygonsAtPoint([nx, ny], regions);
      if (hits.length === 0) {
        setHoveredScope(null);
        return;
      }
      setHoveredScope({ kind: 'mask', mask_id: hits[0] });
    },
    [regions, setHoveredScope],
  );

  const handlePointerLeave = useCallback(() => setHoveredScope(null), [setHoveredScope]);

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
      className="absolute inset-0 cursor-crosshair"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={handleClick}
    >
      <SegmentOverlay
        widthPx={widthPx}
        heightPx={heightPx}
        hoveredPolygons={hoveredPolys}
        selectedPolygons={selectedPolys}
      />
    </div>
  );
}
