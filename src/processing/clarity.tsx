// src/processing/clarity.tsx
import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';

const ClarityIcon = createMaterialIcon('auto_awesome');
import { ScalarSectionBody } from '@/components/inspector/adjustments/ScalarSectionBody';

function ClarityPanel({ layerId }: ProcessingPanelProps) {
  return <ScalarSectionBody layerId={layerId} op="clarity" params={clarityProcessing.params} />;
}

export const clarityProcessing: ProcessingDefinition = {
  id: 'clarity',
  label: 'Clarity',
  icon: ClarityIcon,
  category: 'adjust',
  adjustmentType: 'clarity',
  paramKeys: ['amount'],
  params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 0 }],
  Panel: ClarityPanel,
};
