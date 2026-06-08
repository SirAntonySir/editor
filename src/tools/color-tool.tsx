import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ToolDefinition } from '@/types/tool';

const ColorIcon = createMaterialIcon('palette');

export const ColorTool: ToolDefinition = {
  name: 'color',
  label: 'Color',
  icon: ColorIcon,
  category: 'adjust',
  processingId: 'color',
  onActivate: () => {
    // activeScope is already set by the canvas click/cycle; nothing extra needed.
  },
};
