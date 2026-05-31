import { Palette } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { HslSectionBody } from '@/components/inspector/adjustments/HslSectionBody';

function HslPanel({ layerId }: ProcessingPanelProps) {
  return <HslSectionBody layerId={layerId} />;
}

const BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const CHANNELS = ['hue', 'sat', 'lum'];

export const hslProcessing: ProcessingDefinition = {
  id: 'hsl',
  label: 'HSL',
  icon: Palette,
  category: 'adjust',
  adjustmentType: 'hsl',
  paramKeys: BANDS.flatMap((b) => CHANNELS.map((c) => `${b}_${c}`)),
  params: BANDS.flatMap((b) =>
    CHANNELS.map((c) => ({ key: `${b}_${c}`, label: `${b} ${c}`, min: -100, max: 100, default: 0 })),
  ),
  Panel: HslPanel,
};
