import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';

const FiltersIcon = createMaterialIcon('filter_b_and_w');
import { FiltersPanel as FiltersPanelImpl } from '@/tools/filters-tool';
import { useBackendState } from '@/store/backend-state-slice';

function FiltersPanel({ layerId }: ProcessingPanelProps) {
  return <FiltersPanelImpl layerId={layerId} />;
}

function FiltersNodeCompact({ layerId }: ProcessingPanelProps) {
  const filterName = useBackendState((s) => {
    const nodes = s.snapshot?.operationGraph.nodes ?? [];
    const lutNode = nodes.find((n) => n.layerId === layerId && n.type === 'lut');
    return lutNode?.params?.['lutName'] as string | undefined ?? null;
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
  icon: FiltersIcon,
  category: 'filter',
  adjustmentType: 'lut',
  params: [], // LUT filters don't have scalar params — they're applied as a whole
  Panel: FiltersPanel,
  NodeCompactDisplay: FiltersNodeCompact,
};
