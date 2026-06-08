// src/processing/blur.tsx
import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';

const BlurIcon = createMaterialIcon('blur_on');
import { ScalarSectionBody } from '@/components/inspector/adjustments/ScalarSectionBody';

function BlurPanel({ layerId }: ProcessingPanelProps) {
  return <ScalarSectionBody layerId={layerId} op="blur" params={blurProcessing.params} />;
}

export const blurProcessing: ProcessingDefinition = {
  id: 'blur',
  label: 'Blur',
  icon: BlurIcon,
  category: 'adjust',
  adjustmentType: 'blur',
  paramKeys: ['radius'],
  params: [{ key: 'radius', label: 'Radius', min: 0, max: 100, default: 0 }],
  Panel: BlurPanel,
};
