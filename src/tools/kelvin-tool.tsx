import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ToolDefinition } from '@/types/tool';

const KelvinIcon = createMaterialIcon('thermostat');

export const KelvinTool: ToolDefinition = {
  name: 'kelvin',
  label: 'White Balance',
  icon: KelvinIcon,
  category: 'adjust',
  processingId: 'kelvin',
  onActivate: () => {
    // activeScope is already set by the canvas click/cycle; nothing extra needed.
  },
};
