import { Image as ImageIcon } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { FiltersPanel as FiltersPanelImpl } from '@/tools/filters-tool';
import { useEditorStore } from '@/store';

function FiltersPanel({ layerId }: ProcessingPanelProps) {
  return <FiltersPanelImpl layerId={layerId} />;
}

function FiltersNodeCompact({ layerId }: ProcessingPanelProps) {
  const filterName = useEditorStore((s) => {
    const layer = s.layers.find((l) => l.id === layerId);
    if (!layer) return null;
    const lutAdj = layer.adjustmentStack.adjustments.find((a) => a.type === 'lut');
    return lutAdj?.name ?? null;
  });

  return (
    <div className="px-3 py-1.5">
      <span className="text-[10px] text-text-secondary">
        {filterName ?? 'No filter'}
      </span>
    </div>
  );
}

export const filtersProcessing: ProcessingDefinition = {
  id: 'filter',
  label: 'Filter',
  icon: ImageIcon,
  category: 'filter',
  adjustmentType: 'lut',
  params: [], // LUT filters don't have scalar params — they're applied as a whole
  Panel: FiltersPanel,
  NodeCompactDisplay: FiltersNodeCompact,
};
