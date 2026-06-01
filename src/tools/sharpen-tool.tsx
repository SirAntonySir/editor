import { Aperture } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';

export const SharpenTool: ToolDefinition = {
  name: 'sharpen',
  label: 'Sharpen',
  icon: Aperture,
  category: 'adjust',
  processingId: 'sharpen',
  onActivate: () => {},
};
