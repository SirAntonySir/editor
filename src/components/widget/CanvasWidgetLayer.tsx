import { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { WidgetCard } from '@/components/inspector/widget/WidgetCard';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { ToolWidgetCard } from './ToolWidgetCard';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { backendTools } from '@/lib/backend-tools';
import { scopeEquals } from '@/types/scope';
import { anchorForScope } from '@/lib/widget-anchor';
import type { Widget, WidgetAnchor } from '@/types/widget';

// Base position cache entry — stores the computed position plus the anchor
// kind at the time of computation so we can detect anchor-type changes.
interface CachedBase { left: number; top: number; kind: string }

const PHASE_SKELETON_PHASES = new Set(['mask_precompute', 'widget_mint']);

interface CanvasWidgetLayerProps {
  fabricCanvasRef: React.RefObject<fabric.Canvas | null>;
}

/**
 * Absolute-positioned host for canvas widgets. Reads widgets from the backend
 * snapshot and positions each at its anchor (region centroid / mask centroid /
 * image_point / fixed corner for global). Repositions on Fabric viewport
 * changes.
 */
export function CanvasWidgetLayer({ fabricCanvasRef }: CanvasWidgetLayerProps) {
  const snapshot = useBackendState((s) => s.snapshot);
  const activeScope = useEditorStore((s) => s.activeScope);
  const accepted = useBackendState((s) => s.acceptedSuggestions);

  // Canvas only hosts tool-origin widgets + accepted AI widgets. Unaccepted
  // mcp_autonomous suggestions live in the right-panel Suggestions list until
  // the user cursor-bind-drops them.
  const widgets = (snapshot?.widgets ?? []).filter((w) =>
    w.status === 'active' &&
    (w.origin.kind === 'tool_invoked' || w.origin.kind !== 'mcp_autonomous' || accepted.has(w.id)),
  );

  const phase = useBackendState((s) => s.currentPhase);
  const snapshotCtx = useBackendState((s) => s.snapshot?.image_context);

  const showSkeletons = phase && PHASE_SKELETON_PHASES.has(phase.phase);

  const realWidgetLabels = new Set(
    widgets
      .filter((w) => w.origin.kind !== 'tool_invoked')
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
    w: Widget,
    anchor: WidgetAnchor,
    freshStack: { top: number },
  ): { left: number; top: number } {
    const f = fabricCanvasRef.current;
    if (!f) return { left: 16, top: 60 };
    const img = f.getObjects().find((o) => o instanceof fabric.FabricImage) as fabric.FabricImage | undefined;
    if (!img) return { left: 16, top: 60 };

    const anchorKind = anchor.kind;
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
      const a = anchor as { kind: 'image_point'; x: number; y: number };
      pos = {
        left: imgLeft + a.x * scaleX,
        top: imgTop + a.y * scaleY,
      };
    } else {
      // mask_id or region_label
      const a = anchor as { kind: string; mask_id?: string; label?: string };
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
    // Skip drag if the press is on an interactive control: form elements,
    // anything that opts out (data-no-drag), or any SVG (curves point picker,
    // levels histogram scrubber, etc. own their own pointer state).
    if (target.closest('button, input, textarea, select, svg, [data-no-drag]')) return;
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

  // Cursor-bind drop: while a tool/suggestion is bound to the cursor, swallow
  // a click on the canvas overlay to commit the widget.
  const pending = useEditorStore((s) => s.pendingBind);
  const sessionId = useBackendState((s) => s.sessionId);

  // Focus pan: when a widget is focused (e.g. from Active row click), bring
  // its cached anchor to the viewport center and let the pulse animation
  // play, then clear focus after the animation.
  const focusedId = useEditorStore((s) => s.focusedWidgetId);
  useEffect(() => {
    if (!focusedId) return;
    const f = fabricCanvasRef.current;
    if (!f) return;
    const cached = basePositionsRef.current.get(focusedId);
    if (!cached) return;
    const vw = f.getWidth();
    const vh = f.getHeight();
    const vpt = f.viewportTransform ?? [1, 0, 0, 1, 0, 0];
    const a = vpt[0] || 1;
    const d = vpt[3] || 1;
    const dx = vw / 2 - cached.left * a;
    const dy = vh / 2 - cached.top * d;
    f.setViewportTransform([a, vpt[1], vpt[2], d, dx, dy]);
    f.requestRenderAll();
    const t = window.setTimeout(() => {
      useEditorStore.getState().focusWidget(null);
    }, 600);
    return () => window.clearTimeout(t);
  }, [focusedId, fabricCanvasRef]);

  function onCanvasDrop(e: React.MouseEvent) {
    if (!pending) return;
    e.stopPropagation();
    if (pending.kind === 'tool') {
      const tool = CanvasToolRegistry.get(pending.toolName);
      const procId = tool?.processingId;
      const layerId = useEditorStore.getState().activeLayerId;
      const sid = useBackendState.getState().sessionId;
      if (!procId || !layerId || !sid) {
        useEditorStore.getState().cancelBind();
        return;
      }
      void backendTools.propose_widget(sid, {
        intent: tool?.label ?? procId,
        scope: useEditorStore.getState().activeScope,
        fused_tool_id: procId,
        layer_id: layerId,
        origin: 'tool_invoked',
      });
    } else if (sessionId) {
      void backendTools.accept_widget(sessionId, { widget_id: pending.widgetId });
    }
    useEditorStore.getState().cancelBind();
  }

  return (
    <div
      className={pending ? 'absolute inset-0 cursor-crosshair' : 'absolute inset-0 pointer-events-none'}
      style={{ zIndex: 10 }}
      onClick={onCanvasDrop}
    >
      {/* eslint-disable-next-line react-hooks/refs -- intentional: fabricCanvasRef.current is read inside getOrComputeBase to map pixel positions; setTick() re-triggers render on viewport changes so positions stay current */}
      {widgets.map((w) => {
        const anchor = w.origin.anchor ?? anchorForScope(w.scope);
        const base = getOrComputeBase(w, anchor, freshStack);
        const off = dragOffsets.get(w.id) ?? { dx: 0, dy: 0 };
        const left = base.left + off.dx;
        const top = base.top + off.dy;
        const matches = !activeScope || activeScope.kind === 'global' || scopeEquals(activeScope, w.scope);
        const isFocused = focusedId === w.id;
        const variant = w.origin.kind === 'tool_invoked' ? 'tool' : 'ai';
        const positionedStyle: React.CSSProperties = {
          left,
          top,
          transform: 'translate(-8px, -8px)',
          cursor: dragStateRef.current?.widgetId === w.id ? 'grabbing' : 'grab',
          opacity: matches ? 1 : 0.1,
          transition: 'opacity 0.18s ease-out',
          animation: isFocused ? 'widget-pulse 320ms ease-out' : undefined,
          // Out-of-scope widgets are visually muted AND inert — clicks pass
          // through to the canvas so the user can re-scope without fighting
          // a phantom drag handle.
          pointerEvents: matches ? 'auto' : 'none',
        };
        if (variant === 'ai') {
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
                widget={w}
                isSuggestion={w.origin.kind === 'mcp_autonomous'}
                variant={variant}
                mode="canvas"
              />
            </div>
          );
        }
        if (variant === 'tool') {
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
