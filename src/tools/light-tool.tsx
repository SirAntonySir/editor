import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ToolDefinition } from '@/types/tool';

const LightIcon = createMaterialIcon('light_mode');

export const LightTool: ToolDefinition = {
  name: 'light',
  label: 'Light',
  icon: LightIcon,
  category: 'adjust',
  shortcut: 'B',
  processingId: 'light',
  onActivate: () => {
    // activeScope is already set by the canvas click/cycle; nothing extra needed.
  },
};
