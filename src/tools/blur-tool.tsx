import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ToolDefinition } from '@/types/tool';

const BlurIcon = createMaterialIcon('blur_on');

export const BlurTool: ToolDefinition = {
  name: 'blur',
  label: 'Blur',
  icon: BlurIcon,
  category: 'adjust',
  processingId: 'blur',
  onActivate: () => {},
};
