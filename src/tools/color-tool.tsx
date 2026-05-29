import { Palette } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';

export const ColorTool: ToolDefinition = {
  name: 'color',
  label: 'Color',
  icon: Palette,
  category: 'adjust',
  processingId: 'color',
  onActivate: () => {
    // activeScope is already set by the canvas click/cycle; nothing extra needed.
  },
};
