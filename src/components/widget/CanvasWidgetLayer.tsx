import { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { WidgetCard } from '@/components/inspector/widget/WidgetCard';
import { selectAllWidgets, type UnifiedWidget } from '@/lib/widget-projection';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { ToolWidgetCard } from './ToolWidgetCard';

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

  function computePositions(ws: UnifiedWidget[]): Map<string, { left: number; top: number }> {
    const out = new Map<string, { left: number; top: number }>();
    const f = fabricCanvasRef.current;
    if (!f) return out;
    const img = f.getObjects().find((o) => o instanceof fabric.FabricImage) as fabric.FabricImage | undefined;

    let globalStackTop = 60;

    for (const w of ws) {
      if (!img) {
        out.set(w.id, { left: 16, top: globalStackTop });
        globalStackTop += ESTIMATED_WIDGET_H + GLOBAL_STACK_GAP;
        continue;
      }
      const scaleX = img.scaleX ?? 1;
      const scaleY = img.scaleY ?? 1;
      const imgLeft = (img.left ?? 0) - ((img.width ?? 0) * scaleX) / 2;
      const imgTop = (img.top ?? 0) - ((img.height ?? 0) * scaleY) / 2;
      const imgRight = imgLeft + (img.width ?? 0) * scaleX;

      const anchor = w.anchor;
      if (anchor.kind === 'global') {
        out.set(w.id, {
          left: imgRight - WIDGET_W - 16,
          top: imgTop + globalStackTop - 60,
        });
        globalStackTop += ESTIMATED_WIDGET_H + GLOBAL_STACK_GAP;
        continue;
      }
      if (anchor.kind === 'image_point') {
        out.set(w.id, {
          left: imgLeft + anchor.x * scaleX,
          top: imgTop + anchor.y * scaleY,
        });
        continue;
      }
      if (anchor.kind === 'mask_id' || anchor.kind === 'region_label') {
        const mask =
          anchor.kind === 'mask_id'
            ? maskStore.get(anchor.mask_id)
            : maskStore.all().find((m) => m.label === anchor.label);
        if (!mask) {
          out.set(w.id, { left: imgRight - WIDGET_W - 16, top: imgTop + globalStackTop - 60 });
          globalStackTop += ESTIMATED_WIDGET_H + GLOBAL_STACK_GAP;
          continue;
        }
        let sx = 0, sy = 0, n = 0;
        for (let y = 0; y < mask.height; y++) {
          for (let x = 0; x < mask.width; x++) {
            if (mask.data[y * mask.width + x]) { sx += x; sy += y; n++; }
          }
        }
        if (n === 0) {
          out.set(w.id, { left: imgRight - WIDGET_W - 16, top: imgTop + 60 });
          continue;
        }
        out.set(w.id, {
          left: imgLeft + (sx / n) * scaleX,
          top: imgTop + (sy / n) * scaleY,
        });
      }
    }
    return out;
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

  // eslint-disable-next-line react-hooks/refs -- intentional: fabricCanvasRef.current is read to compute pixel positions; setTick() re-triggers render on viewport changes so positions stay current
  const positions = computePositions(widgets);

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
      {widgets.map((w) => {
        const base = positions.get(w.id);
        if (!base) return null;
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
