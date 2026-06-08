// src/processing/split-tone.tsx
import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { ScalarSectionBody } from '@/components/inspector/adjustments/ScalarSectionBody';

const SplitToneIcon = createMaterialIcon('gradient');

function SplitTonePanel({ layerId }: ProcessingPanelProps) {
  return <ScalarSectionBody layerId={layerId} op="splitTone" params={splitToneProcessing.params} />;
}

export const splitToneProcessing: ProcessingDefinition = {
  id: 'splitTone',
  label: 'Split Tone',
  icon: SplitToneIcon,
  category: 'adjust',
  adjustmentType: 'splitTone',
  paramKeys: ['shadow_hue', 'shadow_sat', 'highlight_hue', 'highlight_sat', 'balance'],
  params: [
    { key: 'shadow_hue',    label: 'Shadow Hue',    min: 0,    max: 360, default: 0, format: (v) => `${Math.round(v)}°` },
    { key: 'shadow_sat',    label: 'Shadow Sat',    min: 0,    max: 100, default: 0 },
    { key: 'highlight_hue', label: 'Highlight Hue', min: 0,    max: 360, default: 0, format: (v) => `${Math.round(v)}°` },
    { key: 'highlight_sat', label: 'Highlight Sat', min: 0,    max: 100, default: 0 },
    { key: 'balance',       label: 'Balance',       min: -100, max: 100, default: 0 },
  ],
  Panel: SplitTonePanel,
};
