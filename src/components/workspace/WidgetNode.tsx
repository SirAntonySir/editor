import { Handle, Position, useUpdateNodeInternals, useStore } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { WidgetShell } from '@/components/widget/WidgetShell';
import { useChromeVisible } from '@/hooks/useChromeVisible';
import { useEditorStore } from '@/store';
import { nextWidgetScale } from '@/lib/workspace-drag';
import { widgetTargetLayerIds } from '@/lib/widget-targets';
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

  // Dim widgets whose target layers don't include the selected one, so the
  // canvas foregrounds the widgets that act on the layer you're editing. A
  // widget's targets are its ops' replicate set (`layerIds ?? [layerId]`) —
  // connect/retarget write the plural set, so reading only the frozen singular
  // `layerId` left later-tethered widgets stuck dimmed. Hover restores full
  // opacity so a dimmed widget stays readable/usable. Never dim when nothing is
  // selected, or for a node-scope widget with no target layers.
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const targetLayerIds = widgetTargetLayerIds(data.widget);
  const dimmed = activeLayerId != null && targetLayerIds.length > 0 && !targetLayerIds.includes(activeLayerId);
  const dimClass = dimmed ? 'opacity-40 hover:opacity-100 transition-opacity' : '';

  // Measure the WidgetShell's natural (UNSCALED) CSS box so the outer footprint
  // React Flow measures matches the scaled shell. transform:scale doesn't change
  // the layout box, so offsetWidth/Height stay natural; we multiply by `scale`.
  // The handles themselves are positioned by React Flow's default per-position
  // rules (centred on each border of that measured box) — see the Handle block.
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
      {/* Tether outlets, one per side. Positioned entirely by React Flow's
          default per-position rules, which centre each handle on the matching
          border of the measured node box (scaledW × scaledH via the .group
          wrapper below). RF anchors the edge to a handle's OUTER edge, so the
          .tether-outlet dot is sized to fill the handle (index.css) — the edge
          plugs into the dot's rim rather than floating a half-handle past it. */}
      <Handle type="source" position={Position.Top} id="tether-out-top" className="tether-outlet" />
      <Handle type="source" position={Position.Bottom} id="tether-out-bottom" className="tether-outlet" />
      <Handle type="source" position={Position.Left} id="tether-out-left" className="tether-outlet" />
      <Handle type="source" position={Position.Right} id="tether-out-right" className="tether-outlet" />
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
