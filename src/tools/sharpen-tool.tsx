import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ToolDefinition } from '@/types/tool';

const SharpenIcon = createMaterialIcon('deblur');

export const SharpenTool: ToolDefinition = {
  name: 'sharpen',
  label: 'Sharpen',
  icon: SharpenIcon,
  category: 'adjust',
  processingId: 'sharpen',
  onActivate: () => {},
};
