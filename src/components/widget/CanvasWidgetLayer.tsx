import { useEffect, useState } from 'react';
import * as fabric from 'fabric';
import { WidgetCard } from '@/components/inspector/widget/WidgetCard';
import { selectAllWidgets, type UnifiedWidget } from '@/lib/widget-projection';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { ToolWidgetCard } from './ToolWidgetCard';

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

  const [, setTick] = useState(0);
  useEffect(() => {
    const f = fabricCanvasRef.current;
    if (!f) return;
    const refresh = () => setTick((t) => t + 1);
    f.on('after:render', refresh as never);
    return () => { f.off('after:render', refresh as never); };
  }, [fabricCanvasRef]);

  function anchorPx(w: UnifiedWidget): { left: number; top: number } | null {
    const f = fabricCanvasRef.current;
    if (!f) return null;
    const img = f.getObjects().find((o) => o instanceof fabric.FabricImage) as fabric.FabricImage | undefined;
    if (!img) return { left: 16, top: 60 };
    const scaleX = img.scaleX ?? 1;
    const scaleY = img.scaleY ?? 1;
    const imgLeft = (img.left ?? 0) - ((img.width ?? 0) * scaleX) / 2;
    const imgTop = (img.top ?? 0) - ((img.height ?? 0) * scaleY) / 2;

    const anchor = w.anchor;
    switch (anchor.kind) {
      case 'global':
        return { left: f.getWidth() - 260, top: 60 };
      case 'image_point':
        return {
          left: imgLeft + anchor.x * scaleX,
          top: imgTop + anchor.y * scaleY,
        };
      case 'mask_id': {
        const mask = maskStore.get(anchor.mask_id);
        if (!mask) return { left: f.getWidth() - 260, top: 60 };
        let sx = 0, sy = 0, n = 0;
        for (let y = 0; y < mask.height; y++) {
          for (let x = 0; x < mask.width; x++) {
            if (mask.data[y * mask.width + x]) { sx += x; sy += y; n++; }
          }
        }
        if (n === 0) return { left: f.getWidth() - 260, top: 60 };
        return {
          left: imgLeft + (sx / n) * scaleX,
          top: imgTop + (sy / n) * scaleY,
        };
      }
      case 'region_label': {
        const mask = maskStore.all().find((m) => m.label === anchor.label);
        if (!mask) return { left: f.getWidth() - 260, top: 60 };
        let sx = 0, sy = 0, n = 0;
        for (let y = 0; y < mask.height; y++) {
          for (let x = 0; x < mask.width; x++) {
            if (mask.data[y * mask.width + x]) { sx += x; sy += y; n++; }
          }
        }
        if (n === 0) return { left: f.getWidth() - 260, top: 60 };
        return {
          left: imgLeft + (sx / n) * scaleX,
          top: imgTop + (sy / n) * scaleY,
        };
      }
    }
  }

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
      {/* eslint-disable-next-line react-hooks/refs -- intentional: fabricCanvasRef.current is read to compute pixel positions; setTick() re-triggers render on viewport changes so positions stay current */}
      {widgets.map((w) => {
        const pos = anchorPx(w);
        if (!pos) return null;
        const positionedStyle: React.CSSProperties = {
          left: pos.left,
          top: pos.top,
          transform: 'translate(-8px, -8px)',
          maxWidth: 260,
        };
        if (w.variant === 'ai' && w._widget) {
          return (
            <div key={w.id} className="absolute pointer-events-auto" style={positionedStyle}>
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
            <div key={w.id} className="absolute pointer-events-auto" style={positionedStyle}>
              <ToolWidgetCard uw={w} />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
