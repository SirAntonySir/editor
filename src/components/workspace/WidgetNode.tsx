import { Handle, Position } from '@xyflow/react';
import { WidgetShell } from '@/components/widget/WidgetShell';
import { useChromeScale } from '@/hooks/useChromeScale';
import type { Widget } from '@/types/widget';

export interface WidgetNodeData extends Record<string, unknown> {
  widget: Widget;
}

interface WidgetNodeProps {
  id: string;
  data: WidgetNodeData;
  selected: boolean;
}

export function WidgetNode({ data, selected: _selected }: WidgetNodeProps) {
  const scale = useChromeScale();
  // Anchor edge handles to the visual centre of the shell header so tethers
  // connect at the header band. Two source handles (left + right) let edges
  // exit on the side facing the connected image node.
  const headerY = `${10 * scale}px`;
  return (
    <>
      <Handle
        type="source"
        position={Position.Left}
        id="tether-out-left"
        style={{ top: headerY, opacity: 0 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="tether-out-right"
        style={{ top: headerY, opacity: 0 }}
      />
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <WidgetShell widget={data.widget} />
      </div>
    </>
  );
}
