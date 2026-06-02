import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { WidgetShell } from '@/components/widget/WidgetShell';
import { useChromeScale } from '@/hooks/useChromeScale';
import { useChromeVisible } from '@/hooks/useChromeVisible';
import type { Widget } from '@/types/widget';

export interface WidgetNodeData extends Record<string, unknown> {
  widget: Widget;
}

interface WidgetNodeProps {
  id: string;
  data: WidgetNodeData;
  selected: boolean;
}

export function WidgetNode({ id, data, selected }: WidgetNodeProps) {
  const scale = useChromeScale();
  const chromeVisible = useChromeVisible();
  // Anchor edge handles to the visual centre of the shell header so tethers
  // connect at the header band. Two source handles (left + right) let edges
  // exit on the side facing the connected image node.
  const headerY = `${10 * scale}px`;

  // Measure the WidgetShell's natural (unscaled) box so the bottom + right
  // source handles can anchor at the *visible* edges of the scaled shell.
  // Without this, React Flow's default `.react-flow__handle-bottom { bottom: 0 }`
  // anchors to the RF node wrapper's measured layout, which on the rendered
  // canvas reads smaller than the visible shell extent — tether endpoints
  // attach inside the widget instead of at its bottom-right corner.
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

  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, scale, naturalSize.w, naturalSize.h, updateNodeInternals]);

  const scaledH = naturalSize.h * scale;
  const scaledW = naturalSize.w * scale;

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
        style={{ top: headerY, left: 0, opacity: 0 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="tether-out-right"
        style={{ top: headerY, left: `${scaledW}px`, opacity: 0 }}
      />
      {chromeVisible && (
        <div
          ref={innerRef}
          style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          <WidgetShell widget={data.widget} selected={selected} />
        </div>
      )}
    </>
  );
}
