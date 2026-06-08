// src/processing/vignette.tsx
import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { ScalarSectionBody } from '@/components/inspector/adjustments/ScalarSectionBody';

const VignetteIcon = createMaterialIcon('vignette');

function VignettePanel({ layerId }: ProcessingPanelProps) {
  return <ScalarSectionBody layerId={layerId} op="vignette" params={vignetteProcessing.params} />;
}

export const vignetteProcessing: ProcessingDefinition = {
  id: 'vignette',
  label: 'Vignette',
  icon: VignetteIcon,
  category: 'adjust',
  adjustmentType: 'vignette',
  paramKeys: ['amount', 'midpoint', 'feather', 'roundness'],
  params: [
    { key: 'amount',    label: 'Amount',    min: -100, max: 100, default: 0 },
    { key: 'midpoint',  label: 'Midpoint',  min: 0,    max: 100, default: 50 },
    { key: 'feather',   label: 'Feather',   min: 0,    max: 100, default: 50 },
    { key: 'roundness', label: 'Roundness', min: -100, max: 100, default: 0 },
  ],
  Panel: VignettePanel,
};
