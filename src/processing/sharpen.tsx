// src/processing/sharpen.tsx
import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';

const SharpenIcon = createMaterialIcon('deblur');
import { ScalarSectionBody } from '@/components/inspector/adjustments/ScalarSectionBody';

function SharpenPanel({ layerId }: ProcessingPanelProps) {
  return <ScalarSectionBody layerId={layerId} op="sharpen" params={sharpenProcessing.params} />;
}

export const sharpenProcessing: ProcessingDefinition = {
  id: 'sharpen',
  label: 'Sharpen',
  icon: SharpenIcon,
  category: 'adjust',
  adjustmentType: 'sharpen',
  paramKeys: ['amount'],
  params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 0 }],
  Panel: SharpenPanel,
};
