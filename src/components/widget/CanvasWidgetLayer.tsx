import { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { WidgetCard } from '@/components/inspector/widget/WidgetCard';
import { selectAllWidgets, type UnifiedWidget } from '@/lib/widget-projection';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { ToolWidgetCard } from './ToolWidgetCard';

// Base position cache entry — stores the computed position plus the anchor
// kind at the time of computation so we can detect anchor-type changes.
interface CachedBase { left: number; top: number; kind: string }

const PHASE_SKELETON_PHASES = new Set(['mask_precompute', 'widget_mint']);

interface CanvasWidgetLayerProps {
  fabricCanvasRef: React.RefObject<fabric.Canvas | null>;
}

/**
 * Absolute-positioned host for canvas widgets. Reads selectAllWidgets()
 * and positions each at its anchor (region centroid / mask centroid /
 * image_point / fixed corner for global). Repositions on Fabric viewport
 * changes.
 */
export function CanvasWidgetLayer({ fabricCanvasRef }: CanvasWidgetLayerProps) {
  // Subscribe to both stores so projection recomputes when either changes
  const widgetsSig = useBackendState((s) => s.snapshot?.widgets);
  const layersSig = useEditorStore((s) => s.layers);
  void widgetsSig; void layersSig;
  const widgets = selectAllWidgets();

  const phase = useBackendState((s) => s.currentPhase);
  const snapshotCtx = useBackendState((s) => s.snapshot?.image_context);

  const showSkeletons = phase && PHASE_SKELETON_PHASES.has(phase.phase);

  const realWidgetLabels = new Set(
    widgets
      .filter((w) => w.variant === 'ai')
      .map((w) => {
        const sc = w.scope;
        if (sc.kind === 'named_region') return sc.label;
        if (sc.kind === 'mask:proposed') return sc.label;
        return null;
      })
      .filter((x): x is string => !!x),
  );

  const skeletonRegions = showSkeletons
    ? (snapshotCtx as { candidate_regions?: Array<{ label: string; bbox: number[]; representative_point?: number[] }> } | null)
      ?.candidate_regions?.filter((r) => !realWidgetLabels.has(r.label)) ?? []
    : [];

  const [, setTick] = useState(0);
  useEffect(() => {
    const f = fabricCanvasRef.current;
    if (!f) return;
    const refresh = () => setTick((t) => t + 1);
    f.on('after:render', refresh as never);
    return () => { f.off('after:render', refresh as never); };
  }, [fabricCanvasRef]);

  const WIDGET_W = 260;
  const ESTIMATED_WIDGET_H = 160;
  const GLOBAL_STACK_GAP = 12;

  // Stable per-widget base-position cache. Populated on first appearance;
  // reused on subsequent renders so snapshot array reordering does not
  // reassign positions. Entries are cleaned up when a widget disappears.
  const basePositionsRef = useRef<Map<string, CachedBase>>(new Map());

  // Clean up cache entries for widgets that have been removed so the Map
  // does not grow unboundedly over a session.
  useEffect(() => {
    const liveIds = new Set(widgets.map((w) => w.id));
    for (const id of basePositionsRef.current.keys()) {
      if (!liveIds.has(id)) basePositionsRef.current.delete(id);
    }
  }, [widgets]);

  /**
   * Returns the base (pre-drag) position for a widget.
   *
   * First call for a widget id: computes and caches.
   * Subsequent calls: returns cache unless the anchor.kind changed (e.g. a
   * backend update changed a global widget to a region widget).
   *
   * freshStack is a mutable accumulator used only when we must compute a new
   * global-stack slot; it is shared across one full render pass so that newly
   * computed global widgets are stacked in widget-array order.
   */
  function getOrComputeBase(
    w: UnifiedWidget,
    freshStack: { top: number },
  ): { left: number; top: number } {
    const f = fabricCanvasRef.current;
    if (!f) return { left: 16, top: 60 };
    const img = f.getObjects().find((o) => o instanceof fabric.FabricImage) as fabric.FabricImage | undefined;
    if (!img) return { left: 16, top: 60 };

    const anchorKind = w.anchor.kind;
    const cached = basePositionsRef.current.get(w.id);

    // Reuse cache if anchor type hasn't changed.
    if (cached && cached.kind === anchorKind) {
      // For global widgets the cached position is already stable; for
      // image_point / mask anchors the position depends on image transform
      // so we recompute those on every render (they are not affected by
      // snapshot array-order changes, only by the image itself moving).
      if (anchorKind === 'global') {
        return { left: cached.left, top: cached.top };
      }
    }

    const scaleX = img.scaleX ?? 1;
    const scaleY = img.scaleY ?? 1;
    const imgLeft = (img.left ?? 0) - ((img.width ?? 0) * scaleX) / 2;
    const imgTop = (img.top ?? 0) - ((img.height ?? 0) * scaleY) / 2;
    const imgRight = imgLeft + (img.width ?? 0) * scaleX;

    let pos: { left: number; top: number };

    if (anchorKind === 'global') {
      pos = { left: imgRight - WIDGET_W - 16, top: imgTop + freshStack.top - 60 };
      freshStack.top += ESTIMATED_WIDGET_H + GLOBAL_STACK_GAP;
    } else if (anchorKind === 'image_point') {
      const a = w.anchor as { x: number; y: number };
      pos = {
        left: imgLeft + a.x * scaleX,
        top: imgTop + a.y * scaleY,
      };
    } else {
      // mask_id or region_label
      const a = w.anchor as { kind: string; mask_id?: string; label?: string };
      const mask = a.mask_id
        ? maskStore.get(a.mask_id)
        : maskStore.all().find((m) => m.label === a.label);
      if (!mask) {
        pos = { left: imgRight - WIDGET_W - 16, top: imgTop + freshStack.top - 60 };
        freshStack.top += ESTIMATED_WIDGET_H + GLOBAL_STACK_GAP;
      } else {
        let sx = 0, sy = 0, n = 0;
        for (let y = 0; y < mask.height; y++) {
          for (let x = 0; x < mask.width; x++) {
            if (mask.data[y * mask.width + x]) { sx += x; sy += y; n++; }
          }
        }
        if (n === 0) {
          pos = { left: imgRight - WIDGET_W - 16, top: imgTop + 60 };
        } else {
          pos = {
            left: imgLeft + (sx / n) * scaleX,
            top: imgTop + (sy / n) * scaleY,
          };
        }
      }
    }

    basePositionsRef.current.set(w.id, { left: pos.left, top: pos.top, kind: anchorKind });
    return pos;
  }

  // Drag state
  const [dragOffsets, setDragOffsets] = useState<Map<string, { dx: number; dy: number }>>(new Map());
  const dragStateRef = useRef<{
    widgetId: string;
    startX: number;
    startY: number;
    baseDx: number;
    baseDy: number;
  } | null>(null);

  function onWidgetPointerDown(widgetId: string, e: React.PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea')) return;
    const existing = dragOffsets.get(widgetId) ?? { dx: 0, dy: 0 };
    dragStateRef.current = {
      widgetId,
      startX: e.clientX,
      startY: e.clientY,
      baseDx: existing.dx,
      baseDy: existing.dy,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onWidgetPointerMove(e: React.PointerEvent) {
    const st = dragStateRef.current;
    if (!st) return;
    const dx = st.baseDx + (e.clientX - st.startX);
    const dy = st.baseDy + (e.clientY - st.startY);
    setDragOffsets((prev) => {
      const next = new Map(prev);
      next.set(st.widgetId, { dx, dy });
      return next;
    });
  }

  function onWidgetPointerUp(e: React.PointerEvent) {
    if (!dragStateRef.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    dragStateRef.current = null;
  }

  function onWidgetPointerCancel(e: React.PointerEvent) {
    if (dragStateRef.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* may already be released */ }
      dragStateRef.current = null;
    }
  }

  // freshStack accumulator is shared across the render pass so that widgets
  // whose global slot must be (re-)computed are stacked in stable order.
  const freshStack = { top: 60 };

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
      {/* eslint-disable-next-line react-hooks/refs -- intentional: fabricCanvasRef.current is read inside getOrComputeBase to map pixel positions; setTick() re-triggers render on viewport changes so positions stay current */}
      {widgets.map((w) => {
        const base = getOrComputeBase(w, freshStack);
        const off = dragOffsets.get(w.id) ?? { dx: 0, dy: 0 };
        const left = base.left + off.dx;
        const top = base.top + off.dy;
        const positionedStyle: React.CSSProperties = {
          left,
          top,
          transform: 'translate(-8px, -8px)',
          cursor: dragStateRef.current?.widgetId === w.id ? 'grabbing' : 'grab',
        };
        if (w.variant === 'ai' && w._widget) {
          return (
            <div
              key={w.id}
              className="absolute pointer-events-auto"
              style={positionedStyle}
              onPointerDown={(e) => onWidgetPointerDown(w.id, e)}
              onPointerMove={onWidgetPointerMove}
              onPointerUp={onWidgetPointerUp}
              onPointerCancel={onWidgetPointerCancel}
            >
              <WidgetCard
                widget={w._widget}
                isSuggestion={w._widget.origin.kind === 'mcp_autonomous'}
                variant={w.variant}
                mode="canvas"
              />
            </div>
          );
        }
        if (w.variant === 'tool') {
          return (
            <div
              key={w.id}
              className="absolute pointer-events-auto"
              style={positionedStyle}
              onPointerDown={(e) => onWidgetPointerDown(w.id, e)}
              onPointerMove={onWidgetPointerMove}
              onPointerUp={onWidgetPointerUp}
              onPointerCancel={onWidgetPointerCancel}
            >
              <ToolWidgetCard uw={w} />
            </div>
          );
        }
        return null;
      })}
      {/* eslint-disable-next-line react-hooks/refs -- intentional: fabricCanvasRef.current is read to compute pixel positions for skeleton widgets; setTick() re-triggers render on viewport changes */}
      {skeletonRegions.map((r, i) => {
        const f = fabricCanvasRef.current;
        if (!f) return null;
        const img = f.getObjects().find((o) => o instanceof fabric.FabricImage) as fabric.FabricImage | undefined;
        if (!img) return null;
        const scaleX = img.scaleX ?? 1;
        const scaleY = img.scaleY ?? 1;
        const imgLeft = (img.left ?? 0) - ((img.width ?? 0) * scaleX) / 2;
        const imgTop = (img.top ?? 0) - ((img.height ?? 0) * scaleY) / 2;
        const px = r.representative_point?.[0] ?? (r.bbox[0] + r.bbox[2] / 2);
        const py = r.representative_point?.[1] ?? (r.bbox[1] + r.bbox[3] / 2);
        const w = img.width ?? 0;
        const h = img.height ?? 0;
        return (
          <div
            key={`sk_${r.label}_${i}`}
            className="absolute pointer-events-none rounded-lg p-2 bg-surface/80 border border-dashed border-glass-border"
            style={{
              left: imgLeft + px * w * scaleX,
              top: imgTop + py * h * scaleY,
              width: 140,
              animation: 'pulse 1.4s ease-in-out infinite',
            }}
          >
            <div className="h-2 w-1/2 bg-surface-secondary rounded mb-1" />
            <div className="h-1.5 bg-surface-secondary rounded mb-1" />
            <div className="h-1.5 bg-surface-secondary rounded w-3/4" />
          </div>
        );
      })}
    </div>
  );
}
