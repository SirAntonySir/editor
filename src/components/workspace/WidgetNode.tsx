import { Handle, Position, useUpdateNodeInternals, useStore } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { WidgetShell } from '@/components/widget/WidgetShell';
import { useChromeVisible } from '@/hooks/useChromeVisible';
import { useEditorStore } from '@/store';
import { nextWidgetScale } from '@/lib/workspace-drag';
import type { Widget } from '@/types/widget';
import { MarkerDot } from './MarkerDot';

export interface WidgetNodeData extends Record<string, unknown> {
  widget: Widget;
}

interface WidgetNodeProps {
  id: string;
  data: WidgetNodeData;
  selected: boolean;
}

export function WidgetNode({ id, data, selected }: WidgetNodeProps) {
  const chromeVisible = useChromeVisible();
  // User uniform scale (bottom-right corner resize). 1 = natural size.
  const scale = useEditorStore((s) => s.widgetNodes[id]?.scale ?? 1);

  // Dim widgets whose target layer isn't the selected one, so the canvas
  // foregrounds the widgets that act on the layer you're editing. A widget's
  // target is its ops' `layerId` (the same value the Pin path sets). Hover
  // restores full opacity so a dimmed widget stays readable/usable. Never dim
  // when nothing is selected, or for a node-scope widget with no layerId.
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const widgetLayerId = data.widget.nodes.find((n) => n.layerId)?.layerId ?? null;
  const dimmed = activeLayerId != null && widgetLayerId != null && widgetLayerId !== activeLayerId;
  const dimClass = dimmed ? 'opacity-40 hover:opacity-100 transition-opacity' : '';

  // Anchor the left/right edge handles to the node's vertical centre so
  // tethers connect at the middle of the side, matching the image node (whose
  // handles use React Flow's centered default) rather than pinning to the
  // header band.
  const sideY = '50%';

  // Measure the WidgetShell's natural (UNSCALED) CSS box so the bottom + right
  // source handles can anchor at its actual extent. transform:scale doesn't
  // change the layout box, so offsetWidth/Height stay natural; we multiply by
  // `scale` for handle positions + the outer footprint React Flow measures.
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({
    w: 226, // WIDGET_SHELL_MIN_WIDTH fallback (kept literal to avoid an import cycle)
    h: 56,
  });
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setNaturalSize({ w: el.offsetWidth, h: el.offsetHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scaledW = naturalSize.w * scale;
  const scaledH = naturalSize.h * scale;

  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, scaledW, scaledH, updateNodeInternals]);

  return (
    <>
      <Handle
        type="source"
        position={Position.Top}
        id="tether-out-top"
        style={{ left: '50%', top: 0, opacity: 0 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="tether-out-bottom"
        style={{ left: '50%', top: `${scaledH}px`, opacity: 0 }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="tether-out-left"
        style={{ top: sideY, left: 0, opacity: 0 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="tether-out-right"
        style={{ top: sideY, left: `${scaledW}px`, opacity: 0 }}
      />
      {chromeVisible ? (
        // Outer box carries the SCALED footprint React Flow measures; the shell
        // inside is uniformly scaled from its top-left. `group` so the resize
        // handle can reveal on hover.
        <div className={`group ${dimClass}`} style={{ position: 'relative', width: `${scaledW}px`, height: `${scaledH}px` }}>
          <div
            ref={innerRef}
            style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: 'max-content' }}
          >
            <WidgetShell widget={data.widget} selected={selected} />
          </div>
          {/* Always mounted (so a scale-triggered re-render can't unmount it
              mid-drag); revealed on hover or while selected. */}
          <WidgetResizeHandle widgetId={id} naturalW={naturalSize.w} scale={scale} visible={selected} />
        </div>
      ) : (
        <div className={dimClass}>
          <MarkerDot widget={data.widget} />
        </div>
      )}
    </>
  );
}

/** Bottom-right corner handle that uniformly scales the widget (ratio locked).
 *  Mirrors the image-node CornerTicks feel: hairline accent L, nodrag/nopan,
 *  pointer capture, drag divided by canvas zoom. */
function WidgetResizeHandle({
  widgetId,
  naturalW,
  scale,
  visible,
}: {
  widgetId: string;
  naturalW: number;
  scale: number;
  /** Force-visible (e.g. while the node is selected); otherwise reveal on hover. */
  visible: boolean;
}) {
  const setWidgetScale = useEditorStore((s) => s.setWidgetScale);
  const zoom = useStore((s) => s.transform[2]);
  const start = useRef<{ clientX: number; scale: number } | null>(null);

  return (
    <span
      aria-hidden
      data-testid="widget-resize-handle"
      className={`nodrag nopan absolute block border border-[var(--color-accent)] border-l-0 border-t-0 cursor-nwse-resize transition-opacity group-hover:opacity-100 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ width: 14, height: 14, right: -2, bottom: -2 }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { clientX: e.clientX, scale };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const dx = (e.clientX - s.clientX) / Math.max(zoom, 0.001);
        setWidgetScale(widgetId, nextWidgetScale(naturalW, s.scale, dx));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        start.current = null;
      }}
      onPointerCancel={(e) => {
        if (!start.current) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        start.current = null;
      }}
    />
  );
}
