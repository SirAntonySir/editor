// src/processing/clarity.tsx
import { Contrast } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { ScalarSectionBody } from '@/components/inspector/adjustments/ScalarSectionBody';

function ClarityPanel({ layerId }: ProcessingPanelProps) {
  return <ScalarSectionBody layerId={layerId} op="clarity" params={clarityProcessing.params} />;
}

export const clarityProcessing: ProcessingDefinition = {
  id: 'clarity',
  label: 'Clarity',
  icon: Contrast,
  category: 'adjust',
  adjustmentType: 'clarity',
  paramKeys: ['amount'],
  params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 0 }],
  Panel: ClarityPanel,
};
