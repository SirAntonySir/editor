import { Thermometer } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';

export const KelvinTool: ToolDefinition = {
  name: 'kelvin',
  label: 'White Balance',
  icon: Thermometer,
  category: 'adjust',
  processingId: 'kelvin',
  onActivate: () => {
    // activeScope is already set by the canvas click/cycle; nothing extra needed.
  },
};
