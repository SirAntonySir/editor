import { Handle, Position } from '@xyflow/react';
import { WidgetShell } from '@/components/widget/WidgetShell';
import type { Widget } from '@/types/widget';

export interface WidgetNodeData {
  widget: Widget;
}

interface WidgetNodeProps {
  id: string;
  data: WidgetNodeData;
  selected: boolean;
}

export function WidgetNode({ data, selected: _selected }: WidgetNodeProps) {
  return (
    <>
      <Handle type="source" position={Position.Right} id="tether-out" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} id="tether-in" style={{ opacity: 0 }} />
      <WidgetShell widget={data.widget} />
    </>
  );
}
