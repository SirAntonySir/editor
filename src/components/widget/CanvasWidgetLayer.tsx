import { useEffect, useMemo, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { useBackendState, type PhaseName } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { useWidgetDockLayout } from '@/hooks/useWidgetDockLayout';
import { useHoveredWidget } from '@/hooks/useHoveredWidget';
import { WidgetShell } from './WidgetShell';
import { AnchorTickLayer } from './AnchorTickLayer';
import { RegionHighlightLayer } from './RegionHighlightLayer';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { backendTools } from '@/lib/backend-tools';
import { anchorForScope } from '@/lib/widget-anchor';
import type { Widget } from '@/types/widget';

const PHASE_SKELETON_PHASES: PhaseName[] = ['mask_precompute', 'widget_mint'];

const COLLAPSED_HEIGHT = 30;
const EXPANDED_HEIGHT_ESTIMATE = 200;

interface CanvasWidgetLayerProps {
  fabricCanvasRef: React.RefObject<fabric.Canvas | null>;
}

/**
 * Absolute-positioned host for canvas widgets. Reads widgets from the backend
 * snapshot and positions each via `useWidgetDockLayout`. Renders anchor tick
 * marks and region highlight overlays for hovered widgets.
 */
export function CanvasWidgetLayer({ fabricCanvasRef }: CanvasWidgetLayerProps) {
  const snapshotWidgets = useBackendState((s) => s.snapshot?.widgets ?? []);
  const accepted = useBackendState((s) => s.acceptedSuggestions);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const expandedIds = useEditorStore((s) => s.expandedWidgetIds);
  const { hoveredWidgetId } = useHoveredWidget();
  const context = useAiSession((s) => s.context);

  const phases = useBackendState((s) => s.phases);
  const snapshotCtx = useBackendState((s) => s.snapshot?.image_context);

  // Canvas only hosts tool-origin widgets + accepted AI widgets. Unaccepted
  // mcp_autonomous suggestions live in the right-panel Suggestions list until
  // the user cursor-bind-drops them.
  const widgets = useMemo<Widget[]>(() => {
    return snapshotWidgets.filter((w) => {
      if (w.status !== 'active') return false;
      const layerOk = activeLayerId ? w.nodes.some((n) => n.layer_id === activeLayerId) : true;
      if (!layerOk) return false;
      if (w.origin.kind === 'mcp_autonomous' && !accepted.has(w.id)) return false;
      return true;
    });
  }, [snapshotWidgets, accepted, activeLayerId]);

  // Fabric viewport tick — re-renders on every Fabric after:render so that
  // the photo bbox re-computes and widget positions stay current.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const f = fabricCanvasRef.current;
    if (!f) return;
    const refresh = () => setTick((t) => t + 1);
    f.on('after:render', refresh as never);
    return () => { f.off('after:render', refresh as never); };
  }, [fabricCanvasRef]);

  // Photo bbox in canvas-container coords. Recomputed on every Fabric render
  // cycle (setTick bumps a counter that is included in deps so this memo
  // invalidates whenever the viewport changes).
  const photo = useMemo(() => {
    const fc = fabricCanvasRef.current;
    if (!fc) return { left: 0, top: 0, width: 0, height: 0 };
    const el = fc.lowerCanvasEl;
    const rect = el.getBoundingClientRect();
    const parent = el.parentElement?.getBoundingClientRect() ?? rect;
    return { left: rect.left - parent.left, top: rect.top - parent.top, width: rect.width, height: rect.height };
  // fabricCanvasRef.current is intentionally read at render time;
  // tick is included so the memo re-runs on every Fabric after:render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricCanvasRef, tick]);

  const dockInputs = useMemo(
    () => widgets.map((w) => ({
      id: w.id,
      anchor: w.origin.anchor ?? anchorForScope(w.scope),
      cardHeight: expandedIds.has(w.id) ? EXPANDED_HEIGHT_ESTIMATE : COLLAPSED_HEIGHT,
    })),
    [widgets, expandedIds],
  );
  const positions = useWidgetDockLayout(dockInputs, photo);

  // anchorBoxes: widgetId → normalised [x, y, w, h] for region_label anchors
  const anchorBoxes = useMemo(() => {
    const out: Record<string, [number, number, number, number]> = {};
    if (!context) return out;
    for (const w of widgets) {
      const a = w.origin.anchor;
      if (a?.kind === 'region_label') {
        const r = context.candidateRegions?.find((cr) => cr.label === a.label);
        if (r?.bbox) out[w.id] = r.bbox;
      }
    }
    return out;
  }, [widgets, context]);

  // Skeleton overlays during mask_precompute / widget_mint phases
  const showSkeletons =
    !!phases && PHASE_SKELETON_PHASES.some((k) => phases[k].status === 'active');

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

  // Focus pan: when a widget is focused (e.g. from Active row click), bring
  // its dock position to the viewport center, then clear focus after animation.
  // positionsRef keeps the latest positions without making it a dep of the
  // effect, so unrelated dock-layout recomputations don't trigger spurious re-pans.
  const focusedId = useEditorStore((s) => s.focusedWidgetId);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  useEffect(() => {
    if (!focusedId) return;
    const f = fabricCanvasRef.current;
    if (!f) return;
    const pos = positionsRef.current.find((p) => p.widgetId === focusedId);
    if (!pos) return;
    const vw = f.getWidth();
    const vh = f.getHeight();
    const vpt = f.viewportTransform ?? [1, 0, 0, 1, 0, 0];
    const a = vpt[0] || 1;
    const d = vpt[3] || 1;
    const dx = vw / 2 - pos.x * a;
    const dy = vh / 2 - pos.y * d;
    f.setViewportTransform([a, vpt[1], vpt[2], d, dx, dy]);
    f.requestRenderAll();
    const t = window.setTimeout(() => {
      useEditorStore.getState().focusWidget(null);
    }, 600);
    return () => window.clearTimeout(t);
  }, [focusedId, fabricCanvasRef]);

  // O(1) widget lookup for the render pass below.
  const widgetById = useMemo(
    () => new Map(widgets.map((w) => [w.id, w])),
    [widgets],
  );

  // Cursor-bind drop: while a tool/suggestion is bound to the cursor, swallow
  // a click on the canvas overlay to commit the widget.
  const pending = useEditorStore((s) => s.pendingBind);
  const sessionId = useBackendState((s) => s.sessionId);

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
      <AnchorTickLayer photo={photo} positions={positions} />
      <RegionHighlightLayer photo={photo} anchorBoxes={anchorBoxes} hoveredWidgetId={hoveredWidgetId} />
      {positions.map((p) => {
        const widget = widgetById.get(p.widgetId);
        if (!widget) return null;
        return (
          <div key={p.widgetId} className="absolute pointer-events-auto" style={{ left: p.x, top: p.y }}>
            <WidgetShell widget={widget} />
          </div>
        );
      })}
      {/* Skeleton placeholders during mask_precompute / widget_mint phases */}
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
            className="absolute pointer-events-none rounded-lg p-2 bg-surface border border-dashed border-separator"
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
