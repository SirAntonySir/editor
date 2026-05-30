import { useMemo } from 'react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';

export interface DockedPosition {
  widgetId: string;
  x: number;
  y: number;
  isAnchored: boolean;
}

export interface DockInputs {
  widgets: Array<{
    id: string;
    anchor:
      | { kind: 'region_label'; label: string }
      | { kind: 'mask_id'; mask_id: string }
      | { kind: 'image_point'; x: number; y: number }
      | { kind: 'global' };
    cardHeight: number;
  }>;
  photo: { left: number; top: number; width: number; height: number };
  candidateRegions?: Array<{
    label: string;
    bbox?: [number, number, number, number];
    representative_point?: [number, number];
  }>;
  masksIndex?: Array<{ id: string; bbox?: [number, number, number, number] }>;
  dragOverrides?: Map<string, { x: number; y: number }>;
}

const COLUMN_TOP_INSET = 24;
const COLUMN_BOTTOM_INSET = 24;
const COLUMN_X_GAP = 12;
const STACK_GAP = 5;

function resolveCentroidY(
  anchor: DockInputs['widgets'][number]['anchor'],
  photo: DockInputs['photo'],
  regions?: DockInputs['candidateRegions'],
  masks?: DockInputs['masksIndex'],
): number | null {
  if (anchor.kind === 'global') return null;
  if (anchor.kind === 'image_point') {
    return photo.top + anchor.y * photo.height;
  }
  if (anchor.kind === 'region_label') {
    const r = regions?.find((x) => x.label === anchor.label);
    if (!r) return null;
    if (r.bbox) {
      const [, by, , bh] = r.bbox;
      return photo.top + (by + bh / 2) * photo.height;
    }
    if (r.representative_point) {
      return photo.top + r.representative_point[1] * photo.height;
    }
    return null;
  }
  if (anchor.kind === 'mask_id') {
    const m = masks?.find((x) => x.id === anchor.mask_id);
    if (m?.bbox) {
      const [, by, , bh] = m.bbox;
      return photo.top + (by + bh / 2) * photo.height;
    }
    return null;
  }
  return null;
}

function rectsOverlap(aTop: number, aBot: number, bTop: number, bBot: number): boolean {
  return aTop < bBot && bTop < aBot;
}

export function computeDockLayout(inputs: DockInputs): DockedPosition[] {
  const { widgets, photo, candidateRegions, masksIndex, dragOverrides } = inputs;
  const columnX = photo.left + photo.width + COLUMN_X_GAP;
  const columnTop = photo.top + COLUMN_TOP_INSET;
  const columnBottom = photo.top + photo.height + COLUMN_BOTTOM_INSET;

  type Placement = { id: string; top: number; height: number };
  const placed: Placement[] = [];
  const out: DockedPosition[] = [];

  // 1) drag-override wins outright — skip layout entirely for these widgets
  const remaining: typeof widgets = [];
  for (const w of widgets) {
    const ov = dragOverrides?.get(w.id);
    if (ov) {
      const centroidY = resolveCentroidY(w.anchor, photo, candidateRegions, masksIndex);
      out.push({ widgetId: w.id, x: ov.x, y: ov.y, isAnchored: centroidY !== null });
    } else {
      remaining.push(w);
    }
  }

  // 2) split remaining into anchored (centroid resolved) and globals (centroid null)
  const anchored = remaining.filter((w) =>
    resolveCentroidY(w.anchor, photo, candidateRegions, masksIndex) !== null,
  );
  const globals = remaining.filter((w) =>
    resolveCentroidY(w.anchor, photo, candidateRegions, masksIndex) === null,
  );

  // 3) place anchored widgets first, pushing down on collision
  for (const w of anchored) {
    const cy = resolveCentroidY(w.anchor, photo, candidateRegions, masksIndex)!;
    let top = Math.max(columnTop, Math.min(cy - w.cardHeight / 2, columnBottom - w.cardHeight));
    // push down past any already-placed card that overlaps
    let collision = placed.find((p) => rectsOverlap(top, top + w.cardHeight, p.top, p.top + p.height));
    while (collision) {
      top = collision.top + collision.height + STACK_GAP;
      collision = placed.find((p) => rectsOverlap(top, top + w.cardHeight, p.top, p.top + p.height));
    }
    placed.push({ id: w.id, top, height: w.cardHeight });
    out.push({ widgetId: w.id, x: columnX, y: top, isAnchored: true });
  }

  // 4) global widgets fill the first free slot scanning top-down
  for (const w of globals) {
    let top = columnTop;
    let collision = placed.find((p) => rectsOverlap(top, top + w.cardHeight, p.top, p.top + p.height));
    while (collision) {
      top = collision.top + collision.height + STACK_GAP;
      collision = placed.find((p) => rectsOverlap(top, top + w.cardHeight, p.top, p.top + p.height));
    }
    placed.push({ id: w.id, top, height: w.cardHeight });
    out.push({ widgetId: w.id, x: columnX, y: top, isAnchored: false });
  }

  return out;
}

/**
 * React hook that wraps `computeDockLayout` with live store selectors.
 * Adapts the FE type shapes (camelCase CandidateRegion, no-bbox MaskSummary)
 * into the DockInputs contract expected by the pure function.
 */
export function useWidgetDockLayout(
  widgets: DockInputs['widgets'],
  photo: DockInputs['photo'],
): DockedPosition[] {
  // CandidateRegion uses camelCase (representativePoint) — map to DockInputs snake_case
  const rawRegions = useAiSession((s) => s.context?.candidateRegions);
  // MaskSummary has no bbox field — pass as-is; bbox will be undefined
  const masksIndex = useBackendState((s) => s.snapshot?.masks_index);
  const dragOverrides = useEditorStore((s) => s.sessionDragOverrides);

  const candidateRegions = useMemo(
    () =>
      rawRegions?.map((r) => ({
        label: r.label,
        bbox: r.bbox,
        representative_point: r.representativePoint,
      })),
    [rawRegions],
  );

  return useMemo(
    () =>
      computeDockLayout({
        widgets,
        photo,
        candidateRegions,
        masksIndex: masksIndex?.map((m) => ({ id: m.id })),
        dragOverrides,
      }),
    [widgets, photo, candidateRegions, masksIndex, dragOverrides],
  );
}
