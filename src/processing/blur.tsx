// src/processing/blur.tsx
import { Droplet } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { ScalarSectionBody } from '@/components/inspector/adjustments/ScalarSectionBody';

function BlurPanel({ layerId }: ProcessingPanelProps) {
  return <ScalarSectionBody layerId={layerId} op="blur" params={blurProcessing.params} />;
}

export const blurProcessing: ProcessingDefinition = {
  id: 'blur',
  label: 'Blur',
  icon: Droplet,
  category: 'adjust',
  adjustmentType: 'blur',
  paramKeys: ['radius'],
  params: [{ key: 'radius', label: 'Radius', min: 0, max: 100, default: 0 }],
  Panel: BlurPanel,
};
