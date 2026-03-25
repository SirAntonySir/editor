import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';
import { ProcessingRegistry } from '@/lib/processing-registry';
import type { ProcessingNode, ProcessingGraph } from '@/types/graph';

// ─── Structural node editors (not from ProcessingRegistry) ──────────

function SourceInfo({ node }: { node: ProcessingNode }) {
  const layer = useEditorStore((s) =>
    node.data.layerId ? s.layers.find((l) => l.id === node.data.layerId) : undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-text-primary font-medium">{layer?.name ?? 'Source'}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary text-text-secondary w-fit capitalize">
        {layer?.type ?? 'image'}
      </span>
    </div>
  );
}

function BlendEditor({ node }: { node: ProcessingNode }) {
  const blendMode = node.data.blendMode ?? 'normal';
  const opacity = Math.round((node.data.opacity ?? 1) * 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-text-secondary">Blend Mode</div>
      <span className="text-xs text-text-primary capitalize">{blendMode}</span>
      <div className="text-xs text-text-secondary">Opacity</div>
      <span className="text-xs text-text-primary tabular-nums">{opacity}%</span>
    </div>
  );
}

// ─── Node editor resolver ───────────────────────────────────────────

function NodeEditor({ node }: { node: ProcessingNode }) {
  const t = node.type;

  // Structural nodes
  if (t === 'source') return <div className="p-3"><SourceInfo node={node} /></div>;
  if (t === 'blend') return <div className="p-3"><BlendEditor node={node} /></div>;
  if (t === 'crop') return null;
  if (t === 'output') return <div className="p-3 text-[10px] text-text-secondary">Final composited output.</div>;

  // Processing nodes — resolved via ProcessingRegistry
  const def = ProcessingRegistry.get(t);
  if (def && node.data.layerId) {
    const Panel = def.Panel;
    return <Panel layerId={node.data.layerId} adjustmentId={node.data.adjustmentId} />;
  }

  return null;
}

// ─── Properties panel ───────────────────────────────────────────────

export function GraphPropertiesPanel({ graph }: { graph: ProcessingGraph }) {
  const highlightedNodeId = useGraphStore((s) => s.highlightedNodeId);
  const selectedNode = highlightedNodeId
    ? graph.nodes.find((n) => n.id === highlightedNodeId)
    : null;

  if (!selectedNode) return null;

  return (
    <div className="absolute top-12 right-2 z-20 w-56 max-h-[calc(100vh-5rem)] glass-panel overflow-y-auto overflow-x-hidden flex flex-col">
      <div className="px-3 py-2 text-xs font-medium text-text-secondary border-b border-separator">
        {selectedNode.data.label}
      </div>
      <NodeEditor node={selectedNode} />
    </div>
  );
}

// Re-export panel components for backward compatibility
export { LightPanel as LightEditor } from '@/processing/light';
export { ColorPanel as ColorEditor } from '@/processing/color';
export { KelvinPanel as KelvinEditor } from '@/processing/kelvin';
export { LevelsPanel as LevelsEditor } from '@/processing/levels';
