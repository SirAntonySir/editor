import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { WidgetShell } from '@/components/widget/WidgetShell';
import { useChromeVisible } from '@/hooks/useChromeVisible';
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

  // Anchor edge handles to the visual centre of the shell header so tethers
  // connect at the header band. Two source handles (left + right) let edges
  // exit on the side facing the connected image node.
  const headerY = '10px';

  // Measure the WidgetShell's natural CSS box so the bottom + right source
  // handles can anchor at its actual extent. Widgets now live in canvas space
  // (Figma model): React Flow's zoom transform handles screen-pixel conversion,
  // so handle positions are in unscaled CSS pixels.
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
  }, [id, naturalSize.w, naturalSize.h, updateNodeInternals]);

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
        style={{ left: '50%', top: `${naturalSize.h}px`, opacity: 0 }}
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
        style={{ top: headerY, left: `${naturalSize.w}px`, opacity: 0 }}
      />
      {chromeVisible ? (
        <div ref={innerRef}>
          <WidgetShell widget={data.widget} selected={selected} />
        </div>
      ) : (
        <MarkerDot widget={data.widget} />
      )}
    </>
  );
}
