// src/processing/grain.tsx
import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { ScalarSectionBody } from '@/components/inspector/adjustments/ScalarSectionBody';

const GrainIcon = createMaterialIcon('grain');

function GrainPanel({ layerId }: ProcessingPanelProps) {
  return <ScalarSectionBody layerId={layerId} op="grain" params={grainProcessing.params} />;
}

export const grainProcessing: ProcessingDefinition = {
  id: 'grain',
  label: 'Grain',
  icon: GrainIcon,
  category: 'adjust',
  adjustmentType: 'grain',
  paramKeys: ['amount', 'size', 'roughness'],
  params: [
    { key: 'amount',    label: 'Amount',    min: 0,  max: 100, default: 0 },
    { key: 'size',      label: 'Size',      min: 50, max: 200, default: 100 },
    { key: 'roughness', label: 'Roughness', min: 0,  max: 100, default: 50 },
  ],
  Panel: GrainPanel,
};
