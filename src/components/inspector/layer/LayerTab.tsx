import { useMemo } from 'react';
import { useEditorStore } from '@/store';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { LayerRow } from './LayerRow';

export function LayerTab() {
  const activeImageNode = useEditorStore((s) =>
    s.activeImageNodeId ? s.imageNodes[s.activeImageNodeId] : null,
  );
  const allLayers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);

  const layers = useMemo(() => {
    if (!activeImageNode) return [];
    const idSet = new Set(activeImageNode.layerIds);
    return allLayers
      .filter((l) => idSet.has(l.id))
      .sort((a, b) => b.order - a.order);
  }, [allLayers, activeImageNode]);

  if (!activeImageNode) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-8 text-[11px] text-text-secondary text-center">
        Select an image to inspect its layers.
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="flex flex-col">
        {layers.map((layer) => (
          <LayerRow key={layer.id} layer={layer} isActive={layer.id === activeLayerId} />
        ))}
      </div>
    </ScrollArea>
  );
}
