import { Palette } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';

export const HslTool: ToolDefinition = {
  name: 'hsl',
  label: 'HSL',
  icon: Palette,
  category: 'adjust',
  processingId: 'hsl',
  onActivate: () => {},
};
