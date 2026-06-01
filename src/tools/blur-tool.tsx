import { Droplet } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';

export const BlurTool: ToolDefinition = {
  name: 'blur',
  label: 'Blur',
  icon: Droplet,
  category: 'adjust',
  processingId: 'blur',
  onActivate: () => {},
};
