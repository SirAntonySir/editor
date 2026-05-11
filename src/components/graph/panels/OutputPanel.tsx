import type { NodePanelProps } from '@/types/node-definition';

export function OutputPanel(_: NodePanelProps) {
  return (
    <div className="p-3">
      <span className="text-[10px] text-text-secondary">
        Final composited output. This node shows the result of all processing applied to the layer stack.
      </span>
    </div>
  );
}
