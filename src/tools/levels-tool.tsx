import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ToolDefinition } from '@/types/tool';

const LevelsIcon = createMaterialIcon('tune');

export const LevelsTool: ToolDefinition = {
  name: 'levels',
  label: 'Levels',
  icon: LevelsIcon,
  category: 'adjust',
  processingId: 'levels',
  onActivate: () => {
    // activeScope is already set by the canvas click/cycle; nothing extra needed.
  },
};
