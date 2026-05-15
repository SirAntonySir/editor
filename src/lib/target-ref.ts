import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';
import type { TargetRef } from '@/types/ai-target';

export function resolveSmartTarget(): TargetRef {
  const editor = useEditorStore.getState();
  const graph = useGraphStore.getState();

  const selectedId = graph.selectedNodeId ?? graph.highlightedNodeId;
  if (selectedId) {
    for (const layer of editor.layers) {
      const adj = layer.adjustmentStack?.adjustments.find((a) => a.id === selectedId);
      if (adj) {
        return { kind: 'node', layerId: layer.id, adjustmentId: adj.id };
      }
    }
  }

  if (editor.activeLayerId) {
    return { kind: 'layer', layerId: editor.activeLayerId };
  }

  const firstImage = editor.layers.find((l) => l.type === 'image');
  if (firstImage) return { kind: 'layer', layerId: firstImage.id };

  return { kind: 'composite' };
}

export function humanLabelFor(ref: TargetRef): string {
  if (ref.kind === 'composite') return 'Whole composite';

  const editor = useEditorStore.getState();
  const layer = editor.layers.find((l) => l.id === ref.layerId);
  if (!layer) return 'Unknown target';
  if (ref.kind === 'layer') return layer.name;

  const adj = layer.adjustmentStack?.adjustments.find((a) => a.id === ref.adjustmentId);
  if (!adj) return 'Unknown target';
  return `${layer.name} · ${adj.name}`;
}
