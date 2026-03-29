import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';
import type { NodePanelProps } from '@/types/node-definition';

export function SourcePanel({ node }: NodePanelProps) {
  const layer = useEditorStore((s) =>
    node.data.layerId ? s.layers.find((l) => l.id === node.data.layerId) : undefined,
  );

  const source = node.data.layerId ? CanvasRegistry.get(node.data.layerId) : undefined;

  return (
    <div className="p-3 flex flex-col gap-2">
      <span className="text-xs text-text-primary font-medium">{layer?.name ?? 'Source'}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary text-text-secondary w-fit capitalize">
        {layer?.type ?? 'image'}
      </span>
      {source && source.width > 0 && (
        <span className="text-[10px] text-text-secondary tabular-nums">
          {source.width} &times; {source.height} px
        </span>
      )}
    </div>
  );
}
