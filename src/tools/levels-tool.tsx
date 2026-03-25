import { SlidersHorizontal } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';

export const LevelsTool: ToolDefinition = {
  name: 'levels',
  label: 'Levels',
  icon: SlidersHorizontal,
  category: 'adjust',
  processingId: 'levels',
};
