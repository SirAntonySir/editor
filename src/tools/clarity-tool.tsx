import { Contrast } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';

export const ClarityTool: ToolDefinition = {
  name: 'clarity',
  label: 'Clarity',
  icon: Contrast,
  category: 'adjust',
  processingId: 'clarity',
  onActivate: () => {},
};
